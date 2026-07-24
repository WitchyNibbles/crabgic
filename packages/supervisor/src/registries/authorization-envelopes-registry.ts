/**
 * Authorization-envelopes registry — added during this phase's own
 * adversarial-validation repair pass (CRITICAL C1): `ChangeSet` only ever
 * carries an `authorizationEnvelopeId` cross-reference (never an embedded
 * `AuthorizationEnvelope`), so something durable-within-process must let a
 * caller resolve "what is ChangeSet X's CURRENT, actual envelope, and what
 * is its real `canonicalHash`?" — this is exactly what
 * `packages/cli/src/intake/contract-approve-handler.ts` needs to derive
 * the EXPECTED digest server-side rather than trusting a caller-supplied
 * one (the confused-deputy fix). Mirrors `./change-sets-registry.ts`'s
 * identical shape/rationale.
 */
import { type AuthorizationEnvelope } from "@eo/contracts";
import { createInMemoryRegistry, type Registry } from "./registry.js";

export function createAuthorizationEnvelopesRegistry(): Registry<AuthorizationEnvelope> {
  return createInMemoryRegistry<AuthorizationEnvelope>();
}
