/**
 * Attempt-token generation — roadmap/07-git-control-repo-worktrees.md work
 * item 6 / §Risks: "The exact `<attempt>` token format is this phase's own
 * to define and is not itself a cross-phase contract; 13 supplies the
 * value, this phase only guarantees uniqueness."
 *
 * CHOSEN FORMAT (documented deviation/own-authority choice — see
 * docs/evidence/phase-07/README.md): `att-<epoch-millis base36>-
 * <8-hex-random>`. Lowercase alphanumerics and hyphens only, so it is
 * always a valid single git ref path segment (no `/`, `~`, `^`, `:`, `?`,
 * `*`, `[`, no leading/trailing `.`, no `..`). Uniqueness: a millisecond
 * timestamp (nearly always monotonically distinct across calls) PLUS 32
 * bits of randomness — even two calls landing in the exact same
 * millisecond collide only with probability ~2^-32 per pair, which is what
 * "guarantee uniqueness" means in practice here (not a registry-backed
 * hard guarantee, but the same standard this repo's UUID-based `IdSchema`
 * already relies on).
 */

import { randomBytes } from "node:crypto";

export type ClockFn = () => number;
export type RandomHexFn = (byteLength: number) => string;

function defaultRandomHex(byteLength: number): string {
  return randomBytes(byteLength).toString("hex");
}

export function generateAttemptToken(
  clock: ClockFn = Date.now,
  randomHex: RandomHexFn = defaultRandomHex,
): string {
  const timestampSegment = clock().toString(36);
  const randomSegment = randomHex(4); // 4 bytes = 8 hex chars = 32 bits
  return `att-${timestampSegment}-${randomSegment}`;
}
