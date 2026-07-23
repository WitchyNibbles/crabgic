/**
 * stdout/stderr/exit-code conventions — roadmap/09-cli-and-doctor.md
 * §Conventions: "stdout = result (human or `--json`), stderr = diagnostics;
 * stable exit codes." Every command handler builds one `CommandResult`;
 * `../bin.ts` is the sole place that actually writes to the real
 * `process.stdout`/`process.stderr` and calls `process.exit`.
 */

export interface CommandResult {
  readonly exitCode: number;
  /** Written to stdout, if present — the command's own result (human-readable or `--json`). */
  readonly stdout?: string;
  /** Written to stderr, if present — diagnostics only, never the primary result. */
  readonly stderr?: string;
}

/** Deterministic, stable JSON formatting (2-space indent, trailing newline) for every `--json` output across every command — snapshot-tested by `../commands/cli.snapshots.test.ts`. */
export function formatJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}
