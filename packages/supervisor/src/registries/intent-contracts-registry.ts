/**
 * Intent-contracts registry (2026-07-25). `ChangeSet` carries only an
 * `intentContractId` cross-reference (never an embedded `IntentContract`,
 * per 02's hard convention), so the contract itself must be resolvable by
 * id for anything downstream to read the requirement set it declares.
 *
 * Added because `contract.approve` needs exactly that. Its readiness
 * pre-check (`findUnmappedRequirements`) asks "is every requirement in this
 * ChangeSet's contract mapped to a work unit?", and it now runs in a
 * DIFFERENT process from the `run` that produced the intake — so the
 * requirement ids have to come from durable state. `./change-sets-
 * registry.ts` and `./authorization-envelopes-registry.ts` exist for the
 * same reason and have the identical shape; the composition roots wrap this
 * in `./file-registry.ts` to make it survive the process boundary.
 */
import { type IntentContract } from "@eo/contracts";
import { createInMemoryRegistry, type Registry } from "./registry.js";

export function createIntentContractsRegistry(): Registry<IntentContract> {
  return createInMemoryRegistry<IntentContract>();
}
