/**
 * Model router — roadmap/13-scheduler-packets-context.md §In scope, "Model
 * routing": "role -> alias map (balanced defaults: `sonnet` implementation
 * workers, `opus` architect/planner + integration/security review, `haiku`
 * mechanical chores, adaptation §0); overrides only via the approved
 * envelope; resolved at dispatch time, immediately before the call into
 * 06's spawn surface."
 *
 * OVERRIDE SOURCE (documented deviation): neither `WorkUnit` (02) nor
 * `AuthorizationEnvelope` (02) carries a dedicated model-override field —
 * no cited source material pins one (`@eo/contracts`'s own `WorkUnit.role`
 * doc comment: "No closed role vocabulary is pinned anywhere this phase
 * owns," and `AuthorizationEnvelope`'s schema has no model-related field at
 * all). This router is therefore agnostic to WHERE an override value came
 * from — it accepts one as a plain parameter and gives it unconditional
 * precedence over the role-alias map, satisfying "overrides only via the
 * approved envelope" for whatever later phase threads an envelope-derived
 * override string into that parameter (a carry-forward wiring detail, not
 * a routing-policy gap).
 */

import { z } from "zod";

export const MODEL_ALIASES = ["sonnet", "opus", "haiku"] as const;
export type ModelAlias = (typeof MODEL_ALIASES)[number];

/** Balanced default (adaptation §0) — ordinary implementation work. */
export const DEFAULT_MODEL_ALIAS: ModelAlias = "sonnet";

/**
 * Roles this phase's own balanced-default map recognizes, matched
 * case-insensitively against `WorkUnit.role` (a free-text field, per 02's
 * own doc comment) — any role NOT in this map falls back to
 * `DEFAULT_MODEL_ALIAS`. No closed role vocabulary is pinned anywhere this
 * phase owns either; this is this phase's own minimal-sufficient default
 * set, drawn directly from adaptation §0's named examples.
 */
const DEFAULT_ROLE_ALIAS_MAP: Readonly<Record<string, ModelAlias>> = {
  architect: "opus",
  planner: "opus",
  integration_review: "opus",
  security_review: "opus",
  mechanical_chore: "haiku",
  chore: "haiku",
  implementation: "sonnet",
};

export const RouterConfigSchema = z
  .object({
    roleAliasMap: z.record(z.string(), z.enum(MODEL_ALIASES)).default({}),
  })
  .strict();
export type RouterConfig = z.infer<typeof RouterConfigSchema>;

export const DEFAULT_ROUTER_CONFIG: RouterConfig = { roleAliasMap: DEFAULT_ROLE_ALIAS_MAP };

function normalizeRole(role: string): string {
  return role
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
}

/**
 * Resolves the model alias for `role`, immediately before dispatch:
 * 1. `override`, if supplied, ALWAYS wins (unconditional precedence — "the
 *    approved envelope" case, whatever wiring supplies it).
 * 2. Otherwise, `config.roleAliasMap`'s entry for the normalized `role`.
 * 3. Otherwise, `DEFAULT_MODEL_ALIAS`.
 */
export function resolveModelForRole(
  role: string,
  config: RouterConfig = DEFAULT_ROUTER_CONFIG,
  override?: string,
): string {
  if (override !== undefined) return override;
  const normalized = normalizeRole(role);
  return config.roleAliasMap[normalized] ?? DEFAULT_MODEL_ALIAS;
}
