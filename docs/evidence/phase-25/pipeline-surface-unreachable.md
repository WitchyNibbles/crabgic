# The nine unrun steps were blocked on installation, not spend

**Measured 2026-08-16**, at `main` = `506cef3`. Three defects, each independently
sufficient to make the staged pipeline unreachable from any ordinary session.
All three were live in this checkout while `crabgic doctor` reported
**11 of 14 checks passed**.

This supersedes the framing in `unattended-run-gap.md`, which attributed the nine
unexecuted steps to owner spend authorization. Spend was never the binding
constraint: there was nothing to spend it on.

## Defect 1 — the plugin was never registered with the engine

`crabgic install` wrote `.claude/settings.json` containing:

```json
"enabledPlugins": { "crabgic@crabgic-marketplace": true }
```

At the same time:

- `~/.claude/plugins/known_marketplaces.json` had **no** `crabgic-marketplace`
- `~/.claude/plugins/installed_plugins.json` had **no** `crabgic@crabgic-marketplace`

So the key named a plugin the engine had never heard of, and the engine ignored
it silently. Consequence, verified by `ListSkills` in a live session: **none** of
`/eo:run`, `/eo:status`, `/eo:approve`, `/eo:evidence`, `/eo:connections`,
`/eo:protocol`, `/eo:pipeline` existed, and neither workflow
(`crabgic-stage-loop`, `crabgic-stage-round`) was invocable.

The installer never writes skills or workflows — by design. `packages/cli/src/installer/`
has `agents-writer.ts`, `statusline-writer.ts` and `output-style-writer.ts`, and
no equivalent for skills. They ship only through the marketplace path that
`README.md:132` documents and that nothing enforces.

**The managed `CLAUDE.md` block advertises those six slash commands to every
session.** It has been advertising a surface that did not exist.

**Repaired** by running the documented path:

```
claude plugin marketplace add ./packages/plugin
claude plugin install crabgic@crabgic-marketplace --scope project
```

`installed_plugins.json` now records the plugin at project scope, pinned to
`506cef3dc866d23d51d2c3ea23bcaf083de5792f`.

## Defect 2 — `.mcp.json` invoked a stale global binary

`.mcp.json` launches the gateway as bare `crabgic gateway mcp`, resolved from
`PATH`. On this machine `PATH` held the **npm-registry global install at
`crabgic@1.1.2`** — six minor versions behind the repo's `1.7.0`, and predating
phase 25 entirely.

Measured, by driving `tools/list` over stdio against each binary:

| binary                 | tools | `pipeline.plan` | `review.submit` | `review.calibrate` | `report.render` |
| ---------------------- | ----- | --------------- | --------------- | ------------------ | --------------- |
| global `crabgic@1.1.2` | 23    | absent          | absent          | absent             | absent          |
| repo build `1.7.0`     | 26    | present         | present         | present            | present         |

The `/eo:pipeline` skill's step 1 is "Call `pipeline.plan` (gateway MCP)". Against
the binary the project's own `.mcp.json` actually starts, that tool did not exist.
The entire staged-review surface — plan, submit, calibrate — was dead on the wire.

**Repaired** with `npm link -w crabgic`; `which crabgic` now resolves to
`packages/cli/dist/bin.js` and `tools/list` returns all 26.

## Defect 3 — `crabgic doctor` is blind to both

Fourteen checks. Not one of them:

- verifies the marketplace is registered or the plugin installed
- verifies the `crabgic` on `PATH` is the version the project expects
- verifies the gateway exposes the tools the shipped skills call

`installer.plugin-trust-pin` passes on "marketplace.json is SHA-pinned", which is
a property of a file in the repo, not of anything installed. It passed throughout.

A health check that reports 11/14 green while the product's central surface is
unreachable is worse than no health check: it actively argues the install is fine.

## Why this went unnoticed for a day

The three live review rounds recorded in `live-review-round-1.md` worked because
the operator dispatched agents directly and called the handlers through test
harnesses. That path never touches `.mcp.json`, never touches the plugin registry,
and never resolves `crabgic` from `PATH` — so it was green against a surface
nobody could actually reach. `unattended-run-gap.md` even named "crabgic is not
installed on crabgic" as the prerequisite; `crabgic install` was then run, it
reported success, and the remaining two thirds of the install were never checked.

## Defect 4 — every pipeline lens was dispatched to the wrong reviewer

Found while walking the stage roster against the repaired gateway.
`workflows/stage-round.mjs` hardcoded `agentType: "eo-domain-reviewer"` at both
dispatch points — the review fan-out and the adversarial verifier.

Only the `audit` stage plans domain lenses. Measured, by driving `pipeline.plan`
through all nine stages:

| stage       | lenses planned                                     | family   |
| ----------- | -------------------------------------------------- | -------- |
| `research`  | completeness, source-quality, assumption-audit     | pipeline |
| `design`    | contract-fit, security, operability                | pipeline |
| `plan`      | coverage-of-design, sequencing                     | pipeline |
| `implement` | correctness, security **+** compliance, clean-code | **both** |
| `audit`     | testing, target-domain, compliance, clean-code     | domain   |
| `document`  | completeness, readability                          | pipeline |

`eo-domain-reviewer`'s own definition names eight lenses — `backend`,
`frontend`, `infrastructure`, `testing`, `product-design`, `target-domain`,
`compliance`, `clean-code`. Eleven of the planned lens names above are not among
them. `eo-reviewer`, whose charter they are, was **dispatched by nothing in the
shipped product**: `grep -rn eo-reviewer packages/plugin/workflows` returns
nothing.

`implement` is the case no single hardcoded value can get right — it mixes both
families in one stage.

**Why the test suite agreed.** `stage-round-workflow.test.ts` asserted
`expect(SOURCE).toMatch(/agentType: "eo-domain-reviewer"/)` — a fixture that
encodes the defect, so the test passed _because_ the bug was present, and would
have reddened on the fix. The playbook's vacuity pattern, again.

**Repaired.** `planStageRound` now derives `reviewer` per lens from
`DOMAIN_LENS_IDS` and the plan carries it on the wire; the workflow reads
`lens.reviewer` and **throws** on a lens the plan did not label, rather than
defaulting. The seam test now holds every `lens.<field>` the scripts read against
what the handler emits — its first version was blind to `lens?.reviewer` through
the optional chain, stayed green with the field deleted, and was fixed.

## Defect 5 — the `eo-*` agent types do not resolve in a session older than the install

Dispatching `eo-researcher` in this session returns:

```
Agent type 'eo-researcher' not found. Available agents: claude,
claude-code-guide, Explore, general-purpose, Plan, statusline-setup
```

`.claude/agents/` holds all eight definitions and has since 2026-08-15 18:25. The
engine reads that directory at **session start**, so a session that predates the
install — or predates the repair above — cannot dispatch any of them, and
`stage-round.mjs` fails at its first `agent()` call with the same error.

This is engine behaviour, not a crabgic defect, and it is stated here because it
is the reason the nine steps still have not been _executed_: the surface is now
reachable, and reaching it requires a session started after the repair.

## The dogfooding trap this leaves behind

`claude plugin install` **copies** the plugin tree into
`~/.claude/plugins/cache/crabgic-marketplace/crabgic/<version>/`. It is a
snapshot, not a symlink — verified by grepping the cache for a symbol added to
`packages/plugin/workflows/stage-round.mjs` in this change set and finding zero
matches while the worktree has it.

So while developing crabgic **on** crabgic, every edit under `packages/plugin/`
is invisible to the next session until the plugin is reinstalled. Nothing warns
about this, and the symptom — a fixed workflow still behaving like the broken one
— reads as the fix not working.

## What is now unblocked, and what still is not

Unblocked: the nine steps have a surface to run on. A **fresh session** picks up
the plugin and the gateway — skills and MCP servers are loaded at session start,
so the session that performed this repair cannot use it.

Still open, and unchanged by this:

- engine `2.1.224` sits outside the accepted range `2.1.207–2.1.220`
- `hermeticity.selftest` cannot pass under subscription auth
- both completed runs published without acceptance criteria being evaluated
