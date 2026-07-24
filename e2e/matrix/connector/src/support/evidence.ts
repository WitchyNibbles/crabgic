/**
 * Shared EvidenceRecord-emission helper for every scenario in this harness
 * (roadmap/23-release-hardening.md work item 6): "Each scenario emits an
 * EvidenceRecord (02) tagged release-gate:connector-matrix." Mirrors
 * `e2e/report/src/test-support/test-journal.ts`'s own documented pattern
 * (a fresh, real `@eo/journal` `JournalStore` over a temp directory) rather
 * than importing it — that module is explicitly `e2e/report`-internal, and
 * this project's own dependency edge is kept self-contained per its own
 * constraints.
 *
 * Every EvidenceRecord this harness journals is genuine, schema-valid
 * `@eo/contracts` data (never a placeholder) — `capturedAt`/`artifactDigests`
 * are derived from the real scenario outcome, and `objectId` defaults to
 * this checkout's actual `git rev-parse HEAD`, mirroring
 * `e2e/report/src/cli.ts`'s own `EO_RELEASE_CANDIDATE_OBJECT_ID` fallback
 * convention (see `resolveReleaseCandidateObjectId` below) — so a later
 * `release-gate-report` run over a real journal can link this harness's
 * own runs to the exact commit they were captured against.
 */
import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createJournalStore, type JournalStore } from "@eo/journal";
import { CURRENT_SCHEMA_VERSION, type EvidenceRecord } from "@eo/contracts";

/** roadmap/23 work item 6's own instruction, verbatim — every scenario's `gateTag`. */
export const CONNECTOR_MATRIX_GATE_TAG = "release-gate:connector-matrix";

/** This harness's own toolchain fingerprint — a fixed, versioned literal (never a hardcoded secret/credential, per this repo's own coding-style rule against hardcoded values — this is a public, non-sensitive identifier). */
export const CONNECTOR_MATRIX_TOOLCHAIN_FINGERPRINT = "e2e-matrix-connector@1";

export interface ScenarioJournal {
  readonly store: JournalStore;
  readonly journalDir: string;
  cleanup(): Promise<void>;
}

/** A fresh, real `@eo/journal` `JournalStore` over a temp directory — one per test file/scenario, never shared across concurrent vitest workers. */
export async function createScenarioJournal(): Promise<ScenarioJournal> {
  const journalDir = await mkdtemp(join(tmpdir(), "eo-connector-matrix-"));
  const store = createJournalStore({ journalDir });
  return {
    store,
    journalDir,
    cleanup: async () => {
      await rm(journalDir, { recursive: true, force: true });
    },
  };
}

/** sha256 content digest of `content` — never a fake placeholder, always the actual scenario-outcome bytes this EvidenceRecord's `artifactDigests` claims to reference. */
export function digestOf(content: string): string {
  return `sha256:${createHash("sha256").update(content).digest("hex")}`;
}

let cachedObjectId: string | undefined;

/**
 * The exact release-candidate Git object ID this harness's evidence is
 * captured against — `$EO_RELEASE_CANDIDATE_OBJECT_ID` when set (matching
 * `e2e/report`'s own CLI convention), else this checkout's own
 * `git rev-parse HEAD`. Cached per-process: every scenario in one test run
 * shares the same object ID, exactly like a single real release-candidate
 * run would.
 */
export function resolveReleaseCandidateObjectId(): string {
  if (cachedObjectId !== undefined) return cachedObjectId;
  const fromEnv = process.env["EO_RELEASE_CANDIDATE_OBJECT_ID"];
  if (fromEnv !== undefined && fromEnv.length > 0) {
    cachedObjectId = fromEnv;
    return cachedObjectId;
  }
  cachedObjectId = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  return cachedObjectId;
}

export interface EmitScenarioEvidenceInput {
  readonly journal: Pick<JournalStore, "appendEntry">;
  /** A short, human-readable identifier for the scenario this evidence covers (e.g. "connector-matrix: confusable-domain rejection"). */
  readonly command: string;
  /** 0 for a genuinely green (guard behaved as required) scenario outcome — never defaulted, so a caller cannot accidentally claim PASS for a scenario that actually failed. */
  readonly exitStatus: number;
  /** The real scenario-outcome content this record's digest covers (e.g. `JSON.stringify(outcome)`) — never a placeholder string. */
  readonly outcomeContent: string;
  readonly changeSetId?: string;
  readonly requirementId?: string;
}

/**
 * Journals one `EvidenceRecord` (`evidence_pointer` entry) tagged
 * `release-gate:connector-matrix`, for the current release-candidate
 * object ID — the one call every scenario test in this harness makes after
 * its own real-guard assertions pass.
 */
export async function emitScenarioEvidence(
  input: EmitScenarioEvidenceInput,
): Promise<EvidenceRecord> {
  const changeSetId = input.changeSetId ?? randomUUID();
  const record: EvidenceRecord = {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    id: randomUUID(),
    changeSetId,
    command: input.command,
    exitStatus: input.exitStatus,
    toolchainFingerprint: CONNECTOR_MATRIX_TOOLCHAIN_FINGERPRINT,
    capturedAt: new Date().toISOString(),
    artifactDigests: [digestOf(input.outcomeContent)],
    objectId: resolveReleaseCandidateObjectId(),
    gateTag: CONNECTOR_MATRIX_GATE_TAG,
    ...(input.requirementId !== undefined ? { requirementId: input.requirementId } : {}),
  };
  await input.journal.appendEntry({
    type: "evidence_pointer",
    changeSetId,
    payload: record,
  });
  return record;
}
