/**
 * Checksum/drift hash stability — roadmap/10-plugin-and-installer.md §Test
 * plan, Unit: "checksum/drift hash stability across line-ending
 * normalization." Every installer-owned artifact's checksum is computed
 * over CRLF-normalized content so a `git`/editor-driven line-ending
 * conversion is never mistaken for real drift.
 */
import { createHash } from "node:crypto";

/** Normalizes CRLF → LF before hashing — the ONLY normalization applied; content is otherwise hashed byte-for-byte (no trimming, no whitespace collapsing). */
export function normalizeForChecksum(content: string): string {
  return content.replace(/\r\n/g, "\n");
}

/** A stable sha256 hex checksum of `content`, line-ending-normalized first. */
export function computeChecksum(content: string): string {
  return createHash("sha256").update(normalizeForChecksum(content)).digest("hex");
}
