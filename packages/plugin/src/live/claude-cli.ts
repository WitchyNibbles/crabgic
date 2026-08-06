/**
 * The one place this package names the Claude Code CLI binary, and the
 * bounds every live invocation of it must carry.
 *
 * WHY A CONSTANT. Both live probes (`plugin-load.live.test.ts`,
 * `plugin-inventory-probe.ts`) `execFile` a BARE name resolved from `PATH`.
 * That is deliberate — `claude plugin details --plugin-dir` is exactly the
 * command a user runs, and the SDK's bundled binary is not on `PATH` and
 * exports no `bin` — but it means the `engine-live` CI job MUST put a
 * `claude` on `PATH` itself or every plugin case ENOENTs. The binding is
 * asserted per push by `../engine-live-workflow.test.ts`, which reads the
 * real workflow file and checks that the step provisioning the CLI proves
 * THIS name resolvable. Producer and consumer therefore cannot drift apart
 * silently, which is how the lane came to be unrunnable in the first place
 * (defect `06-engine-live-plugin-cli-unresolvable-on-ci`).
 */
export const CLAUDE_CLI_BIN = "claude";

/**
 * Model pinned for the PARENT turn of the subagent-spawn probe.
 *
 * `haiku` is a valid `--model` alias on the pinned engine — measured
 * 2026-08-06 by reading the alias table out of the 2.1.218 binary bundled
 * with `@anthropic-ai/claude-agent-sdk` (`["sonnet","opus","haiku","fable",
 * "best",…]`); `claude --help` on the same binary documents `--model
 * <model>` as single-arity, so it is not exposed to the variadic-flag
 * hazard `docs/engine-baseline.md` §15 records for `--allowedTools`.
 * Transcript: `docs/evidence/phase-10/live-lane-preconditions-batchK.txt`.
 *
 * Pinning it is a cost control and a reproducibility control: an unpinned
 * parent runs on whatever the host default is, which on the one measured
 * run was NOT the model the probe was written against.
 *
 * `haiku` is the cheapest alias and the one phase 00's whole spike suite ran
 * on, so it is the default choice. It is ALSO the least capable orchestrator
 * of the three, and this case asks its parent to route a `Task` call. If an
 * owner-dispatched run shows the parent failing to delegate rather than the
 * plugin failing to load, move this one constant to `"sonnet"` — that is the
 * intended escape hatch, and it is one line precisely so the diagnosis and
 * the fix stay separable.
 */
export const SPAWN_PROBE_MODEL = "haiku";

/**
 * Hard dollar ceiling for the subagent-spawn probe's own turn.
 *
 * `--max-budget-usd <amount>` is present in `claude --help` at the pinned
 * 2.1.218 (measured, same transcript) and is the CLI's own documented cost
 * bound — `--max-turns` is NOT: `docs/engine-baseline.md` §10 records it
 * absent from the CLI surface since 2.1.210, and it would not have helped
 * anyway, because a `Task` spawn's turns live in a nested subagent loop
 * that never reaches the top-level counter.
 *
 * 0.50 is chosen to bite a runaway and not a healthy run. A bounded run of
 * this probe is a parent turn plus a subagent listing two files — cents.
 * The measured runaway (~51 nested haiku round trips walking a monorepo,
 * `docs/verification-playbook.md` §BOUNDING A SUBAGENT-SPAWNING TEST) grows
 * context every turn and lands in dollars, not cents.
 */
export const SPAWN_PROBE_MAX_BUDGET_USD = "0.50";

/**
 * Wall-clock ceiling for the subagent-spawn probe, in milliseconds.
 *
 * The previous value was 120_000 in a run that needed ~185s: the case went
 * RED on its own timeout while the subject under test held (the engine
 * transcript showed `spawnDepth: 1` and the parent naming the subagent).
 * 240_000 clears the measured need with margin and still lands INSIDE
 * `vitest.live.config.ts`'s 300_000 `testTimeout`, which is the property
 * that matters: `execFile`'s timeout kills the child it spawned, whereas
 * vitest's timeout only abandons the promise and leaves the engine running
 * — a wrapper timeout is UNKNOWN cost, never bounded cost.
 *
 * The engine is spawned directly (`execFile`, no shell), so the child that
 * receives the kill signal is the engine itself; the orphaned-process-group
 * hazard the playbook records applies to a wrapper script standing between
 * the two, which this probe deliberately does not have.
 */
export const SPAWN_PROBE_TIMEOUT_MS = 240_000;
