import type { EvidenceRecord } from "@crabgic/contracts";
import { emitEvidence } from "./evidence.js";
import { NoGatesRegisteredError } from "./errors.js";
import { GATE_RISK_TAGS, type GateRiskTag } from "./risk-tags.js";
import type {
  GateContext,
  GateHandler,
  GateRegistrationOptions,
  GateVerdict,
  RegisteredGate,
} from "./types.js";

/**
 * `GateFireResult` — one registered handler's outcome for one firing,
 * paired with the single `EvidenceRecord` `../evidence.ts` journaled for it.
 */
export interface GateFireResult {
  readonly tag: GateRiskTag;
  readonly name: string;
  readonly verdict: GateVerdict;
  readonly evidence: EvidenceRecord;
}

export interface FireOptions {
  /** Throws `NoGatesRegisteredError` if zero handlers are registered under the fired tag(s) — off by default (most callers treat "nothing registered" as a legitimate no-op; final-candidate re-verification opts in). */
  readonly requireAtLeastOne?: boolean;
}

/**
 * `GateRegistry` — roadmap/14-quality-security-gates.md's extensible,
 * risk-tag-keyed gate registry (work item 1). Register/list/fire-by-tag;
 * dispatch is a pure key → handlers[] lookup, never order-dependent
 * (`./registry.property.test.ts` proves this over randomized registration
 * order). External phases (15's `performance` gate, 21's connector-security
 * fixtures) call `register()` directly with zero code change inside this
 * package — the same aggregation pattern as the gateway tool registry
 * (interface-ledger Gap 1), mirrored here at the package level rather than
 * a cross-process MCP boundary.
 */
export interface GateRegistry {
  register(
    tag: GateRiskTag,
    name: string,
    handler: GateHandler,
    options?: GateRegistrationOptions,
  ): void;
  list(tag?: GateRiskTag): readonly RegisteredGate[];
  /** Fires every handler registered under `tag`, in registration order, emitting one `EvidenceRecord` per firing. */
  fireByTag(
    tag: GateRiskTag,
    context: GateContext,
    options?: FireOptions,
  ): Promise<readonly GateFireResult[]>;
  /**
   * Fires every registered handler across every tag that CAN judge the
   * integrated candidate — the final-candidate re-verification primitive (work
   * item 6): re-fires the full registered gate set (this phase's own plus any
   * external registrants), never a subset of them.
   *
   * ⚠️ GATES DECLARING `perWorkUnit` ARE THE ONE EXCLUSION, and they are
   * excluded because they cannot judge this subject at all: their inputs are a
   * single attempt's, and a `final_verifying` context carries no `workUnitId` by
   * design. Firing them here would fail every run closed. They fire through
   * `fireByTag`, per unit, at `verifying`. A registry holding ONLY such gates
   * still throws under `requireAtLeastOne` — the exclusion must not become a new
   * way to verify nothing.
   */
  fireAll(context: GateContext, options?: FireOptions): Promise<readonly GateFireResult[]>;
  /**
   * Fires exactly the gates `fireAll` skips — every registrant declaring
   * `perWorkUnit` — for ONE work unit.
   *
   * The complement is exact and that is the point: between this and `fireAll`,
   * every registered gate fires exactly once per candidate, and neither method
   * can silently drop a family. A gate registered per-work-unit that nothing
   * ever fired here would be the declared-but-unwired shape
   * `docs/evidence/criteria-closeout/defects/14-gate-registry-never-composed.md`
   * names.
   */
  firePerWorkUnit(context: GateContext, options?: FireOptions): Promise<readonly GateFireResult[]>;
}

export function createGateRegistry(): GateRegistry {
  const byTag = new Map<GateRiskTag, RegisteredGate[]>();
  for (const tag of GATE_RISK_TAGS) {
    byTag.set(tag, []);
  }

  async function fireOne(gate: RegisteredGate, context: GateContext): Promise<GateFireResult> {
    const verdict = await gate.handler(context);
    /**
     * ⚠️ An INCONCLUSIVE firing is normalised to `passed: true` HERE, once,
     * rather than at each of the several places that read `verdict.passed`.
     *
     * `allGatesPassed`, the post-completion pipeline's per-unit check and every
     * future consumer all ask the same question — "does this block?" — and an
     * inconclusive gate does not. Leaving `passed: false` on the record and
     * asking each reader to remember the exception is how one of them forgets.
     * The DETAIL still says what happened, and the emitted `EvidenceRecord`
     * still carries no `gateVerdict`, so nothing is proved by the
     * normalisation.
     */
    const evidence = await emitEvidence(context.journal, context, gate.tag, verdict);
    /**
     * The RECORD is emitted from the raw verdict above — `emitEvidence` reads
     * `inconclusive` itself and omits `gateVerdict` — and only the RETURNED
     * verdict is normalised, because `passed` is what decides blocking.
     */
    const effective =
      verdict.inconclusive === true && !verdict.passed
        ? { ...verdict, passed: true as const }
        : verdict;
    return { tag: gate.tag, name: gate.name, verdict: effective, evidence };
  }

  return {
    register(tag, name, handler, options) {
      const existing = byTag.get(tag) ?? [];
      byTag.set(tag, [
        ...existing,
        { tag, name, handler, perWorkUnit: options?.perWorkUnit === true },
      ]);
    },

    list(tag) {
      if (tag === undefined) {
        return [...byTag.values()].flat();
      }
      return [...(byTag.get(tag) ?? [])];
    },

    async fireByTag(tag, context, options) {
      const gates = byTag.get(tag) ?? [];
      if (gates.length === 0 && options?.requireAtLeastOne === true) {
        throw new NoGatesRegisteredError(tag);
      }
      const results: GateFireResult[] = [];
      for (const gate of gates) {
        results.push(await fireOne(gate, context));
      }
      return results;
    },

    async firePerWorkUnit(context, options) {
      const gates = [...byTag.values()].flat().filter((gate) => gate.perWorkUnit);
      if (gates.length === 0 && options?.requireAtLeastOne === true) {
        throw new NoGatesRegisteredError("*perWorkUnit");
      }
      const results: GateFireResult[] = [];
      for (const gate of gates) {
        results.push(await fireOne(gate, context));
      }
      return results;
    },

    async fireAll(context, options) {
      const gates = [...byTag.values()].flat().filter((gate) => !gate.perWorkUnit);
      if (gates.length === 0 && options?.requireAtLeastOne === true) {
        throw new NoGatesRegisteredError("*");
      }
      const results: GateFireResult[] = [];
      for (const gate of gates) {
        results.push(await fireOne(gate, context));
      }
      return results;
    },
  };
}
