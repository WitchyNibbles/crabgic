/**
 * `presentation` — a module inside `packages/contracts` (never a standalone
 * package, in the manner of `renderer-core` per interface-ledger Gap 3 and
 * of `cli-surface`), housing the owner-facing presentation contract:
 * the semantic glyph vocabulary, the human-report structure limits, and
 * profile resolution.
 *
 * Consumed by `packages/cli` (human-mode stdout) and `packages/plugin` (the
 * manager session's operating protocol). Deliberately NOT consumed by
 * `packages/renderer`, whose outbound artifacts stay neutral and emoji-free
 * under `CommunicationPolicy`. See `docs/presentation-policy.md`.
 */
export * from "./glyphs.js";
export * from "./colors.js";
export * from "./profile.js";
export * from "./presentation-policy.js";
