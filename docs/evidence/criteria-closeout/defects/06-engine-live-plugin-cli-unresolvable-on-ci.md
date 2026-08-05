# Defect 06-engine-live-plugin-cli-unresolvable-on-ci

**Phase:** 06 — Claude engine adapter (`roadmap/06-claude-engine-adapter.md`, exit criteria 1 and 10)

**Criteria (verbatim):**

> 03's full envelope-conformance fixture set passes on the pinned live engine — suite `envelope-conformance.live.test`, run in the `engine-live` CI job.

> `engine-live` CI job (01) runs the `@live`-tagged suite end to end against the pinned version — evidenced by a green CI run.

**Found:** 2026-08-05, criteria-closeout pass (phases 00 and 06), at
`9abc3fd911186cd83bbd02b2d905f613da2ca8e3`.

**Severity:** CI-channel blocker, no product defect. The engine adapter itself is fine — this pass
ran four of its live suites green against the pinned 2.1.218 engine. What is broken is the only
channel these two criteria will accept: the `engine-live` workflow cannot complete green today, and
would burn the owner's subscription discovering that.

## Gap

`engine-live` has **never run**. `gh run list --workflow=engine-live.yml --limit 10` returns exit 0
with empty output. So the fault below has never had a chance to surface.

Five measured links. Full transcript, with every command echoed and its own exit status:
`docs/evidence/phase-06/closeout/closeout-engine-live-enoent.txt`.

| #   | Link                                               | Measured at `9abc3fd`                                                                                                                                   |
| --- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | The plugin live lane resolves `claude` from `PATH` | `plugin-load.live.test.ts:32`, `plugin-load.live.test.ts:65`, `plugin-inventory-probe.ts:63` — bare `"claude"` to `execFile`                            |
| 2   | The SDK packages expose no `bin`                   | both `@anthropic-ai/claude-agent-sdk` and `@anthropic-ai/claude-agent-sdk-linux-x64` at 0.3.218 report `bin: undefined`                                 |
| 3   | `npm ci` therefore links no shim                   | `ls node_modules/.bin \| grep -x claude` → exit 1; `grep -i claude` over the same listing → exit 1                                                      |
| 4   | `engine-live.yml` installs no claude CLI           | the whole install surface is checkout, setup-node 24, `apt-get install bubblewrap socat` (`engine-live.yml:39`), `npm ci` (`:46`), `npx tsc -b` (`:47`) |
| 5   | The red does **not** spare the spend               | `npm run test:live` carries no `--bail`, so all 17 files run regardless of order                                                                        |

A GitHub `ubuntu-latest` runner has no `claude` on `PATH`. Every case in
`packages/plugin/src/live/plugin-load.live.test.ts` therefore ENOENTs, and `npm run test:live`
(`engine-live.yml:53`) exits red.

The engine-claude lane is unaffected in itself: the SDK transport launches the bundled binary by
absolute path, which is why this pass's four-file local batch worked. Only the PATH-resolving plugin
lane breaks — and it shares the job.

### Link 5 is the expensive part, and it corrects an earlier belief

An earlier reading of this held that the 15 engine-claude files run **before** the plugin lane, so
the ENOENT would arrive only after the whole suite had been paid for. **That ordering claim is
false.** Measured: `plugin-load.live.test.ts` ran **first of the 17**, and
`plugin-negative-space.live.test.ts` ran 16th — vitest does not order files by which `include`
pattern matched them.

It makes no difference, and that is the point worth carrying forward. `npm run test:live` is
`vitest run --config vitest.live.config.ts` with no `--bail`, so **every** file runs whatever the
order: `Test Files 17 failed (17)` in the measured run. On CI the engine-claude files would each
authenticate and spend. The estimated cost of a dispatch today is therefore the full engine-claude
suite — roughly 60–90 haiku invocations, since the four files this pass ran measured 10
model-serving invocations between them and several of the remaining eleven carry larger ledgers —
paid to reach a millisecond ENOENT that closes nothing, and paid **again** on the eventual real
dispatch.

Provenance of that measurement, disclosed rather than hidden: the closeout pass ran the bare 17-file
lane **by accident**, via a shell backtick inside a double-quoted string. It spent nothing —
`CRABGIC_LIVE` was unset, so the harness's fail-closed gate threw in every file before any engine
call, and `/tmp/eo-live-canary-marker.json` still carried its mtime from the pass's sanctioned
batch. The accident is recorded because the datum it produced corrects the ordering claim above.

## Remedy

**Effort: S** for step 1 (one workflow step plus a stale comment, no product code), **S** for step 2
(three localised changes in one test file, verifiable with a single bounded local run), and the
dispatch itself is minutes of wall clock. **S overall** — what makes this defect expensive is not the
fix but the subscription spend it currently wastes, and the fact that nobody can close c1 or c10
until it lands.

Two ordinary defect-fix PRs, in this order. Neither belongs to a closeout pass, which files defects
rather than fixing them.

1. **`ci:`** — add a pinned CLI install step to `.github/workflows/engine-live.yml` before the test
   step. **Pin inside the accepted `2.1.207`–`2.1.220` range recorded in
   `docs/engine-baseline.md`; never `@latest`.** The registry is already at 2.1.221+, which is
   outside the range, and an out-of-range CLI would put the plugin lane on an unverified engine in
   violation of the engine-fact ground rule. Note that the two transports would then be at
   deliberately different versions on the same runner — the SDK transport at the bundled 2.1.218,
   the CLI transport at whatever is pinned — which is the same split
   `docs/engine-baseline.md`'s 2026-07-25 narrow re-baseline already records for this host.
2. **`fix(plugin):`** — the spawn case's three already-filed test defects: its 120 s self-timeout
   against a measured ~185 s need, its unbounded tree-walking prompt, and its unpinned model.

Then dispatch **once**, in a low-utilization window. A hot-window dispatch is a cheap red (the
canary aborts at utilization ≥ 0.85, costing about one invocation); the expensive red is a
late-file failure, which step 1 removes.

Consider also adding `--bail` to the live lane, or splitting the plugin lane into its own job. Today
one lane's unresolvable binary spends the other lane's entire budget before failing.

## Why the criteria are not ticked

c1 is a **split criterion**: its first clause ("passes on the pinned live engine") is satisfied by
this pass's green local batch, and only its second clause ("run in the `engine-live` CI job") is
blocked. Reading that clause down to "it passed somewhere" would drop a guarantee, which the
closeout protocol classifies as unmet rather than as a wording correction.

c10 cannot be satisfied by anything local **and cannot be satisfied by a red run either**, because
its own text says "evidenced by a green CI run".

Both are classified `EVIDENCE-NEEDS-CI` and both carry this record as their `defectRef`.

## Second, separate finding in the same file — a stale accepted range

`.github/workflows/engine-live.yml:8` still says the accepted range is `2.1.207–2.1.210`.
`docs/engine-baseline.md`'s header says `2.1.207–2.1.220`, and
`packages/engine-claude/src/version-gate.ts` mirrors 2.1.220 — pinned per push by
`packages/engine-claude/src/version-gate.test.ts:27`.

The comment is stale by two re-baselines. It is a comment, so nothing enforces it and nothing breaks
today. It matters because it is the first thing whoever implements remedy step 1 will read, and it
names the wrong upper bound to pin against. Fix it in the same `ci:` PR.
