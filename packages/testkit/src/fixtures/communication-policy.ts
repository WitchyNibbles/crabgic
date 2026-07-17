import {
  CommunicationPolicySchema,
  DEFAULT_COMMUNICATION_POLICY,
  type CommunicationPolicy,
} from "@eo/contracts";

/**
 * Deterministic `CommunicationPolicy` fixture builder — roadmap/02 work
 * item 10. No id/timestamp fields exist on this contract (it models a
 * policy *instance*, not an audit record — see the contract's own doc
 * comment), so this builder needs no `FixtureContext`; its default is
 * `@eo/contracts`' own canonical `DEFAULT_COMMUNICATION_POLICY` instance.
 */
export function buildCommunicationPolicy(
  overrides: Partial<CommunicationPolicy> = {},
): CommunicationPolicy {
  return CommunicationPolicySchema.parse({ ...DEFAULT_COMMUNICATION_POLICY, ...overrides });
}
