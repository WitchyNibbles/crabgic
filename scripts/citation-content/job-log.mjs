/**
 * Job-log line normalization, for `ci-run` citations.
 *
 * A `ci-run` citation quotes a line of a GitHub Actions job log. Neither
 * `check-citation-runs.mjs` (which checks the run URL) nor
 * `check-criteria-closeout.mjs` (which checks the record's shape) ever compares
 * that quoted text against the log, so a wrong quote survives merge — one pass
 * found 16 of its own 18 quotes wrong.
 *
 * Comparing them is not as simple as a byte-compare, and this bit two separate
 * agents in one wave:
 *
 * - The RAW downloaded line is `<ISO timestamp> <content>`, and the content
 *   vitest emits is **ANSI-colored** (`[32m✓[39m …`). A byte-compare
 *   against a record's plain-text quote fails on EVERY line, so a naive checker
 *   reports total corruption and gets disbelieved.
 * - GitHub's separator between timestamp and content is **one** space, and
 *   vitest's own content then starts with one more space before the tick. The
 *   one-space form (strip the timestamp and exactly one separator) is strictly
 *   correct. **Twelve merged records use a two-space form** that absorbs the
 *   separator into the quote. Both are contiguous substrings of the raw line, so
 *   no merged record is false — the two-space form is grandfathered, not
 *   retrofitted (`docs/verification-playbook.md`, "Whitespace ruling").
 *
 * This module is deliberately I/O-free: it normalizes strings. Comparing against
 * a real log needs the log, which needs a token and the network — outside what
 * `meta-checks` may do, and outside what a unit suite may do — so it is driven
 * from `--report --job-logs <dir>` over logs a closeout pass has already
 * downloaded (`gh api .../jobs/<id>/logs > <dir>/<id>.txt`). No CI lane consumes
 * it; that is a deliberate boundary, not an oversight.
 */

/** CSI/OSC escape sequences, as emitted by vitest's reporter. */
// eslint-disable-next-line no-control-regex -- matching the ESC byte is the point
const ANSI = /\[[0-9;?]*[ -/]*[@-~]|\][^]*(?:|\\)/g;
const LEADING_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d+Z /;

export function stripAnsi(line) {
  return line.replace(ANSI, "");
}

/**
 * The strictly-correct form: ANSI removed, ISO timestamp and its ONE separating
 * space removed. Trailing `\r` (GitHub serves CRLF) removed.
 */
export function normalizeJobLogLine(rawLine) {
  return stripAnsi(rawLine).replace(/\r$/, "").replace(LEADING_TIMESTAMP, "");
}

/**
 * Does a record's quoted line match this raw log line?
 *
 * Returns the form that matched — `"one-space"` (correct),
 * `"two-space"` (grandfathered: the quote kept the separator), or `null`.
 * Containment rather than equality, because records quote a line's distinctive
 * middle as often as the whole of it.
 */
export function matchJobLogLine(rawLine, quoted) {
  const normalized = normalizeJobLogLine(rawLine);
  if (normalized.includes(quoted)) return "one-space";
  if (` ${normalized}`.includes(quoted)) return "two-space";
  return null;
}
