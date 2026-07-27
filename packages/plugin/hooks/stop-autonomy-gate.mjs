#!/usr/bin/env node
/**
 * The manager autonomy gate — a BLOCKING `Stop` hook.
 *
 * WHAT IT DOES. When the manager session tries to end a turn, this hook asks
 * the supervisor whether any run is still in flight. If one is, it refuses to
 * let the turn end and tells the model to carry on. If a run is parked at a
 * human gate (`awaiting_approval`), or has reached a terminal state, or there
 * is no run at all, it stays out of the way.
 *
 * WHY IT EXISTS. `src/manager-protocol.ts` tells the manager to be autonomous
 * and to stop only for one of roadmap/11's seven stop conditions. That is
 * prose, and prose is a request. Reported from real use in a consuming repo:
 * the manager asked the owner to type "continue" after every step anyway.
 * This hook is the deterministic half — the protocol says what should happen,
 * this makes the "don't stop mid-run" part actually stick.
 *
 * SCOPE AMENDMENT. roadmap/10 originally scoped manager hooks as advisory and
 * non-blocking. This one blocks, deliberately; see `src/hooks-manifest.ts` for
 * the amendment note and roadmap/10 for the governed change. `PreToolUse` is
 * still forbidden in the manager context — blocking a turn from ENDING is
 * bounded and has an engine-provided loop guard; blocking arbitrary tool calls
 * is neither.
 *
 * ENGINE CONTRACT. `docs/engine-baseline.md` §19, probe `spikes/10-stop-hook.mjs`,
 * verified at engine 2.1.220:
 *   - §19.1 `{"decision":"block","reason":R}` on stdout prevents the turn
 *     ending, and R reaches the model as its next instruction.
 *   - §19.2 `stop_hook_active` is `true` on the re-entered Stop event. This is
 *     the loop guard, and it is the reason this hook cannot wedge a session.
 *   - §19.3 the payload carries `cwd`; this hook falls back to `process.cwd()`
 *     if it ever does not.
 *
 * FAILS OPEN, ALWAYS. Every error path — no CLI, no supervisor, a timeout,
 * malformed JSON, an unrecognized state — ends the turn normally. A hook that
 * runs on every session end in every project must never be able to trap a
 * session, so "I could not determine the answer" always resolves to "let it
 * stop". The cost of a false negative is one unnecessary "continue"; the cost
 * of a false positive is a session the owner cannot get out of.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * Run-lifecycle states that mean work is still owed.
 *
 * Mirrors `RUN_LIFECYCLE_STATES` in `@crabgic/contracts`
 * (`src/state-machines/run-lifecycle.ts`). This file is a plain `.mjs` loaded
 * directly by the engine and cannot import the workspace package, so the lists
 * are restated here and a parity test
 * (`src/stop-autonomy-gate.test.ts`) fails if they ever drift.
 */
export const IN_FLIGHT_STATES = Object.freeze([
  "draft",
  "ready",
  "running",
  "verifying",
  "integrating",
  "final_verifying",
]);

/**
 * States where ending the turn is correct.
 *
 * `awaiting_approval` is the interesting one: a run parked there is waiting on
 * a human act the model is structurally forbidden from performing
 * (adaptation §5.5). Blocking the turn would trap the owner in a session whose
 * only exit is the thing the block prevents them from reaching. The other four
 * are the absorbing states — `published_local` (success) plus the three
 * terminals.
 */
export const STOPPABLE_STATES = Object.freeze([
  "awaiting_approval",
  "published_local",
  "failed",
  "blocked",
  "cancelled",
]);

const CLI_TIMEOUT_MS = 4000;

/** Reads the hook payload. Any failure yields `{}`, which the caller treats as "cannot determine → allow stop". */
export function readPayload(readFd = () => readFileSync(0, "utf8")) {
  try {
    const raw = readFd();
    if (typeof raw !== "string" || raw.trim().length === 0) return {};
    const parsed = JSON.parse(raw);
    return parsed !== null && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

/**
 * The pure decision. Exported so it can be unit-tested without a supervisor,
 * a CLI, or an engine.
 *
 * @param payload the Stop hook payload (§19.3)
 * @param runs whatever `crabgic status --json` returned, or `null` if it could
 *   not be obtained for ANY reason
 * @returns `null` to allow the turn to end, or a block decision object
 */
export function decideStopAction(payload, runs) {
  // §19.2 loop guard. Checked FIRST, before anything else can go wrong: if we
  // already blocked once, the model has had its instruction and the turn ends
  // regardless of what the supervisor now says.
  if (payload?.stop_hook_active === true) return null;

  // Could not determine run state — fail open.
  if (!Array.isArray(runs)) return null;

  const inFlight = runs.filter(
    (run) => run && typeof run.state === "string" && IN_FLIGHT_STATES.includes(run.state),
  );
  if (inFlight.length === 0) return null;

  return { decision: "block", reason: buildBlockReason(inFlight) };
}

/**
 * The `reason` string, which §19.1 confirms is delivered to the model as its
 * next instruction. It has to do two things: say what is still owed, and say
 * what "keep going" means — including the one legitimate way out, so a genuine
 * blocker is not mistaken for a reason to stall.
 */
export function buildBlockReason(inFlightRuns) {
  const described = inFlightRuns
    .map((run) => `${run.runId ?? "(unknown run)"} is ${run.state}`)
    .join("; ");
  const plural = inFlightRuns.length === 1 ? "run is" : "runs are";

  return (
    `Crabgic ${plural} still in flight: ${described}. ` +
    `Do not end the turn and do not ask the owner whether to continue — driving this to ` +
    `completion is your job, not theirs. Keep working: check \`/eo:status\`, act on whatever ` +
    `the run needs next, and only stop when the run reaches a terminal state or parks at an ` +
    `approval gate. If you are genuinely blocked, say which of the seven stop conditions ` +
    `fired and why (see \`/eo:protocol\`) — and if it is an irreducible product decision, ` +
    `ask it with the AskUserQuestion tool rather than as a plain-text list of options.`
  );
}

/**
 * Locates the `crabgic` CLI.
 *
 * In the published layout the plugin is vendored inside the CLI package
 * (`dist/plugin/hooks/` here, `dist/bin.js` two levels up), so the sibling
 * binary is preferred — it is the CLI that shipped with this exact plugin
 * build, and needs no `PATH`. In a monorepo checkout that file does not exist
 * and we fall back to `PATH`.
 */
export function resolveCliCommand(exists = existsSync, moduleUrl = import.meta.url) {
  try {
    const vendored = fileURLToPath(new URL("../../bin.js", moduleUrl));
    if (exists(vendored)) return { command: process.execPath, args: [vendored] };
  } catch {
    /* fall through to PATH */
  }
  return { command: "crabgic", args: [] };
}

/**
 * Asks the CLI for run state, passively.
 *
 * `CRABGIC_NO_SPAWN=1` is load-bearing: without it, a Stop hook firing in a
 * project that has never run Crabgic would BOOT A SUPERVISOR DAEMON as a side
 * effect of a session ending, and would stall the turn for the full
 * spawn-and-retry budget before concluding there was nothing to report. See
 * `packages/cli/src/uds-client/passive-mode.ts`.
 *
 * Returns an array of run records, or `null` if state could not be determined
 * for any reason at all.
 */
export function queryRuns(cwd, run = spawnSync, resolve = resolveCliCommand) {
  const { command, args } = resolve();
  let result;
  try {
    result = run(command, [...args, "status", "--json"], {
      cwd,
      encoding: "utf8",
      timeout: CLI_TIMEOUT_MS,
      env: { ...process.env, CRABGIC_NO_SPAWN: "1" },
    });
  } catch {
    return null;
  }

  if (!result || result.error || result.status !== 0) return null;

  try {
    const parsed = JSON.parse(result.stdout);
    return Array.isArray(parsed?.runs) ? parsed.runs : null;
  } catch {
    return null;
  }
}

/**
 * Wires the pieces together. Every collaborator is injectable so the whole
 * path — including "which cwd did it ask about" and "what did it write" — is
 * testable without an engine, a CLI, or a supervisor.
 */
export function main({
  read = readPayload,
  query = queryRuns,
  write = (s) => process.stdout.write(s),
} = {}) {
  const payload = read();

  // Cheap exit before spawning anything: on re-entry there is nothing to do.
  if (payload?.stop_hook_active === true) return;

  // §19.3 records `cwd` as present on the payload; this is the documented
  // fallback for the case it ever is not.
  const cwd =
    typeof payload.cwd === "string" && payload.cwd.length > 0 ? payload.cwd : process.cwd();
  const runs = query(cwd);
  const decision = decideStopAction(payload, runs);
  if (decision !== null) {
    write(JSON.stringify(decision));
  }
}

// Only run when executed as the hook, not when imported by tests.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    main();
  } catch {
    /* fail open: never let this hook's own failure trap a session */
  }
  process.exitCode = 0;
}
