/**
 * Passive-mode opt-in for supervisor connections.
 *
 * A passive caller wants to OBSERVE whether a supervisor is already running,
 * and must never cause one to exist. The manager Stop hook
 * (`packages/plugin/hooks/stop-autonomy-gate.mjs`) is the motivating case: it
 * runs on every session end — including in projects that have never started a
 * Crabgic run — and asks the CLI "is a run still in flight?". Under the
 * ordinary spawn-on-demand policy that question would boot a daemon as a side
 * effect of a session ending, and would burn the full retry budget
 * (25 attempts x 200ms) before concluding what a single failed connect already
 * proves.
 *
 * Delivered as an environment variable rather than a CLI flag deliberately:
 * it applies to whatever command the hook runs, needs no argv surface (and so
 * no `--help`/snapshot churn in roadmap/09's parser), and is inherited by the
 * child process the hook spawns without the hook having to know which
 * subcommand it is invoking.
 */
export const PASSIVE_MODE_ENV_VAR = "CRABGIC_NO_SPAWN";

/**
 * True when the environment opts into passive mode.
 *
 * Deliberately strict: only `"1"` and `"true"` (case-insensitive) enable it.
 * An unset, empty, or unrecognized value leaves the default spawn-on-demand
 * behavior alone, so a stray export can never silently stop the CLI from
 * starting the daemon it needs for ordinary work.
 */
export function isPassiveMode(env: Readonly<Record<string, string | undefined>>): boolean {
  const raw = env[PASSIVE_MODE_ENV_VAR];
  if (typeof raw !== "string") return false;
  const normalized = raw.trim().toLowerCase();
  return normalized === "1" || normalized === "true";
}
