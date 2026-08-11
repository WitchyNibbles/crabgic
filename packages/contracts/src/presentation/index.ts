/**
 * `presentation` — a module inside `packages/contracts` (never a standalone
 * package, in the manner of `renderer-core` per interface-ledger Gap 3 and
 * of `cli-surface`), housing the owner-facing presentation contract:
 * the semantic glyph vocabulary, the human-report structure limits, profile
 * resolution, and the renderers that enforce the limits.
 *
 * THE RENDERERS LIVE HERE, NOT IN `packages/cli` (relocated 2026-08-11, in the
 * manner of `cli-surface`'s `formatJson`/`CommandResult`). They started in
 * `packages/cli/src/output/`, which was correct while the CLI was the only
 * caller — then `trust review|approve|revoke`, whose backend is
 * `packages/detect`, needed the same shapes. `packages/cli` depends on
 * `packages/detect`, so the renderers could not be reached from there without
 * inverting that edge; the alternative was a second copy, and this document's
 * own warning about `crabgic-statusline.mjs` is what two copies cost. A
 * relocation into the package both already depend on is the pattern the repo
 * has used before for exactly this. `packages/cli/src/output/{human,reports}.ts`
 * re-export from here verbatim, so every existing import path still resolves.
 *
 * Consumed by `packages/cli` (human-mode stdout), `packages/detect` (the trust
 * commands) and `packages/plugin` (the manager session's operating protocol).
 * Deliberately NOT consumed by
 * `packages/renderer`, whose outbound artifacts stay neutral and emoji-free
 * under `CommunicationPolicy`. See `docs/presentation-policy.md`.
 */
export * from "./glyphs.js";
export * from "./colors.js";
export * from "./profile.js";
export * from "./presentation-policy.js";
export * from "./human-report.js";
export * from "./reports.js";
