/**
 * ndjson line codec — roadmap/04-journal-idempotency-leases.md §Interfaces
 * produced: "Journal on-disk format: ndjson, one `JournalEntry` per line."
 *
 * See docs/evidence/phase-04/wi1-codec-failing.txt for the failing-first
 * evidence captured against the prior stub (`decodeLine`/`tryDecodeLine`
 * always throwing/reporting failure regardless of input) before this real
 * implementation landed.
 */

import { toErrorMessage } from "./error-message.js";
import { JournalEntrySchema, type JournalEntry } from "./journal-entry.js";

/** Serializes one `JournalEntry` to its ndjson line form (a single JSON object, newline-terminated). */
export function encodeEntryToLine(entry: JournalEntry): string {
  return `${JSON.stringify(entry)}\n`;
}

export interface DecodeLineResult {
  readonly ok: boolean;
  readonly entry?: JournalEntry;
  readonly error?: string;
}

/** Parses and validates one ndjson line (without its trailing newline) as a `JournalEntry`. Throws on failure. */
export function decodeLine(line: string): JournalEntry {
  const parsed: unknown = JSON.parse(line);
  return JournalEntrySchema.parse(parsed);
}

/** Tolerant variant of `decodeLine` — never throws, reports failure via the returned result instead. Used by the read paths (query/verify) that must skip or report a bad line rather than crash. */
export function tryDecodeLine(line: string): DecodeLineResult {
  try {
    return { ok: true, entry: decodeLine(line) };
  } catch (err) {
    return { ok: false, error: toErrorMessage(err) };
  }
}

/** Re-exported so callers of this module don't need a second import for the schema the codec validates against. */
export { JournalEntrySchema };
