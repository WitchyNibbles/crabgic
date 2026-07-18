/**
 * SHA-256 hash-chain primitives — roadmap/04-journal-idempotency-leases.md
 * §In scope: "SHA-256 hash chain (`prevHash`/`hash` per entry)"; work item
 * 1: "hash covers everything except `hash` itself; genesis prevHash
 * documented constant."
 *
 * CANONICAL SERIALIZATION (documented per this worker's brief, "define
 * stable key order explicitly"):
 *   - Object keys are sorted in ascending order by `Array.prototype.sort`'s
 *     default (UTF-16 code-unit) comparator, applied recursively at every
 *     nesting level, including inside array elements.
 *   - Arrays preserve their given order — index position is semantically
 *     meaningful (e.g. `requirementIds`), never reordered.
 *   - A `undefined`-valued object property is omitted entirely, matching
 *     `JSON.stringify`'s own default behavior — an explicit `field:
 *     undefined` and an absent field canonicalize (and therefore hash)
 *     identically.
 *   - Strings/numbers/booleans/null serialize via `JSON.stringify`.
 * `computeEntryHash` hashes the ENTIRE entry object except the `hash`
 * field itself — every other field (schemaVersion, seq, type, payload,
 * prevHash, timestamp, and the optional runId/changeSetId/workUnitId
 * correlation fields) is included.
 */

import { createHash } from "node:crypto";

/**
 * The documented genesis constant: the `prevHash` of the very first entry
 * ever appended to a journal (seq `FIRST_SEQ`, see `../codec/journal-
 * entry.ts`). 64 lowercase hex `0` characters — the same length as a real
 * SHA-256 digest, so `HashHexSchema` accepts it without a special case.
 */
export const GENESIS_PREV_HASH = "0".repeat(64);

/** Canonical, deterministic JSON serialization — see file-level doc comment for the exact key-order rule. */
export function canonicalize(value: unknown): string {
  if (value === null || value === undefined) {
    return "null";
  }
  if (typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError(`journal: cannot canonicalize non-finite number ${String(value)}`);
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalize(item)).join(",")}]`;
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record)
      .filter((key) => record[key] !== undefined)
      .sort();
    const parts = keys.map((key) => `${JSON.stringify(key)}:${canonicalize(record[key])}`);
    return `{${parts.join(",")}}`;
  }
  throw new TypeError(`journal: cannot canonicalize value of type ${typeof value}`);
}

/** Lowercase hex SHA-256 digest of a UTF-8 string. */
export function sha256Hex(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

/** Returns a shallow copy of `entry` with the `hash` key removed entirely (not present-as-undefined). */
export function omitHashField(entry: Record<string, unknown>): Record<string, unknown> {
  const copy: Record<string, unknown> = {};
  for (const key of Object.keys(entry)) {
    if (key === "hash") continue;
    copy[key] = entry[key];
  }
  return copy;
}

/**
 * Computes the chain hash for an entry: SHA-256 hex digest of the
 * canonical serialization of every field except `hash`. Safe to call
 * whether or not `entryWithoutFinalHash` already carries a `hash` key
 * (it is stripped either way).
 */
export function computeEntryHash(entryWithoutFinalHash: Record<string, unknown>): string {
  return sha256Hex(canonicalize(omitHashField(entryWithoutFinalHash)));
}
