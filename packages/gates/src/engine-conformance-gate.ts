import type { JournalStore } from "@eo/journal";
import type { GateHandler } from "./types.js";

/**
 * `engine-conformance` binding gate — roadmap/14 §In scope, "Gate framework
 * & registry" bullet's final paragraph + work item 7: resolves the
 * attempt's dispatching engine version, requires a journaled GREEN
 * `engine-live` run record for that EXACT version (engine version + run ID
 * + suite digest, emitted by 06), and binds that reference into the
 * `ChangeSet`'s `EvidenceRecord` — failing CLOSED when no matching green
 * record exists. This is a BINDING gate only: it never re-runs the
 * permission/hook/sandbox probes themselves (that stays 06's/23's
 * version-grain `@live` job) — roadmap/14 §Risks: "Engine conformance stays
 * version-grain by design."
 *
 * FIXTURE-MODELED (see docs/evidence/phase-14/README.md): this module reads
 * the journal for an `evidence_pointer` entry matching the EXACT shape 06's
 * `packages/engine-claude/src/live/live-harness.ts`'s `writeLiveRunRecord`
 * produces — `command: "engine-claude:@live conformance suite"`,
 * `exitStatus: 0`, `toolchainFingerprint` ending in
 * `"engine <version>"`, and an `artifactDigests` entry shaped
 * `"live-run-record.json#suiteDigest=<digest>"`. This package does NOT
 * import `@eo/engine-claude` (no new dependency edge — 06 emits ambiently,
 * consumed via the journal, exactly like 13's own `Requirement`-ID
 * consumption pattern) and does not run a live engine itself; the command-
 * string match is a documented magic-string coupling to 06's own literal —
 * see the phase-14 evidence doc's carry-forwards for a proposed shared-
 * constant reconcile.
 */

export const ENGINE_LIVE_COMMAND = "engine-claude:@live conformance suite";
const SUITE_DIGEST_PREFIX = "live-run-record.json#suiteDigest=";

export interface EngineLiveRecord {
  readonly engineVersion: string;
  readonly runId: string;
  readonly suiteDigest: string;
}

/** The latest journaled GREEN `engine-live` record for `engineVersion`, or `undefined` if none exists — the fail-closed lookup this gate is built on. */
export async function findGreenEngineLiveRecord(
  journal: JournalStore,
  engineVersion: string,
): Promise<EngineLiveRecord | undefined> {
  let latestSeq = -1;
  let latest: EngineLiveRecord | undefined;
  for await (const entry of journal.queryEntries({ type: "evidence_pointer" })) {
    if (entry.type !== "evidence_pointer") continue;
    const record = entry.payload;
    if (record.command !== ENGINE_LIVE_COMMAND) continue;
    if (record.exitStatus !== 0) continue; // green only
    if (!record.toolchainFingerprint.endsWith(` engine ${engineVersion}`)) continue;
    const suiteDigestEntry = record.artifactDigests.find((d) => d.startsWith(SUITE_DIGEST_PREFIX));
    if (suiteDigestEntry === undefined) continue;
    if (entry.seq <= latestSeq) continue;
    latestSeq = entry.seq;
    latest = {
      engineVersion,
      runId: record.objectId,
      suiteDigest: suiteDigestEntry.slice(SUITE_DIGEST_PREFIX.length),
    };
  }
  return latest;
}

export interface EngineConformanceGateInput {
  readonly engineVersion: string;
}

/**
 * The registered `engine-conformance` gate handler. Failing-first per
 * roadmap/14 work item 7: "a fixture attempt whose engine version has no
 * green `engine-live` record fails the gate before the pass path exists."
 * On a match, the returned verdict's `artifactDigests` carry the
 * `runId`/`suiteDigest` reference — this is what "binds that reference into
 * the `ChangeSet`'s `EvidenceRecord`" means concretely: `../registry.ts`'s
 * `emitEvidence` journals this verdict AS the ChangeSet's `EvidenceRecord`
 * for the `engine-conformance` tag, so the runId round-trips through it.
 */
export function createEngineConformanceGate(input: EngineConformanceGateInput): GateHandler {
  return async (context) => {
    const record = await findGreenEngineLiveRecord(context.journal, input.engineVersion);
    if (record === undefined) {
      return {
        passed: false,
        command: "engine-conformance:binding-lookup",
        exitStatus: 1,
        toolchainFingerprint: `engine ${input.engineVersion}`,
        artifactDigests: [],
        detail:
          `no journaled green engine-live record found for engine version ` +
          `"${input.engineVersion}" — failing closed (never a per-ChangeSet re-run of the probes)`,
      };
    }
    return {
      passed: true,
      command: "engine-conformance:binding-lookup",
      exitStatus: 0,
      toolchainFingerprint: `engine ${input.engineVersion}`,
      artifactDigests: [
        `engine-live-run-id:${record.runId}`,
        `engine-live-suite-digest:${record.suiteDigest}`,
      ],
      detail: `bound to green engine-live record (runId=${record.runId}, suiteDigest=${record.suiteDigest})`,
    };
  };
}
