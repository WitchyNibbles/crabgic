/**
 * Requirements registry — roadmap/24.
 *
 * `IntentContract` carries only `requirementIds` (02's hard convention:
 * cross-reference, never an embedded record), so before this the
 * `Requirement` records themselves were resolvable from nowhere. They were
 * built once by `../intake/contract-builder.ts` and then dropped: no
 * registry held them, and the only durable copy was an incidental blob
 * inside the intake idempotency journal entry.
 *
 * That is why `design-addresses-every-acceptance-criterion` is documented as
 * "judged until a requirements source is wired in"
 * (`@crabgic/contracts`' `design-record.ts`) and why nothing could verify a
 * completion against the criteria it was supposed to meet. Sealing criteria
 * is meaningless if the sealed record cannot be read back and compared.
 *
 * Identical shape to `./intent-contracts-registry.ts` and for the identical
 * reason it states — the composition roots wrap it in `./file-registry.ts`
 * so it survives the process boundary between the `run` that produced the
 * intake and the daemon that drives it.
 */
import { type Requirement } from "@crabgic/contracts";
import { createInMemoryRegistry, type Registry } from "./registry.js";

export function createRequirementsRegistry(): Registry<Requirement> {
  return createInMemoryRegistry<Requirement>();
}
