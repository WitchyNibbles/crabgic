import { z } from "zod";

/**
 * The three tightening semantics roadmap/02's config-precedence resolver
 * declares for security keys (roadmap/02-contracts-and-schemas.md §In
 * scope, "Config precedence resolver" bullet: "a declared security-key set
 * where lower precedence only tightens (deny lists append-only, booleans
 * one-way, numeric limits min-wins)"). Every declared security key is
 * exactly one of these three kinds; keys outside this declared set follow
 * plain CLI→env→project→user→defaults precedence (see `precedence.ts`).
 */
export const SECURITY_KEY_KINDS = ["denyList", "booleanOneWay", "numericMinWins"] as const;
export const SecurityKeyKindSchema = z.enum(SECURITY_KEY_KINDS);
export type SecurityKeyKind = z.infer<typeof SecurityKeyKindSchema>;

/**
 * A deny-list security key: every layer's array for this key is a set of
 * additions, never a full override. The resolved value is the UNION of
 * every layer's array — accumulate-only. There is no "remove" operation,
 * by design: no layer, however high its precedence, can shrink the
 * resolved deny list below what a lower-precedence layer already added
 * ("higher layers cannot remove entries added below").
 */
export const DenyListSecurityKeyDeclarationSchema = z.object({
  kind: z.literal("denyList"),
  key: z.string().min(1),
});
export type DenyListSecurityKeyDeclaration = z.infer<typeof DenyListSecurityKeyDeclarationSchema>;

/**
 * A one-way boolean security key: `secureValue` names the boolean state
 * that is "more restrictive." Resolution can only move toward
 * `secureValue`. Once any layer explicitly sets `secureValue`, a
 * higher-precedence layer explicitly setting the opposite value is a
 * rejected loosening attempt — `resolveConfig` throws
 * `SecurityKeyLoosenedError` (roadmap/02 work item 8's failing-first
 * fixture: "a config stack that lowers a security-key boolean must be
 * rejected"; Test plan Security bullet: "asserting the resolver always
 * rejects").
 */
export const BooleanSecurityKeyDeclarationSchema = z.object({
  kind: z.literal("booleanOneWay"),
  key: z.string().min(1),
  secureValue: z.boolean(),
});
export type BooleanSecurityKeyDeclaration = z.infer<typeof BooleanSecurityKeyDeclarationSchema>;

/**
 * A min-wins numeric security key (e.g. a concurrency or turn-count cap):
 * the resolved value is the minimum across every layer that declares it —
 * the most restrictive number wins regardless of layer rank. A
 * higher-precedence layer explicitly declaring a larger (looser) number
 * than a lower-precedence layer's smaller (tighter) one is a rejected
 * loosening attempt, exactly like the boolean case.
 */
export const NumericSecurityKeyDeclarationSchema = z.object({
  kind: z.literal("numericMinWins"),
  key: z.string().min(1),
});
export type NumericSecurityKeyDeclaration = z.infer<typeof NumericSecurityKeyDeclarationSchema>;

export const SecurityKeyDeclarationSchema = z.discriminatedUnion("kind", [
  DenyListSecurityKeyDeclarationSchema,
  BooleanSecurityKeyDeclarationSchema,
  NumericSecurityKeyDeclarationSchema,
]);
export type SecurityKeyDeclaration = z.infer<typeof SecurityKeyDeclarationSchema>;

/**
 * The product's own declared security-key set (roadmap/02 §In scope: "A
 * DECLARED security-key set..."). This phase ships shapes and invariants,
 * not behavior (§Out of scope), so this default set is illustrative of the
 * kind of key this resolver protects, grounded in concepts named in
 * docs/claude-code-adaptation.md — deny-by-default permission rules (§1,
 * §4.1), the OS sandbox (§4.2), and `--max-turns`/4-way concurrency
 * (§1, §5.7) — without this phase implementing any of that behavior
 * itself. Downstream phases (03/06) own the actual envelope/permission
 * compiler and may declare their own additional keys; `resolveConfig`
 * accepts any `SecurityKeyDeclaration[]`, not only this default set.
 */
export const DEFAULT_SECURITY_KEY_DECLARATIONS: readonly SecurityKeyDeclaration[] = [
  { kind: "denyList", key: "deniedToolPatterns" },
  { kind: "booleanOneWay", key: "requireApprovalForHighImpact", secureValue: true },
  { kind: "booleanOneWay", key: "sandboxEnabled", secureValue: true },
  { kind: "numericMinWins", key: "maxConcurrentWorkers" },
  { kind: "numericMinWins", key: "maxTurnsPerWorker" },
];
