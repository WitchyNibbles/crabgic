# Evidence — manager operating protocol & Stop autonomy gate

**Date:** 2026-07-27
**Phase:** 10 (plugin & installer), coordinated with 11 (stop conditions)
**Ledger:** interface-ledger Gap 17
**Engine:** CLI 2.1.220 / SDK 0.3.218 (within the accepted range, `docs/engine-baseline.md` header)

## What prompted this

Reported from real use of Crabgic in a consuming repo — not from a roadmap read-through:

1. The manager session asked the owner to type "continue" after every step of the process.
2. When it did have a real question, it asked in plain text ("option 1, 2, 3 or 4") instead of
   using Claude Code's structured question interface.

## Root cause

`packages/cli/src/installer/claude-md.ts` wrote a managed `CLAUDE.md` block containing a
capability list and **no operating instructions at all**. With nothing telling it otherwise, a
Claude Code session uses its conversational default and checks in after every step — directly
contradicting the product's own stated posture (README: "full autonomy end to end. A human is
required at exactly two blocking gates"). Roadmap/11 already named seven stop conditions, and
nothing rendered them anywhere the manager could read.

A second, latent defect was found while fixing the first: when the target repo had an
`AGENTS.md`, `buildClaudeMdManagedBlockContent()` collapsed the **entire** managed block to the
single line `@AGENTS.md`, so such repos got no capability list either.

## What was verified live, and what was not

Two new engine spikes, both re-runnable:

| Probe                                                 | Verdict        | Records                                                                         |
| ----------------------------------------------------- | -------------- | ------------------------------------------------------------------------------- |
| `human-interaction-tool.absent-headless-sdk`          | **PASS**       | `AskUserQuestion` absent from the 29-tool headless SDK catalog                  |
| `human-interaction-tool.absent-headless-cli`          | **PASS**       | absent on the CLI transport too — an engine property of headless mode           |
| `human-interaction-tool.catalog-matches-baseline-4-4` | **PASS**       | headless catalog still equals §4.4's recorded list (drift guard)                |
| `human-interaction-tool.present-interactive`          | **UNRESOLVED** | interactive presence is an in-session observation, NOT a fixture — see below    |
| `stop-hook.block-decision-resumes-the-turn`           | **PASS**       | `{"decision":"block","reason":R}` prevents the turn ending; R reaches the model |
| `stop-hook.stop_hook_active-set-on-reentry`           | **PASS**       | `false` then `true` — the loop guard exists                                     |
| `stop-hook.payload-shape`                             | **PASS**       | `cwd` and `session_id` present and string-typed                                 |

Recorded as `docs/engine-baseline.md` §18 and §19. Fixtures under `spikes/fixtures/09-*`, `10-*`.

**The one honest gap:** §18.2. `AskUserQuestion`'s presence in an _interactive_ session could not be
captured by a script — interactive mode emits no `system/init` line, and two bounded pty attempts
with `--debug api --debug-file` produced no request payload (the `api` filter does not dump the
`tools` array). It is recorded as an in-session observation and explicitly marked as not
probe-verified. **Consequence, deliberately bounded:** the protocol text degrades gracefully — if
the tool is unavailable, the instruction is one consolidated prose question, never a step-by-step
interrogation. No shipped behavior depends on §18.2 resolving PASS.

The security-relevant half _is_ probe-verified: `AskUserQuestion`'s absence from the headless
catalog is what makes "a worker can never block a run waiting on a human" true by construction
rather than by policy.

## What was built

| Artifact                                       | Purpose                                                |
| ---------------------------------------------- | ------------------------------------------------------ |
| `packages/plugin/src/manager-protocol.ts`      | Single source of truth for the protocol text           |
| `packages/plugin/skills/protocol/SKILL.md`     | Long-form rationale, on-demand (`/eo:protocol`)        |
| `packages/plugin/hooks/stop-autonomy-gate.mjs` | The blocking `Stop` hook                               |
| `packages/cli/src/installer/claude-md.ts`      | Renders the protocol; `@AGENTS.md` bridge now additive |
| `packages/cli/src/uds-client/passive-mode.ts`  | `CRABGIC_NO_SPAWN` — observe without spawning a daemon |

The gate's rule falls straight out of the run-lifecycle enum: block on the 6 in-flight states,
allow on `awaiting_approval` (the human gate is legitimately open — blocking there would trap the
owner in a session whose only exit is the act the block prevents) plus the 4 absorbing states.

## Verification

- **Full suite:** 565 test files, **4815 tests, 0 failures**.
- **Coverage (global gate ≥80% line+branch):** statements 95.39%, branches 88.13%,
  functions 96.51%, lines 96.35%.
- **Coverage on new code:** `manager-protocol.ts` 100/100/100; `claude-md.ts` 100/100/100;
  `passive-mode.ts` 100/100/100; `stop-autonomy-gate.mjs` lines 88.88, branches 94.11,
  functions 80.00. The gate was added to the coverage `include` globs — it is the only manager
  hook permitted to block, so exempting it from the gate governing everything else made no sense.
- **Typecheck** (`tsc -b`), **lint** (eslint), **format** (prettier --check): clean.
- **`check:hygiene`, `check:workspace-count`, `check:package-graph`:** PASS.
- **Build:** `npm run build` emits the vendored plugin with `hooks/stop-autonomy-gate.mjs` and
  `skills/protocol/` present in `packages/cli/dist/plugin/`.
- **Hook exercised in its published form:** run directly against the built
  `packages/cli/dist/plugin/hooks/stop-autonomy-gate.mjs` — resolves the sibling `dist/bin.js`,
  exits 0 silently with no supervisor (fail-open), emits a block decision when a stub CLI reports
  a `running` run, and stays silent for `awaiting_approval`.

TDD throughout: every module's tests were written and observed failing before implementation.

## Known gaps carried forward

- **§18.2 interactive-catalog capture is OWED** (non-blocking; on §11's list). The protocol
  degrades gracefully in the meantime.
- **`stop_hook_active` (§19.2) is flagged release-blocking on drift.** If a future engine stops
  setting it on re-entry, the gate loses its loop guard; its fail-open discipline reduces but does
  not eliminate the wedge risk.
- The advisory `stop-reminder.mjs` was left registered alongside the gate. It is a static stderr
  nudge and now partly redundant with a hook that queries real state; retiring it was out of scope
  for this change.
