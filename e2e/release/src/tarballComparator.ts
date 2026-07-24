import { createHash } from "node:crypto";
import { readTarballBytes } from "./packRunner.js";

/**
 * The tarball-hash comparator — roadmap/23-release-hardening.md work item
 * 10: "compare tarball content hashes byte-for-byte; FAIL-CLOSED if they
 * differ." This module never trusts `npm`'s own self-reported `shasum`
 * alone (that value is npm's own claim about its own output) — it reads
 * BOTH tarballs' raw bytes back off disk and computes an INDEPENDENT
 * sha256 over them itself, so a bug in `npm`'s own reporting could never
 * mask a real mismatch.
 */

export interface TarballComparisonResult {
  readonly match: boolean;
  readonly hashA: string;
  readonly hashB: string;
  readonly sizeA: number;
  readonly sizeB: number;
}

/** Computes sha256 over `tarballPath`'s raw bytes and reports its size — the two facts `compareTarballs` needs per side. */
export async function hashTarball(
  tarballPath: string,
): Promise<{ readonly hash: string; readonly size: number }> {
  const bytes = await readTarballBytes(tarballPath);
  return { hash: createHash("sha256").update(bytes).digest("hex"), size: bytes.length };
}

/**
 * FAIL-CLOSED comparison: `match` is `true` if and only if both tarballs'
 * independently-computed sha256 digests are byte-identical. Any
 * difference — including a size mismatch, which this also reports
 * directly, never inferred solely from unequal hashes — reports
 * `match: false`. Never throws for a genuine mismatch (a mismatch is an
 * ordinary, expected outcome this function reports structurally); it DOES
 * propagate a read error (e.g. a missing tarball path) rather than
 * silently treating an unreadable file as "match: false", since that
 * would risk masking a broken pipeline as a mismatch instead of a hard
 * tooling failure.
 */
export async function compareTarballs(
  tarballPathA: string,
  tarballPathB: string,
): Promise<TarballComparisonResult> {
  const [a, b] = await Promise.all([hashTarball(tarballPathA), hashTarball(tarballPathB)]);
  return {
    match: a.hash === b.hash,
    hashA: a.hash,
    hashB: b.hash,
    sizeA: a.size,
    sizeB: b.size,
  };
}
