/**
 * TaskPacket builder — roadmap/13-scheduler-packets-context.md §In scope,
 * "TaskPacket builder": "requirement IDs, objective, non-goals, exact base
 * object ID (07's freeze), relevant interfaces, owned paths (11's write
 * ownership), constraints, resource limits, gates, result schema — nothing
 * else; size budgets enforced." Also owns the "ephemeral lesson-preamble
 * slot" (§In scope: "populated only by an in-run repair... or by
 * shadow-run... never a persistent packet field, never read anywhere
 * else") — see `BuildTaskPacketResult.lessonPreamble` below.
 *
 * PACKET ⊆ ENVELOPE (roadmap/13 §Test plan, Security: "a TaskPacket's
 * owned-paths/commands can never be constructed wider than the approved
 * AuthorizationEnvelope it derives from"). `TaskPacketSchema` (02) has no
 * dedicated `commands` field of its own (its closest field is the free-text
 * `constraints` array) — this builder's own minimal-sufficient choice
 * (documented deviation, matching this repo's established pattern for
 * fields no cited source material pins a shape for): callers who want an
 * attempt scoped to a narrower command set than the full envelope pass
 * `allowedCommands`, which is checked against `envelope.commands` and
 * rendered into `constraints` as `Allowed command: <cmd>` lines — the
 * packet's own audit trail for which commands this attempt may use, always
 * provably a subset of what the envelope actually authorizes.
 */

import {
  CURRENT_SCHEMA_VERSION,
  TaskPacketSchema,
  isPathAtOrBelow,
  type AuthorizationEnvelope,
  type TaskPacket,
  type SpecRecord,
} from "@crabgic/contracts";
import { assertPacketWithinBudget, type PacketFieldBudgets } from "./budgets.js";
import { PacketEnvelopeViolationError } from "./errors.js";

export interface BuildTaskPacketOptions {
  readonly id: string;
  readonly workUnitId: string;
  readonly requirementIds: readonly string[];
  /**
   * The acceptance criteria this attempt must satisfy, verbatim (roadmap/25 WI 3).
   *
   * REQUIRED. `requirementIds` is a reference the worker cannot resolve — the
   * registry lives with the supervisor, not in the worktree — so the ids alone
   * left the party doing the work as the only party without the criteria.
   */
  readonly spec: SpecRecord;
  readonly objective: string;
  readonly nonGoals?: readonly string[];
  /** The exact frozen base Git object id (07's freeze) — threaded verbatim, never re-derived here. */
  readonly baseObjectId: string;
  readonly relevantInterfaces?: readonly string[];
  /** This attempt's write ownership — checked against `envelope.ownedPaths` (see file-level doc comment). */
  readonly ownedPaths: readonly string[];
  /** Narrower-than-envelope command scope for this attempt — checked against `envelope.commands`; defaults to the full envelope command set. */
  readonly allowedCommands?: readonly string[];
  /** Additional free-text constraints beyond the derived `Allowed command: ...` lines. */
  readonly additionalConstraints?: readonly string[];
  readonly gates?: readonly string[];
  readonly resourceLimits: { readonly maxTurns: number; readonly maxBudgetUsd?: number };
  readonly resultSchema: Record<string, unknown>;
  /** The approved envelope this packet must never be constructed wider than. */
  readonly envelope: AuthorizationEnvelope;
  /**
   * Ephemeral lesson-preamble text — populated ONLY by an in-run repair
   * attempt or by the shadow-run mechanism (`./shadow-run.ts`), per this
   * phase's own explicit two-caller restriction. Never stored on the
   * returned `TaskPacket` (02's schema has no such field, deliberately —
   * see `@crabgic/contracts`'s own `task-packet.ts` doc comment) — carried back
   * out-of-band on `BuildTaskPacketResult.lessonPreamble` instead, for a
   * caller that wants to fold it into the worker prompt text alongside
   * (never inside) the packet.
   */
  readonly lessonPreamble?: string;
  readonly budgets?: PacketFieldBudgets;
}

export interface BuildTaskPacketResult {
  readonly packet: TaskPacket;
  /** Never a field on `packet` itself — see `lessonPreamble` on `BuildTaskPacketOptions`. */
  readonly lessonPreamble: string | undefined;
}

/**
 * Owned paths are CONTAINED, never merely members.
 *
 * An envelope granting the directory `scripts/stale-dist` covers a work unit
 * owning `scripts/stale-dist/units.mjs`, and this must say so: the compiled
 * permission profile already emits `Write(//<worktree>/scripts/stale-dist/**)`
 * for that grant, the standing-policy gate reads the pair as contained, and
 * the intake's unused-authority report counts the grant as used. Exact
 * string-set membership disagreed with all three, and on 2026-09-05 run
 * `aff03e3a` died of that disagreement 36ms after its intake freeze — refused
 * at dispatch with zero work units attempted, by a rule no written authority
 * in this repository states.
 *
 * `isPathAtOrBelow` is imported rather than reimplemented, and that is the
 * whole point: a private matcher here is exactly what failed, and the
 * repository has measured what a second implementation costs (6895 mismatches
 * over a 51,911-prefix corpus — see `normalizePathPrefix`'s own comment).
 */
function assertPathSubset(requested: readonly string[], allowed: readonly string[]): void {
  const offending = requested.filter((p) => !isPathAtOrBelow(p, allowed));
  if (offending.length > 0) {
    throw new PacketEnvelopeViolationError("ownedPaths", offending);
  }
}

/**
 * Commands stay on EXACT membership — a command is not a path.
 *
 * `npm run build` does not confer `npm run build --workspace x`, and there is
 * no containment relation between two command strings that this system has
 * ever ruled on. `is-contained.ts`'s `exactlyContained` (03) draws the same
 * line for the same reason.
 */
function assertCommandSubset(requested: readonly string[], allowed: readonly string[]): void {
  const allowedSet = new Set(allowed);
  const offending = requested.filter((c) => !allowedSet.has(c));
  if (offending.length > 0) {
    throw new PacketEnvelopeViolationError("commands", offending);
  }
}

/**
 * Builds a schema-valid, budget-checked `TaskPacket`. Throws
 * `PacketEnvelopeViolationError` if `ownedPaths`/`allowedCommands` would
 * make the packet wider than `envelope` (checked BEFORE budget
 * enforcement, so a widened-and-oversized packet reports the envelope
 * violation first — the more fundamental authorization defect). Throws
 * `PacketBudgetExceededError` (via `assertPacketWithinBudget`) if any field
 * exceeds its configured budget — dispatch is blocked, never silently
 * truncated.
 */
export function buildTaskPacket(options: BuildTaskPacketOptions): BuildTaskPacketResult {
  assertPathSubset(options.ownedPaths, options.envelope.ownedPaths);

  const allowedCommands = options.allowedCommands ?? options.envelope.commands;
  assertCommandSubset(allowedCommands, options.envelope.commands);

  const commandConstraints = allowedCommands.map((cmd) => `Allowed command: ${cmd}`);
  const constraints = [...commandConstraints, ...(options.additionalConstraints ?? [])];

  const packet: TaskPacket = TaskPacketSchema.parse({
    schemaVersion: CURRENT_SCHEMA_VERSION,
    id: options.id,
    workUnitId: options.workUnitId,
    requirementIds: [...options.requirementIds],
    spec: options.spec,
    objective: options.objective,
    nonGoals: [...(options.nonGoals ?? [])],
    baseObjectId: options.baseObjectId,
    relevantInterfaces: [...(options.relevantInterfaces ?? [])],
    ownedPaths: [...options.ownedPaths],
    constraints,
    resourceLimits: { ...options.resourceLimits },
    gates: [...(options.gates ?? [])],
    resultSchema: { ...options.resultSchema },
  } satisfies TaskPacket);

  assertPacketWithinBudget(packet, options.budgets);

  return { packet, lessonPreamble: options.lessonPreamble };
}
