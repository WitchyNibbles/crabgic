import { isGateRiskTag, type GateRiskTag } from "./risk-tags.js";
import type { GateFireResult, GateRegistry } from "./registry.js";
import type { GateContext } from "./types.js";

/**
 * `firePacketGates` — the wire between a dispatched `TaskPacket`'s declared gates and the gates
 * that actually run.
 *
 * ⚠️ WHAT THIS FIXES, MEASURED RATHER THAN ASSERTED. `TaskPacket.gates` has existed since
 * roadmap/13 and is populated on every packet the scheduler builds. Before this module, a grep for
 * `\.gates\b` over every non-test source in the repository — excluding the schema declaring it —
 * returned exactly ONE hit, and that hit was `task-packet-builder.ts:127` WRITING the field. No
 * code read it. Every packet carried a gate list nothing looked at, and every suite stayed green.
 *
 * That is why `implement-gates-pass` and `implement-tests-first` were underivable: both are
 * derived from journaled `EvidenceRecord.gateVerdict` values, and gates that never fire mint no
 * verdicts. Owner ruling R7's staged run stopped at stage 6 of 9 on exactly this.
 *
 * WHY IT LIVES IN `@crabgic/gates` RATHER THAN IN THE SCHEDULER. `@crabgic/gates` depends on
 * `@crabgic/scheduler` and not the reverse, and roadmap/14 consumes from 13 rather than the other
 * way about. Putting the firing in the scheduler would invert both. The scheduler declares which
 * gates a packet owes; this module honours the declaration.
 *
 * WHAT THIS IS NOT. It does not register handlers, and it does not decide which tags a packet
 * should carry. It fires what it is given, against a registry it is given, and refuses anything it
 * cannot honour. Composition stays in the composition root, where
 * `compose-gate-registry.ts` already records which handlers a deployment admits and why.
 */

/** Raised when a packet names a gate that cannot be honoured — an unknown tag, or one with no registered handler. */
export class UnhonourableGateError extends Error {
  readonly gate: string;

  constructor(gate: string, reason: string) {
    super(`cannot honour gate ${JSON.stringify(gate)}: ${reason}`);
    this.name = "UnhonourableGateError";
    this.gate = gate;
  }
}

/**
 * Fires exactly the gates a packet declares, in the order declared, and returns one result per
 * firing.
 *
 * ⚠️ FAIL CLOSED, IN BOTH DIRECTIONS, AND THE DIRECTIONS ARE DIFFERENT.
 *
 * A tag nobody registered is a REFUSAL, not a skip. A packet asking for a check that will not
 * happen is the one case where "nothing to do" is the dangerous answer: the run would report a
 * clean gate set it never ran. This is the same direction `deriveGateCriteria` takes for a
 * gate-tagged record with no verdict — unproven, never presumed green.
 *
 * An EMPTY list, by contrast, is an honest no-op and fires nothing. It must never degenerate into
 * "fire everything", which is what reaching for `fireAll` here would do. In a repository where
 * most packets name every default tag, that bug would look correct in every real run and only
 * surface on the packet that deliberately named none.
 *
 * `TaskPacket.gates` is typed `z.array(NonEmptyStringSchema)` and does not constrain its members
 * to the tag vocabulary, so a member that is not a risk tag at all is a real input rather than a
 * hypothetical one. It gets its own refusal, naming the offending string, because "unknown tag"
 * and "tag with no handler" are different repairs: one is a typo in a packet, the other is a
 * deployment that did not compose the handler.
 */
export async function firePacketGates(
  registry: GateRegistry,
  packetGates: readonly string[],
  context: GateContext,
): Promise<readonly GateFireResult[]> {
  const tags: GateRiskTag[] = [];
  for (const gate of packetGates) {
    if (!isGateRiskTag(gate)) {
      throw new UnhonourableGateError(gate, "not a gate risk tag");
    }
    if (registry.list(gate).length === 0) {
      throw new UnhonourableGateError(gate, "no handler is registered under this tag");
    }
    tags.push(gate);
  }

  const results: GateFireResult[] = [];
  for (const tag of tags) {
    // Sequential rather than concurrent: a gate runs a stack command, and two of them racing for
    // the same worktree is the failure mode 13's executor already serialises against.
    results.push(...(await registry.fireByTag(tag, context, { requireAtLeastOne: true })));
  }
  return results;
}
