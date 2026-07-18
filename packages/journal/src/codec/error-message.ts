/** Shared `catch (err)` normalizer: `err.message` for a real `Error`, `String(err)` for anything else (a thrown string/object/etc). Extracted so both branches are directly unit-testable without needing to coerce `JSON.parse`/zod's own throws (always real `Error`s) into throwing a non-Error. */
export function toErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
