import type { EvidenceRecord } from "@eo/contracts";
import { emitEvidence } from "./evidence.js";
import { NoGatesRegisteredError } from "./errors.js";
import { GATE_RISK_TAGS, type GateRiskTag } from "./risk-tags.js";
import type { GateContext, GateHandler, GateVerdict, RegisteredGate } from "./types.js";

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
  register(tag: GateRiskTag, name: string, handler: GateHandler): void;
  list(tag?: GateRiskTag): readonly RegisteredGate[];
  /** Fires every handler registered under `tag`, in registration order, emitting one `EvidenceRecord` per firing. */
  fireByTag(
    tag: GateRiskTag,
    context: GateContext,
    options?: FireOptions,
  ): Promise<readonly GateFireResult[]>;
  /** Fires EVERY registered handler across EVERY tag — the final-candidate re-verification primitive (work item 6): re-fires the full registered gate set (this phase's own plus any external registrants), never a subset. */
  fireAll(context: GateContext, options?: FireOptions): Promise<readonly GateFireResult[]>;
}

export function createGateRegistry(): GateRegistry {
  const byTag = new Map<GateRiskTag, RegisteredGate[]>();
  for (const tag of GATE_RISK_TAGS) {
    byTag.set(tag, []);
  }

  async function fireOne(gate: RegisteredGate, context: GateContext): Promise<GateFireResult> {
    const verdict = await gate.handler(context);
    const evidence = await emitEvidence(context.journal, context, gate.tag, verdict);
    return { tag: gate.tag, name: gate.name, verdict, evidence };
  }

  return {
    register(tag, name, handler) {
      const existing = byTag.get(tag) ?? [];
      byTag.set(tag, [...existing, { tag, name, handler }]);
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

    async fireAll(context, options) {
      const gates = [...byTag.values()].flat();
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
