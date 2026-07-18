import { z } from "zod";

/**
 * Envelope-conformance fixture format (roadmap/03-envelope-compiler-
 * engine-adapter.md work item 6: "per-envelope scripted trace + expected
 * allow/deny verdict at EACH of layers 2-4 (permissions, adjudication+
 * journal, sandbox — adaptation §5.1/§9), each layer independently
 * assertable by disabling the others"). `z.object(...).strict()`
 * throughout per this repo's coding convention.
 */
export const ConformanceLayerVerdictSchema = z.enum(["allow", "deny"]);
export type ConformanceLayerVerdict = z.infer<typeof ConformanceLayerVerdictSchema>;

export const ConformanceToolCallSchema = z
  .object({
    toolName: z.string().min(1),
    toolInput: z.record(z.string(), z.unknown()),
  })
  .strict();
export type ConformanceToolCall = z.infer<typeof ConformanceToolCallSchema>;

export const ConformanceExpectedVerdictsSchema = z
  .object({
    permissions: ConformanceLayerVerdictSchema,
    adjudication: ConformanceLayerVerdictSchema,
    sandbox: ConformanceLayerVerdictSchema,
  })
  .strict();
export type ConformanceExpectedVerdicts = z.infer<typeof ConformanceExpectedVerdictsSchema>;

/** A single permission-rule-set "level" a fixture can layer in (see `deny-wins-cross-level`). */
export const ConformancePermissionRuleSetSchema = z
  .object({
    allow: z.array(z.string()),
    deny: z.array(z.string()),
  })
  .strict();
export type ConformancePermissionRuleSet = z.infer<typeof ConformancePermissionRuleSetSchema>;

export const ConformanceFixtureSchema = z
  .object({
    name: z.string().min(1),
    description: z.string().min(1),
    baselineCitation: z.string().min(1),
    /** Merged over `buildAuthorizationEnvelope()`'s defaults before compiling. */
    envelopeOverrides: z.record(z.string(), z.unknown()).optional(),
    /** Replaces the compiled profile's own allow/deny outright — isolates default-deny/deny-wins scenarios from the mandatory compiled set. */
    permissionOverride: ConformancePermissionRuleSetSchema.optional(),
    /** Extra rule-set "levels" unioned in alongside the (possibly overridden) compiled profile — the deny-wins-cross-level mechanism. */
    additionalPermissionLevels: z.array(ConformancePermissionRuleSetSchema).optional(),
    toolCall: ConformanceToolCallSchema,
    expected: ConformanceExpectedVerdictsSchema,
  })
  .strict();
export type ConformanceFixture = z.infer<typeof ConformanceFixtureSchema>;

export function validateConformanceFixture(candidate: unknown): ConformanceFixture {
  return ConformanceFixtureSchema.parse(candidate);
}
