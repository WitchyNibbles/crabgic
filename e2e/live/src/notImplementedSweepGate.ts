import { createHash } from "node:crypto";
import type { CommandName } from "crabgic";
import type { JournalStore } from "@crabgic/journal";
import {
  checkFamilyWiringAtProductionEntrypoint,
  checkGatewayDependencyEdge,
  checkToolsCallSupported,
} from "./gatewayFamilyCompleteness.js";
import {
  checkProductionDependencyWiring,
  combineFindings,
  sweepDispatchLevelNotImplemented,
} from "./cliNotImplementedSweep.js";
import { KNOWN_DEFERRED_ALLOWLIST, type KnownDeferredEntry } from "./knownDeferredAllowlist.js";
import {
  emitLiveConformanceEvidence,
  GATEWAY_CLI_SURFACE_COMPLETE_GATE_TAG,
  NOT_IMPLEMENTED_SWEEP_GATE_TAG,
} from "./evidence.js";

/**
 * The composed zero-`NOT_IMPLEMENTED` sweep gate — roadmap/23-release-
 * hardening.md work item 7. Folds `cliNotImplementedSweep.ts`'s real
 * dispatch-level+production-wiring findings and
 * `gatewayFamilyCompleteness.ts`'s real family-wiring+tools/call findings
 * into one list, matches it against `knownDeferredAllowlist.ts` by set
 * equality (never by count alone — a same-COUNT but different-SET drift
 * would silently pass a bare count check), and reports `PASS` only when
 * the live-discovered gap set is EXACTLY the allowlisted "real, currently
 * true" gap set: nothing new, nothing silently fixed-but-still-listed.
 */

/** Maps a `CommandName` this sweep found `NOT_IMPLEMENTED` to its `knownDeferredAllowlist.ts` id. Only commands that can ever be a REAL gap need an entry — `install`/`upgrade`/`uninstall` never reach here as a real gap today (installer IS wired), so they have no mapping. */
const COMMAND_TO_ALLOWLIST_ID: Readonly<Partial<Record<CommandName, string>>> = {
  resume: "cli.resume",
  "connection-add": "cli.connection-add",
  "connection-list": "cli.connection-list",
  "connection-doctor": "cli.connection-doctor",
  "connection-capabilities": "cli.connection-capabilities",
  "trust-review": "cli.trust-review",
  "trust-approve": "cli.trust-approve",
  "trust-revoke": "cli.trust-revoke",
  run: "cli.run",
  "learn-list": "cli.learn-list",
  "learn-approve": "cli.learn-approve",
  "learn-reject": "cli.learn-reject",
  "learn-rollback": "cli.learn-rollback",
  status: "cli.status-all-runs",
};

/** Every allowlist entry that represents an actual, currently-true gap (excludes the one purely-informational dead-branch entry, which never appears as a "real gap" finding by design). */
const ACTIONABLE_ALLOWLIST_IDS: ReadonlySet<string> = new Set(
  KNOWN_DEFERRED_ALLOWLIST.filter((e) => !e.ownerPhase.startsWith("none (dead branch")).map(
    (e) => e.id,
  ),
);

export interface NotImplementedSweepGateResult {
  readonly verdict: "PASS" | "FAIL";
  /** Live-discovered gap ids not present in the checked-in allowlist — a NEW, unlisted gap. Non-empty means FAIL. */
  readonly newUnlistedFindings: readonly string[];
  /** Allowlist ids that no longer reproduce as a live finding — worth investigating (the deferral may have been fixed and the allowlist just needs pruning), but NOT itself a FAIL: a shrinking gap set is good news, never blocked. */
  readonly staleAllowlistEntries: readonly string[];
  /** Every live-discovered gap id, sorted. */
  readonly liveFindingIds: readonly string[];
  readonly toolsCallSupported: boolean;
}

/**
 * Every constituent check this gate composes runs for real (no fakes) by
 * default — each one already documents why it is safe to run
 * unconditionally (no auth, no network, no destructive I/O).
 * `allowlistIds` is the one injectable seam, defaulting to the real,
 * checked-in `ACTIONABLE_ALLOWLIST_IDS` — overriding it is how this
 * module's own fail-first test proves the comparison is genuinely
 * fail-closed (a deliberately-shrunk allowlist against TODAY's real
 * findings reproduces exactly what a brand-new, undocumented gap would
 * look like) without needing to introduce an actual new production gap,
 * which this task is explicitly forbidden from doing.
 */
export async function runNotImplementedSweepGate(
  allowlistIds: ReadonlySet<string> = ACTIONABLE_ALLOWLIST_IDS,
): Promise<NotImplementedSweepGateResult> {
  const [dispatchLevel, familyWiring, toolsCall] = await Promise.all([
    sweepDispatchLevelNotImplemented(),
    Promise.resolve(checkFamilyWiringAtProductionEntrypoint()),
    checkToolsCallSupported(),
  ]);
  const wiring = checkProductionDependencyWiring();
  const combined = combineFindings(dispatchLevel, wiring);

  const cliGapIds = combined
    .filter((f) => f.realGapInProduction)
    .map((f) => COMMAND_TO_ALLOWLIST_ID[f.command])
    .filter((id): id is string => id !== undefined);

  const gatewayFamilyGapIds = familyWiring
    .filter((f) => !f.wiredAtProductionEntrypoint)
    .map((f) => `gateway.${f.family}`);

  const protocolGapIds = toolsCall.supported ? [] : ["gateway.protocol.tools-call"];

  const liveFindingIds = [
    ...new Set([...cliGapIds, ...gatewayFamilyGapIds, ...protocolGapIds]),
  ].sort();
  const liveSet = new Set(liveFindingIds);

  const newUnlistedFindings = liveFindingIds.filter((id) => !allowlistIds.has(id));
  const staleAllowlistEntries = [...allowlistIds].filter((id) => !liveSet.has(id)).sort();

  return {
    verdict: newUnlistedFindings.length === 0 ? "PASS" : "FAIL",
    newUnlistedFindings,
    staleAllowlistEntries,
    liveFindingIds,
    toolsCallSupported: toolsCall.supported,
  };
}

export interface RunAndEmitOptions {
  readonly journal: JournalStore;
  readonly changeSetId: string;
  readonly objectId?: string;
  /** Forwarded verbatim to `runNotImplementedSweepGate` — see that function's own doc comment on why this exists (fail-first testability, defaults to the real checked-in allowlist). */
  readonly allowlistIds?: ReadonlySet<string>;
}

/** Runs the gate and journals its verdict as an `EvidenceRecord` under this work item's own dedicated tag AND, when the gate PASSes, the real checklist-matching tag `release-gate:gateway-cli-surface-complete` too (see `./evidence.ts`'s file-level doc comment for why both). */
export async function runAndEmitNotImplementedSweepEvidence(
  options: RunAndEmitOptions,
): Promise<NotImplementedSweepGateResult> {
  const result = await runNotImplementedSweepGate(options.allowlistIds);
  const gateTags =
    result.verdict === "PASS"
      ? [NOT_IMPLEMENTED_SWEEP_GATE_TAG, GATEWAY_CLI_SURFACE_COMPLETE_GATE_TAG]
      : [NOT_IMPLEMENTED_SWEEP_GATE_TAG];
  await emitLiveConformanceEvidence({
    journal: options.journal,
    changeSetId: options.changeSetId,
    gateTags,
    command: "not-implemented-sweep-gate",
    exitStatus: result.verdict === "PASS" ? 0 : 1,
    ...(options.objectId !== undefined ? { objectId: options.objectId } : {}),
    artifactDigests: [
      `sha256:${createHash("sha256").update(result.liveFindingIds.join(",")).digest("hex")}`,
    ],
  });
  return result;
}

/** Re-exported purely so a caller/report can cite the exact allowlist this gate matched against without a second import. */
export type { KnownDeferredEntry };
export { checkGatewayDependencyEdge };
