# `@live plugin.live-smoke` — first execution against the FIVE-subagent plugin (2026-08-05)

<!-- prettier-ignore-start -->

```
# UPSTREAM BASE (stable — resolves for any reader, now and after merge): f985511ecdc1e3abb009498b6560a0994a665cb5
# branch tip at capture (PROVISIONAL — a pre-merge branch commit; see RULING-3): probe/r7-p2-and-plugin-smoke
# CAPTURED (UTC): 2026-08-05T15:38:51Z  (inventory at the pinned engine — zero model turns)
#                 2026-08-05T15:39:16Z … 15:41:34Z  (the scoped suite; the only model turns spent)
#                 2026-08-05T15:43:32Z  (the three zero-turn tests re-run individually, verbose)
#                 2026-08-05T15:43:58Z  (drift datapoint at the host CLI — zero model turns)
# ENGINE: 2.1.218 — `TESTED_ENGINE_VERSION`, inside the accepted 2.1.207–2.1.220 range.
#         Obtained by `npm pack @anthropic-ai/claude-code-linux-x64@2.1.218` into a scratch
#         directory and placed FIRST on PATH for the run. See §1: the host's own PATH CLI has
#         drifted to 2.1.221, which is OUTSIDE that range, so an unpinned run could not have
#         satisfied this criterion's "on the 06 baseline range" clause at all.
# LOAD at capture: load average 0.17 0.23 0.18 — no contention, so no flake caveat applies
# SCOPE: `packages/plugin/src/live/` ONLY — the 2 files there, not the 15 under
#        `packages/engine-claude/src/live/` that `vitest.live.config.ts` also includes (counted at
#        this branch). The `engine-live` job was NOT dispatched and MUST NOT be: it runs all 17.
# COMMAND: CRABGIC_LIVE=1 npx vitest run --config vitest.live.config.ts packages/plugin/src/live
# RESULT: 3 of 4 green. The fourth FAILED — on its own 120s execFile timeout, in a run that
#         needed ~185s. Its SUBJECT (a plugin subagent is spawnable) is nevertheless demonstrated
#         by the engine's own session transcript; see §3. This file does not tick anything.
```

<!-- prettier-ignore-end -->

Paths are elided as `<worktree>`; the host account name appears nowhere in this file.
**No secret content is quoted anywhere below** — the run touched no credential
material, and the only auth involved is the host's ambient login, which was never
read, printed or persisted.

---

## 1. Why the engine had to be pinned, and what it cost

The criterion says "in a real session **on the 06 baseline range**". The accepted
range is `2.1.207`–`2.1.220` (`packages/engine-claude/src/version-gate.ts`). The
host's `PATH` `claude` reports **2.1.221** — one patch above the maximum. The
plugin live suite resolves `claude` from `PATH` (`execFile("claude", …)`), so an
as-found run would have measured an out-of-range engine and evidenced nothing
about the clause.

So `@anthropic-ai/claude-code-linux-x64@2.1.218` was fetched into a scratch
directory and put first on `PATH` behind a small accounting wrapper. Two
verifications that this was safe, both measured:

- `claude --version` through the wrapper → `2.1.218 (Claude Code)`.
- The host's own `~/.claude` configuration is **unchanged** by the run: md5 of
  `settings.json`, `package.json` and all four `plugins/*.json` captured before
  and after are identical (6 of 6 files). A downgraded binary did not migrate
  anything.

## 2. Inventory — all three clauses, at the pinned engine, for zero turns

`claude --plugin-dir <worktree>/packages/plugin plugin details crabgic`, verbatim:

<!-- prettier-ignore-start -->

```
Component inventory
  Skills (6)  approve, connections, evidence, protocol, run, status
  Agents (5)  eo-explore, eo-roaster, eo-architect, eo-reviewer, eo-planner
  Hooks (2)  PostToolUse, Stop  (harness-only — no model context cost)
  MCP servers (1)  crabgic_gateway  (tool schemas resolved at runtime; not counted)
  LSP servers (0)
```

<!-- prettier-ignore-end -->

**This is the first time a real engine has been shown `eo-architect` and
`eo-planner`.** They were added on 2026-07-29, after the only prior recorded live
run (`docs/evidence/gap-18/live-verification.md`, 2026-07-28), which by its own
words describes a three-subagent plugin. `REQUIRED_SUBAGENT_NAMES` now has five
and the assertion loops it, so that loop has never before been evaluated in its
current form. All five are listed. **They work.**

The three suite cases that need no model turn, re-run individually with
`--reporter=verbose` so each one's own line is quotable:

<!-- prettier-ignore-start -->

```
 ✓ packages/plugin/src/live/plugin-load.live.test.ts > @live plugin.live-smoke — positive (plugin loaded via --plugin-dir) > `claude plugin validate` accepts this package's own manifest (non-strict: two known, intentional unknown-field warnings for the marketplace's own `commit`/`digest` extension fields) 1240ms
 ✓ packages/plugin/src/live/plugin-load.live.test.ts > @live plugin.live-smoke — positive (plugin loaded via --plugin-dir) > lists every required skill, subagent, and the gateway MCP server 2137ms
 ✓ packages/plugin/src/live/plugin-negative-space.live.test.ts > @live plugin.live-smoke — negative space (before install) > reports the plugin absent (no --plugin-dir, not otherwise installed): zero skills/agents/mcp servers 913ms
```

<!-- prettier-ignore-end -->

The negative-space case is a real negative here, not a vacuous one: the host has
two other plugins installed (`superpowers`, `ecc`) and no crabgic entry in
`~/.claude/plugins/installed_plugins.json`, so "absent" was measured against a
populated registry.

**Minor accuracy note, reported rather than fixed:** the first case's own title
says "two known, intentional unknown-field warnings". `claude plugin validate`
emits **three** warnings — `digest`, `commit`, and `plugin.json → version: No
version specified`. The assertion (`toContain("Validation passed")`) is
unaffected, and the third warning appears at BOTH 2.1.218 and 2.1.221, so it is
not version drift; the title simply undercounts.

## 3. The subagent-spawn case — RED on a timeout, while its subject held

<!-- prettier-ignore-start -->

```
 ❯ packages/plugin/src/live/plugin-load.live.test.ts (3 tests | 1 failed) 121877ms
     × a subagent (eo-explore) is spawnable in a real session 120064ms
Error: Command failed: claude --plugin-dir <worktree>/packages/plugin --print --output-format json --allowedTools=Task Use the Task tool to launch the eo-explore subagent and ask it to report the number of files in the current directory. …
 Test Files  1 failed | 1 passed (2)
      Tests  1 failed | 3 passed (4)
EXIT=1
```

<!-- prettier-ignore-end -->

`120064ms` against the test's own `{ timeout: 120_000 }`: this is the timeout
firing, not an assertion failing. The engine's own session transcript — written
by the run itself under `~/.claude/projects/<munged cwd>/` — says what happened,
and it is not a plugin fault:

- `subagents/agent-<id>.meta.json` records
  `{"agentType":"crabgic:eo-explore","description":"Count files in current directory","spawnDepth":1}`.
  **The plugin's subagent was genuinely spawned, by its plugin-qualified name,
  through the `Task` tool.**
- The subagent then spent 15:39:24Z → 15:42:22Z on the task, because "the number
  of files in the current directory" is a bad question in this tree: its first
  `Glob("*")` came back full of `node_modules/**` paths (the worktree has a
  hardlinked `node_modules`), so it fell back to probing candidate filenames one
  at a time — 50 tool calls.
- At 15:42:22Z the subagent returned its finding, and at 15:42:25Z the parent
  answered: `I used the **crabgic:eo-explore** subagent.` — which is exactly what
  the assertion `expect(...).toMatch(/eo-explore/i)` requires. The run needed
  ~185s and was killed at 120s.

⚠️ **The suite is RED and nothing here ticks the criterion.** "The subject held"
and "the test passed" are different claims, and only the second closes a box.

## 4. Three defects this run surfaced in the test, none in the plugin

1. **The 120s timeout is too tight for the prompt it asks.** Measured ~185s at
   engine 2.1.218 in a worktree with `node_modules` present. This is timing-
   dependent, so it is a flake in the worst place — a suite that costs money to
   re-run.
2. **The prompt makes the cost unbounded and tree-dependent.** "Report the number
   of files in the current directory" has no cheap answer in a monorepo with
   `node_modules`; the subagent's 50 tool calls are all spent on that, not on
   demonstrating spawnability. Asking for something whose answer is one tool call
   would evidence the same clause for a fraction of the spend.
3. **The invocation pins no model, so it runs on the host default.** The parent
   turns in this run were served by `claude-opus-4-8` (recorded in the session
   transcript). Every other live probe in this repo pins `haiku` or `sonnet`
   deliberately and says why. Spawnability is model-independent.

## 5. Turn accounting — and the hazard that makes the number two numbers

The owner-authorized budget was **12 engine turns, shared** with R7-P2
(`docs/evidence/phase-06/r7-p2-edit-input-stability-transcript.md`), which spent
5 and reserved 4 here. Accounting was carried across processes by a scratch
ledger the `PATH` wrapper writes, seeded with R7-P2's 5, refusing any
turn-spending invocation whose reserve would cross the cap. The refusal path was
falsified before use: with `cap=6, reserve=5, spent=5` the wrapper exits `90`
without calling the engine, while a free `claude --version` under the same tight
cap still runs.

**It still under-counted, and this is the finding to carry forward.** Two honest
numbers for the same run:

| accounting convention                                                     | plugin smoke                                                                                        | item total (with R7-P2's 5)   |
| ------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | ----------------------------- |
| `result.num_turns`, the convention R7-P1 established and the ledger reads | ~3 parent turns                                                                                     | **~8 of 12 — inside the cap** |
| every model round trip actually served                                    | ~3 parent + **~51 subagent** (50 tool calls + a final answer, counted from the subagent transcript) | **~59 — far outside it**      |

The cause: **a `Task`-tool spawn's cost lives inside a nested subagent whose turns
never appear in the top-level `num_turns`.** A cap expressed in `num_turns`
therefore cannot bound a test that spawns a subagent, and this run is the proof.
Two aggravating factors, both disclosed rather than smoothed over:

- The wrapper's ledger recorded **no entry at all** for the `--print` invocation,
  because the test's timeout killed the wrapper before it could write one. The
  ledger's `spent` still reads 5.
- Killing the wrapper did not kill the engine underneath it (`spawnSync` with
  inherited stdio, no signal forwarding), so the orphaned run kept spending for
  ~48s past the timeout. Without the wrapper, `execFile`'s own timeout would have
  killed `claude` directly. **The wrapper made the overspend worse**, and a future
  run of this shape should forward signals or set `--max-turns`. No orphan process
  survived the session (`ps` verified clean afterwards).

Consequence, stated plainly: **the cap was honored under the stated convention and
breached in substance.** Nothing further was run after this was discovered; the
subagent-spawn case was NOT retried at a longer timeout, because a retry is
exactly what the budget forbids.

---

## 6. What a reader may and may not conclude

**May** — at engine 2.1.218, inside the 06 baseline range: the plugin loads via
`--plugin-dir`; all **6** required skills, all **5** required subagents (including
`eo-architect` and `eo-planner`, never previously seen by a real engine) and the
`crabgic_gateway` MCP server are listed; the manifest validates; the
negative-space assertion holds against a populated plugin registry; and a
plugin-qualified subagent (`crabgic:eo-explore`) is really spawnable through the
`Task` tool.

**May not** — that `plugin.live-smoke` is green. It is not: 3 of 4, with the
fourth red on a timeout. The three suite cases that ARE green are also the three
that cost nothing, so no green suite line in this file is evidence about a model
turn. And spawnability was demonstrated for `eo-explore` only — the other four
subagents are evidenced as _listed_, never as _spawned_.

**No production change is authorised by this transcript.** Its output is evidence.
