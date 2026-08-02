# Phase 10, criterion 7 — `plugin.live-smoke` has never run against the current plugin

**Phase:** 10 — Claude Code plugin, installer, upgrade/uninstall
(`roadmap/10-plugin-and-installer.md`)

**Criterion (verbatim):**

> `@live`: plugin loads in a real session on the 06 baseline range — skills visible, gateway MCP tools listed, subagents spawnable — `@live` suite `plugin.live-smoke`.

**Found:** 2026-08-02, criteria-closeout pass batch 3 (phase 10), at `eabb65a`.

**Kind:** owner-gated live-engine handoff, not a defect in the deliverable. Recorded in the
closeout index as `EVIDENCE-NEEDS-LIVE`, which does not carry a `defectRef` (that field is
reserved for `UNMET`); this file is the handoff the orchestrator batches into the
owner-approval request.

**Severity:** evidence-channel-only. The suite exists, is well-formed, asserts all three of the
criterion's clauses, and fails red rather than skipping when the live gate is off. Nothing here
says the plugin does not load — only that nobody has watched it load in its current shape.

## Gap

The criterion names an execution channel — a real Claude Code session on the phase-06 baseline
range — and three observations to make in it. What exists at HEAD:

| Required                                        | State                                                                                                                                                           |
| ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A suite that makes the three observations       | Exists: `packages/plugin/src/live/plugin-load.live.test.ts` (+ `plugin-negative-space.live.test.ts`)                                                            |
| It is wired into the runner the phase names     | Yes: `vitest.live.config.ts`'s `include` carries `packages/plugin/src/live/**/*.live.test.ts`, and `.github/workflows/engine-live.yml` runs `npm run test:live` |
| A recorded execution against the CURRENT plugin | **No**                                                                                                                                                          |

Three findings, in the order they bear on the box:

1. **This pass may not produce one.** An `@live` suite and the `engine-live` workflow both spend
   the owner's paid subscription and are owner-gated. Neither was run.

2. **There is no CI record to cite either.** `gh run list --workflow engine-live.yml --limit 20`
   returns nothing — the workflow has zero recorded runs since it was created. Its trigger is
   `workflow_dispatch` only, deliberately ("live runs consume the owner's subscription and are
   started deliberately, never as a push side effect"). Captured verbatim in
   `docs/evidence/phase-10/closeout-c7-live-suite-not-in-default-gate.txt`.

3. **The one live execution that IS recorded is stale in a way that matters.**
   `docs/evidence/gap-18/live-verification.md` records, for 2026-07-28 against `claude` 2.1.220
   (inside `docs/engine-baseline.md`'s accepted `2.1.207`–`2.1.220` range):

   > `packages/plugin/src/live/` — **4/4 green**. The plugin loads via `--plugin-dir` in a real
   > session; the negative-space assertions hold; and a subagent is genuinely spawnable through
   > the `Task` tool. That covers this branch's plugin changes — **the third subagent**, the
   > protocol block — against the real engine rather than a fixture.

   Its own words date it to a **three**-subagent plugin. At HEAD,
   `packages/plugin/src/plugin-manifest.ts:45-51` requires **five**: `eo-explore`, `eo-reviewer`,
   `eo-roaster`, `eo-architect`, `eo-planner`. `eo-architect` and `eo-planner` were added by
   `3210730` ("feat(plugin): give the pipeline's design and plan stages their own producers",
   2026-07-29) — the day AFTER that run. The live assertion is a loop over
   `REQUIRED_SUBAGENT_NAMES`, so it has never been evaluated in its current form, and two of the
   five components it enumerates have never been seen by a real engine.

   `2ff3bce` (2026-08-01) additionally changed `packages/plugin/statusline/crabgic-statusline.mjs`
   and refreshed the plugin's recorded content digest — a further change to the vendored tree the
   live probe loads via `--plugin-dir`.

### Search trail

- `docs/evidence/phase-10/README.md` row 7 — names both live files and states plainly
  "**Not executed end-to-end in this build** (no `CLAUDE_CODE_OAUTH_TOKEN` here)". Its Deviations §1
  says the `vitest.live.config.ts` glob fix was handed to the orchestrator; that fix has since
  landed (the glob now includes `packages/plugin/src/live/**`), so the wiring half is done.
- `git ls-files packages/plugin/src/live/` — both files present, neither deleted or relocated.
- `grep -rn "packages/plugin/src/live" docs/` — one hit outside the phase README:
  `docs/evidence/gap-18/live-verification.md`, quoted above.
- `gh run list --workflow engine-live.yml --limit 20` — empty.
- `npx vitest run packages/plugin/src/live/*.live.test.ts` under the DEFAULT config — "No test
  files found", because `vitest.config.ts:101` excludes `**/*.live.test.ts` from every project.
  So no green `CI` run and no green `npm test` can be read as covering this box. (No engine was
  invoked: vitest matched zero files and never loaded the suite.)
- `docs/engine-baseline.md` header — accepted range `2.1.207`–`2.1.220`; the 2026-07-28 run's
  2.1.220 was inside it, so version range is not the obstacle. Staleness of the plugin under test
  is.

## Proposed remedy

One `engine-live` `workflow_dispatch` (or one owner-sanctioned local
`CRABGIC_LIVE=1 npm run test:live` scoped to `packages/plugin/src/live/`), against a `claude`
inside `docs/engine-baseline.md`'s accepted range, with the recorded output committed to
`docs/evidence/phase-10/`. Then tick criterion 7 citing that run.

What the run would settle, precisely:

- `claude plugin details --plugin-dir <packages/plugin>` lists all **six** required skills
  (`REQUIRED_SKILL_NAMES`) and all **five** required subagents (`REQUIRED_SUBAGENT_NAMES`) —
  including `eo-architect` and `eo-planner`, never live-verified.
- The inventory lists `crabgic_gateway` among the plugin's MCP servers.
- A subagent is still spawnable through the `Task` tool in a real turn.

**Effort: S** for the run itself (the suite is four tests and needs no new code). It needs the
**live engine and owner approval**; it needs no CI wiring, since `engine-live.yml` and
`vitest.live.config.ts` already carry the suite. Two known hazards to brief the owner on before
dispatch: the `engine-live` job fails fast unless the `CLAUDE_CODE_OAUTH_TOKEN` repository secret
exists (whose presence this pass did not confirm), and the same workflow also runs
`packages/engine-claude/src/live/`'s nine worker-spawning files, which are a materially larger
spend than this four-test subset — a scoped local run is the cheaper way to close this one box.

**Ticket-ready:** yes, pending owner approval for the subscription spend.
