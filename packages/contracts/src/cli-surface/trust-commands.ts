/**
 * The three `trust` command shapes — roadmap/12-stack-detection-quarantine.md's
 * human-only approval surface (`trust review` / `trust approve` /
 * `trust revoke`), parsed by `crabgic`'s
 * `argv/parse-command.ts` and consumed by the backends in
 * `@crabgic/detect`'s `trust/`.
 *
 * WHY THESE THREE LIVE IN `@crabgic/contracts` (2026-07-25): they are the only
 * members of the CLI's `ParsedCommand` union whose backend is implemented
 * outside `packages/cli`. Phase 12 owns the trust backends ("implementation
 * stays in `packages/detect`"), so it needs the command shape it is handed;
 * importing it from the CLI package closed a cycle (`cli -> learning ->
 * gates -> detect -> cli`) that made `tsc -b` fail from a clean checkout.
 * The remaining command types stay in `argv/types.ts`, which imports these
 * three back and keeps the `ParsedCommand` union in one place.
 */

/** The `--json` flag every command carries. Named distinctly from the CLI's own package-private `JsonFlag` so the two never collide in the `@crabgic/contracts` barrel. */
export interface CommandJsonFlag {
  readonly json: boolean;
}

export interface TrustReviewCommand extends CommandJsonFlag {
  readonly command: "trust-review";
}

export interface TrustApproveCommand extends CommandJsonFlag {
  readonly command: "trust-approve";
  readonly digest: string;
}

export interface TrustRevokeCommand extends CommandJsonFlag {
  readonly command: "trust-revoke";
  readonly tokenId: string;
}
