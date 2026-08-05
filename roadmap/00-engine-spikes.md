# Phase 00 — Engine verification spikes & baseline

| | |
|---|---|
| **Depends on** | nothing (first work in the repo; parallel with 01) |
| **Unlocks** | 03 (envelope compiler + fake engine); 23 (release hardening — depends on all previous phases) |
| **Sources** | adaptation §0 (auth/plan-limit decisions), §3.3 (worker transports), §4.1–§4.6, §5.7 (auth spike), §10 risks #1–#3, #5, #9, #10; Appendix A (verified fact inventory), Appendix B (worker profile sketch) |
| **Primary package** | none — this phase ships `spikes/` (throwaway scripts, never published) and `docs/engine-baseline.md`; no `packages/` workspace member (see Out of scope) |

## Goal

Every fact this roadmap currently treats as "verify at build time" — permission-rule syntax at the edges the doc doesn't literally show, config hermeticity, sandbox enforcement, structured-output failure behavior, session resume/fork, subscription-auth token resolution, and rate-limit signal shape — is checked against the pinned live engine and recorded as a PASS/FAIL/UNRESOLVED verdict in `docs/engine-baseline.md`, alongside the script that produced it. When this phase is done, phase 03's compiler and phase 06's adapter cite one committed, versioned document instead of the adaptation doc's own §10 list of open questions, and the subscription-auth go/no-go call is made and recorded rather than assumed.

## In scope

- **Auth spike (blocking)** — mint a token via `claude setup-token`; spawn one Agent SDK worker with `settingSources: []` and an isolated `CLAUDE_CONFIG_DIR`; confirm `CLAUDE_CODE_OAUTH_TOKEN` resolves without interactive login. If it does not, validate the documented fallback (copy `.credentials.json`, mode 0600, into the worker's `CLAUDE_CONFIG_DIR`) and record which mechanism v1 uses; if the fallback is the one adopted, update adaptation doc §5.7 to record it as decided fact rather than an open spike question.
- **Hermeticity probe** — on the same `settingSources: []` SDK worker (the confirmed v1 transport, §0 — not `--bare`, which is only the CLI escape hatch), confirm a planted rogue user/project `settings.json`, a planted hook, a planted `CLAUDE.md`, and a planted `.mcp.json` are all genuinely ignored; record any partial-hermeticity surprise verbatim. Phase 03's compiler and phase 06's spawn path both assume this holds unconditionally — this probe is what earns that assumption.
- **Permission probes** — `permissionMode: dontAsk` auto-denies an unlisted tool; deny-wins-over-allow at the same settings level and across levels; compound-command smuggling (`allowed-cmd && curl …`) denied; process-wrapper smuggling (`nohup curl …`) denied; `Edit` outside the allowed path denied; `Agent` deny blocks subagent spawning; and — because the doc's own literal examples (`Bash(npm run test:*)`, `Bash(npm run build:*)`, `Bash(git status:*)`, `Bash(git diff:*)`, all four confirmed in adaptation Appendix B) never show a case beyond themselves — whether `Bash(<prefix>:*)` requires or forbids a space before the colon for a command prefix outside those examples. Record that verdict in `docs/engine-baseline.md` before phase 03's compiler is allowed to generalize the pattern to any prefix this probe didn't cover.
- **Sandbox probes (WSL2 host)** — `bwrap` availability; `failIfUnavailable` aborts when forced-broken; egress denied with empty `allowedDomains`; UDS reachable with `allowUnixSockets: true` (spike outcome: the live Linux/WSL2 gate proved to be the differently-named boolean `allowAllUnixSockets` — `allowUnixSockets` is a macOS-only `string[]` path allowlist, ignored on Linux; see docs/engine-baseline.md §6); `denyRead ~/.ssh` enforced (the sandbox default is read-open, so this must be an explicit assertion, never assumed); `credentials.envVars mode: mask` shows a placeholder, never the real value, in the worker's resolved env.
- **Structured-output probe** — `--json-schema` happy path returns a schema-validated `structured_output`; drive one schema-violating model response and record the exact observed behavior (retry, typed error field, non-zero exit, or other) verbatim — the doc does not specify this, so it is recorded, never assumed.
- **Session probes** — pre-assigned `--session-id` honored; kill -9 mid-run then `--resume` from the same worktree cwd continues with context intact; `--fork-session` leaves the original transcript file untouched; two concurrent sessions in one project directory with distinct `--session-id`s do not interleave.
- **Rate-limit signal capture** — drive requests until a subscription rate/usage-limit signal surfaces; record the exact error/event shape verbatim. If a real limit cannot be triggered safely, document why and record a simulation strategy instead.
- **Fixture capture** — representative `stream-json` transcripts spanning clean success, retry/backoff, a rate-limit signal, a schema-violating result, and a crash, saved into `spikes/fixtures/` (sanitized of tokens/paths before commit). The raw event-type taxonomy itself is unconfirmed (adaptation §10 item 10) — this phase captures observed transcripts for phases 03/06 to parse; it does not assert a closed list of event names.
- **Baseline doc** — `docs/engine-baseline.md`: tested version and accepted range, one verdict block per probe above (including the Bash colon-spacing verdict and the auth decision record), a "changes that would invalidate this baseline" list (flag renames, permission-mode changes, sandbox-schema changes), and fixture paths by reference.

## Out of scope

- Any code under `packages/` — the envelope compiler and fake engine (03), the real SDK adapter (06), doctor's implementation (09), and the scheduler's limit-parking state machine (13) all consume this phase's recorded facts; none of their logic is written here.
- CI integration of the spikes, or of the `@live` conformance suite — phase 01 places the `engine-live` job as a manually-triggered placeholder; phase 06 wires it to run the `@live`-tagged fixture suite against the pinned version.
- Any new product decision — this phase resolves engine-fact questions only, never product scope (Hard Rule 7); it makes a go/no-go call on the already-decided subscription-auth design (§0), it does not re-open that design.

## Interfaces produced

No package, schema, CLI command, or MCP tool is produced by this phase (see Primary package). What downstream phases rely on is a committed document, a fixtures directory, and re-runnable scripts:

- **`docs/engine-baseline.md`** — the single citable baseline (README ground rule: "anything engine-touching cites `docs/engine-baseline.md` … never memory"). Named contents and their consumers:
  - Tested version + accepted range → phase 06 (adapter refuses to start outside range), phase 09 (doctor's version check), phase 23 (compatibility-matrix docs, release-CI pin).
  - Per-probe PASS/FAIL/UNRESOLVED verdicts → phase 03 (compiler may not emit a form this phase left UNRESOLVED), phase 06 (adapter behavioral assumptions), phase 09 (doctor's seeded-fault matrix mirrors these checks).
  - The Bash command-prefix colon-spacing verdict → phase 03: the envelope compiler's command-prefix allow-list is restricted to the doc's confirmed literal forms until this verdict lands; the verdict then governs whether the pattern may generalize.
  - The hermeticity verdict → phase 03 (compiler's hermetic-by-construction design), phase 06 (spawn path built on `settingSources: []`), phase 09 (doctor's hermeticity self-test operationalizes this check on every host, ongoing).
  - The auth decision record (`CLAUDE_CODE_OAUTH_TOKEN` resolution vs. `.credentials.json` fallback) → phase 05 (per-worker `CLAUDE_CONFIG_DIR`/HOME/TMP provisioning), phase 06 (auth injection at spawn).
  - The structured-output schema-violation behavior → phase 06 ("schema violation → typed failure feeding the repair-attempt path").
  - The rate-limit error/event shape → phase 06 (builds `limitSignal` detection from it), transitively phase 13 (parks on the resulting `limitSignal` event).
  - The "changes that would invalidate this baseline" list → phase 06's version-drift policy and phase 23's re-verification-on-bump policy ("any engine version bump during hardening restarts the `@live` conformance clock (00/06 policy)").
- **`spikes/fixtures/`** (sanitized `stream-json` transcripts + probe outputs) → phase 03 ("fake engine parity vs phase-00 fixtures" exit criterion), phase 06 (parser "tested against phase-00 fixtures"; "fake vs live parity" exit criterion).
- **`spikes/README.md` + `spikes/0N-*.mjs`** (seven re-runnable probe scripts, one per In-scope bullet above bar the baseline doc itself) → re-run by phase 23's re-verification-on-bump policy and by whoever re-verifies the baseline before adopting a newer pinned version.

## Interfaces consumed

None. Phase 00 has no phase dependencies — it is the first work in the repo, parallel with phase 01. Its only inputs are `docs/claude-code-adaptation.md` (the source-of-truth this whole roadmap decomposes) and out-of-band access to a live, logged-in Claude Code installation on the build host; neither is a phase-produced interface.

## Work items

1. `spikes/README.md` — host prerequisites (WSL2, `claude` 2.1.207 installed and able to run `claude setup-token`), the shared verdict-block format every script below prints (`{probe, expectation, observed, verdict: PASS|FAIL|UNRESOLVED}`), and the re-verification procedure a version bump triggers.
2. `spikes/01-auth.mjs` — asserts `CLAUDE_CODE_OAUTH_TOKEN` resolves for an SDK worker under `settingSources: []` + isolated `CLAUDE_CONFIG_DIR`; on failure, asserts the `.credentials.json` (0600) fallback instead; exits non-zero if neither resolves.
3. `spikes/02-hermeticity.mjs` — plants a rogue user/project `settings.json`, a hook, a `CLAUDE.md`, and a `.mcp.json`; asserts the same `settingSources: []` worker loads none of them.
4. `spikes/03-permissions.mjs` — asserts `dontAsk` auto-deny, deny-wins (same-level and cross-level), compound-command smuggling denied, wrapper smuggling denied, out-of-path `Edit` denied, `Agent`-deny blocks subagent spawn, and the Bash colon-spacing verdict.
5. `spikes/04-sandbox.mjs` (WSL2 host) — asserts `bwrap` presence + `failIfUnavailable` abort, empty-`allowedDomains` egress denial, UDS reachability, `denyRead ~/.ssh` enforcement, and masked-secret placeholder-only visibility.
6. `spikes/05-structured-output.mjs` — asserts the `--json-schema` happy path, then drives and records one schema-violating response's exact observed behavior.
7. `spikes/06-sessions.mjs` — asserts pre-assigned `--session-id`, kill -9 → `--resume` continuity, `--fork-session` transcript isolation, and no interleaving across two concurrent same-directory sessions.
8. `spikes/07-ratelimit.mjs` — drives a subscription rate/usage-limit signal (or documents why none could be triggered safely) and records the exact error/event shape.
9. Capture and sanitize fixtures from every script above into `spikes/fixtures/` (strip tokens/paths before commit), spanning clean success, retry/backoff, rate-limit signal, schema-violating result, and crash.
10. Write `docs/engine-baseline.md`, synthesizing every verdict above plus the "changes that would invalidate this baseline" list and fixture paths by reference.

## Test plan

- **Unit:** not applicable — this phase ships no production code (see Out of scope); each spike script is itself an executable assertion against the live engine, covered under Integration below.
- **Property:** not applicable at this phase — property-based coverage of the envelope compiler (e.g. "no allow outside the envelope") is phase 03's exit criterion, exercised against the facts this phase records.
- **Integration:** the seven spike scripts, each run against the pinned live engine — auth resolution (work item 2); rogue-settings/hook/CLAUDE.md/`.mcp.json` rejection (work item 3); `dontAsk` auto-deny, deny-wins same/cross-level, compound-command smuggling, wrapper smuggling, path-escape denial, `Agent`-deny, and the Bash colon-spacing probe (work item 4); `bwrap`/`failIfUnavailable`, egress denial, UDS reachability, `denyRead`, masked-secret visibility (work item 5); `--json-schema` happy path + schema-violation behavior (work item 6); session pre-assignment, kill-9/resume, fork-session isolation, no-interleave (work item 7); rate-limit signal capture (work item 8).
- **Conformance:** re-running the full probe suite against a newer pinned version before adopting it must reproduce every existing PASS verdict or explicitly update the baseline doc — the mechanism phase 23 invokes ("00/06 policy") and phase 06's version gate depends on. There is no separate golden-fixture format at this phase; the scripts themselves are the source of the fixtures phases 03/06 later treat as golden.
- **Security:** every script sources its own tokens from the environment at run time, never hardcoded, so a script is safe to commit even before any fixture is captured; captured fixtures are grepped for token-shaped strings and rejected from commit on any match (spikes 01 and 07 in particular touch live credentials and rate-limit responses); the `.credentials.json` fallback path is asserted to land at mode 0600, never world- or group-readable; the masked-secret probe (work item 5) asserts the placeholder string appears in the worker's resolved env and the literal secret value does not, checked by substring search before any capture is written to disk.

## Exit criteria

**Closeout pass 2026-08-05:** 5/5 ticked against recorded evidence, for **zero** live spend — not one
of the eight `spikes/*.mjs` scripts was re-run. Machine-readable index:
`docs/evidence/criteria-closeout/phase-00.json`.

Why nothing was re-run. Spikes 01–06 and 08 invoke the engine; their verdicts and fixtures are
already committed and merged at engine 2.1.218, inside the accepted 2.1.207–2.1.220 range, which is
exactly what these criteria ask for. Re-running them would have spent roughly 30 live invocations to
reproduce a record that already exists. Spike 07 makes zero live calls by design but only re-scans
the other scripts' fixtures, so it too would add nothing the committed
`spikes/fixtures/07-ratelimit.verdicts.json` does not already say.

The cross-check that makes criterion 1 non-vacuous. This pass re-derived the verdict tally from the
committed fixture BYTES rather than reading it back out of the prose: 8 scripts, **32 sub-probes, 30
PASS, 2 UNRESOLVED, 0 FAIL** — exactly §9's published tally (`docs/engine-baseline.md:386`). The
document and the fixtures are two independent sources here and they agree. (All ten fixture files
total 39 sub-probes; §9 line 402 explicitly carves spikes 09 and 10 out of the 32, so that is not a
discrepancy.)

Every "committed" claim is proved with `git log --oneline --all -- <path>` and
`git cat-file -e HEAD:<path>`, never with `ls` — a working tree cannot distinguish a gitignored build
output from a committed file. `ls spikes/fixtures | wc -l` and `git ls-files spikes/fixtures | wc -l`
both return 18, so nothing there is an untracked local artefact. Full transcript, every command
echoed with its own exit status: `docs/evidence/phase-00/closeout/closeout-committed-and-census.txt`.

Citation re-resolution, and the numbers that make it worth trusting. Every quoted fragment in
`docs/evidence/criteria-closeout/phase-00.json` and `phase-06.json` was located mechanically by a
purpose-built **four-rule** resolver — content, line-anchoring, group consecutiveness, and
repeat-text detection — run against the tree this branch lands as: **86 citations, 80 of them
resolvable paths, 174 marker groups, 329 quoted fragments, 329 content-verified, 230 line-anchored,
**230 of 230 byte-exact against the raw cited line with zero whitespace-only matches**, 27 ranged
groups verified consecutive, 41 fragments flagged as repeat-text and therefore position-verified
rather than merely content-verified, 4 resolved through a cross-file marker, 7 matched only after
joining wrapped lines, and 0 problems.**

Its first run found **65 problems in this record's own first draft.** Of those, 5 were resolver
defects (English possessives mis-read as opening quotes; same-line multi-fragment groups; a marker
lookahead that stopped at a colon and silently charged a group's fragments to the *previous*
marker; no cross-file `file.ts:NN` handling; no wrapped-line fallback) and **34 were genuine
citation defects** — including three CROSS-FILE quotes attributed to the wrong file, two TEMPLATE
strings (`<path>`) quoted as if verbatim, ten quotes falling outside their own declared span, three
off-by-one comment-block ranges, and a two-line YAML comment quoted as one unmatchable fragment.
All are corrected above. The resolver was then **mutation-tested nine ways** — falsified quote,
moved span, wrong range head with every fragment real, right content in the wrong file, a real
quote pushed outside its span, a marker past EOF, an unattributed cross-file quote, a re-indented
fragment, and a prose-only reword that must NOT fire — **9/9 behaved as required, control
included.**

One defect got past all of that and was found by an INDEPENDENT REVIEWER, which is worth recording
because it names this resolver's real blind spot. Four fragments in `phase-06.json`'s c8 citation 4
were quoted with **five** leading spaces where `gateway-name-reference.test.ts` lines 19-22 carry
exactly **one**: right content, right line numbers, **wrong bytes**. The resolver matched them
because it compared whitespace-COLLAPSED text, so indentation was invisible to it — the same class
as the job-log one-space whitespace ruling. Fixed two ways: the four fragments are re-indented, and
the resolver now re-checks every line-anchored fragment as an EXACT substring of the raw line and
reports any that matches only after collapsing. That check is mutation M9 above, and it is what
produces the 230/230 byte-exact figure. A resolver's silence is only worth what its last mutation
test bought — this one had bought eight, and the ninth existed because a reviewer measured what it
did not.

The prose is checked separately, because nothing else reads it: a sweeper resolved every `path:NN`
reference in these annotations and this pass's four defect records — **80 references, 80 resolved,
19 of them bare basenames resolved to a unique tracked file, 0 problems** — after flagging four
genuinely AMBIGUOUS bare basenames (`adapter.test.ts`, `adapter.ts`, each present in two packages),
now qualified with their repository paths. It was mutation-tested four ways including a
section-containment check and its negative control, 4/4.

Job-log quotes were byte-compared against the downloaded raw log under the one-space rule:
**18 fragments, 18 EXACT, 0 mismatched.** That comparer was itself mutation-tested four ways,
including the one nobody thinks of — right count, wrong file. It matters here: `(3 tests)` occurs at
**70 different lines** of this job's log, and `gateway-name-reference.test.ts` exists in four
packages, so a comparer keyed on a count or a bare filename would have matched the wrong suite and
reported success.

Every transcript pins the UPSTREAM BASE `9abc3fd` rather than a branch tip, so its sha resolves for
any reader after this branch merges. `git diff --name-only 9abc3fd -- packages/ e2e/ scripts/
.github/ spikes/` is **empty**, so every code, workflow and fixture file cited above is
byte-identical to the pinned commit and a grep in this tree is a grep at that sha.


- [x] Every probe script (`spikes/0N-*.mjs`, seven scripts) runs against the pinned engine and prints a PASS/FAIL/UNRESOLVED verdict — evidenced by the script's committed console output referenced from `docs/engine-baseline.md`. — **Evidence (2026-08-05):** three conjuncts, each evidenced separately. (a) *Runs against the pinned engine* — `docs/engine-baseline.md:4` records the full suite re-run at `claude` CLI **2.1.218**, inside the accepted **2.1.207–2.1.220** at `:6`. (b) *Prints a PASS/FAIL/UNRESOLVED verdict* — the committed `spikes/fixtures/0N-*.verdicts.json` files ARE those printed blocks, and every one of the seven In-scope scripts was checked mechanically to use only that three-word vocabulary and nothing else. (c) *Committed output referenced from the baseline* — the reference is `docs/engine-baseline.md:12` ("**Producing scripts:** `spikes/01-auth.mjs` … `spikes/08-tool-catalog-env.mjs`", which maps 01–07 to this phase's seven In-scope probes by name) plus the per-section `Fixture:` lines at `:33`, `:56`, `:88`, `:380` and §13's index. Committedness is proved per path with `git log` and `git cat-file -e HEAD:`, never with `ls`. **Non-vacuity:** the committed bytes independently reproduce §9's tally — 8 scripts, 32 sub-probes, 30 PASS, 2 UNRESOLVED, 0 FAIL — so `docs/engine-baseline.md:386` and the fixtures agree without either taking the other's word. Transcript `docs/evidence/phase-00/closeout/closeout-committed-and-census.txt` §1–§3.
- [x] `docs/engine-baseline.md` merged, naming the tested version + accepted range, the auth decision, the hermeticity verdict, and the Bash colon-spacing verdict. — **Evidence (2026-08-05):** four named contents = four conjuncts, all present in the merged document. Version + range: `docs/engine-baseline.md:4` and `:6`. Auth decision: `:25`, "**Go/no-go call (updated 2026-07-24):** BOTH mechanisms are now live-confirmed", with §1's two-row table carrying a **PASS** each. Hermeticity verdict: `:50`, "**All four PASS on executed-call evidence**" — and that guard matters, because `:41` records the first version of the probe being vacuous when the model refused it and made zero Bash calls. Colon-spacing verdict: `:84`, "**Verdict: the no-space form is required**", quoted with **both** arms (`:81` matched-and-allowed, `:82` did-NOT-match) since a one-armed version could not distinguish a matching anchor from one that matches nothing. **The strongest part of this is not that the four statements exist** — it is that `packages/engine-claude/src/version-gate.test.ts:109` reads the document off disk and `:113`/`:127` assert two of the four against the shipped constants on every push, so a silent divergence between the record and the code is impossible. **Honest qualification, disclosed by the document itself at `:9`:** the 2026-07-25 narrow re-baseline extended the range's upper end to 2.1.220 *without* re-running the spike suite, so the top of the range rests on a weaker evidentiary base than its 2.1.218 point, and §11 keeps the full-suite re-run at 2.1.220 on the owed list. The criterion asks that the range be *named*, which it is.
- [x] `spikes/fixtures/` committed, sanitized (no live token/path substrings — checked by the security test above), and referenced by path from the baseline doc. — **Evidence (2026-08-05):** three conjuncts. *Committed* — every path §13's index names (eight `*.verdicts.json` plus six sanitized transcript/catalog fixtures) proved with `git cat-file -e HEAD:<path>` at exit 0 and a non-zero `git log` history, plus the directory-level check that `ls spikes/fixtures | wc -l` and `git ls-files spikes/fixtures | wc -l` both return 18 and `git check-ignore` on a fixture exits 1. *Sanitized, checked by the security test* — `docs/engine-baseline.md:471` ("re-scanned for `sk-ant-*`/OAuth-token-blob/`$HOME`-path substrings with zero hits") and `:494`, which spells out the three pattern classes and adds the first-8-characters-of-the-real-token check. **Why that is not self-congratulatory:** the scan has actually FIRED and forced a fix — `:29` records the first re-run writing a real `$HOME` path into the committed fixture and tripping `scanForSecrets` with exit code 1. A scan nobody has seen fail is not yet known to bite; this one has. *Referenced by path* — §13's ten-bullet index at `:473-482`. **Deliberately NOT upgraded to `EVIDENCE-REPRODUCED`:** re-running `spikes/07-ratelimit.mjs` was available at zero live cost and was not done, because it would only re-derive what `07-ratelimit.verdicts.json` already records — and it rewrites a committed fixture, which is not something a closeout pass should do to earn a stronger label. Transcript `docs/evidence/phase-00/closeout/closeout-committed-and-census.txt` §1.
- [x] Rate-limit error/event shape captured verbatim in the baseline doc, or a documented simulation strategy recorded if a real limit could not be triggered safely. — **Evidence (2026-08-05):** this is a **disjunction**, and both halves were verified to hold rather than taking whichever was easier. Half one, *captured verbatim*: four distinct `rate_limit_info` payloads at `docs/engine-baseline.md:356-359` (`allowed`/`five_hour` with `overageStatus`, then `allowed_warning` at utilization 0.96, 0.98 and 0.99), with the envelope shape at `:350` and the four committed transcript fixtures they were read out of named at `:347` — 16 samples in total. Half two, *documented simulation strategy*: `:343`, "**No dedicated live trigger was run**", which records that the owner's subscription had already been exhausted twice during the phase and that pressing it further was unsafe, and `:378`'s MITIGATION block, which gives the opportunistic-capture procedure, the explicit never-trigger-deliberately rule, the one acceptable deliberate path (a metered account or an off-hours window), and what downstream phases may build on meanwhile. **Satisfying the disjunction twice over is worth stating because the halves cover different variants:** the verbatim capture covers `allowed`/`allowed_warning`, and the strategy covers the `rejected`/exhausted variant never observed in-stream — whose one real observation, in the error-string channel, is itself quoted verbatim at `:376`. The safety judgement is implemented in code, not just written down: `packages/engine-claude/src/live/live-harness.ts:623` aborts the live suite on a `rejected` status rather than recording it.
- [x] Every `UNRESOLVED:` entry in the baseline doc carries an explicit mitigation note; no downstream phase may cite an UNRESOLVED item as settled fact (Hard Rule 1). — **Evidence (2026-08-05):** conjunctive, and the second conjunct is a repo-wide **negative** claim, so it was censused by NOTATION rather than by one grep — a grep that cannot express a second notation returns a smaller answer with no error and reads as clean. *Conjunct 1* holds on both readings: the literal `UNRESOLVED:` form occurs exactly once (`docs/engine-baseline.md:372`, mitigation at `:378`), and on the broad reading there are four UNRESOLVED items in the document (`:268`, `:372`, §9's `ratelimit.trigger-safety-and-simulation-strategy` id named at `:404`, and `:685`) against four mitigation notes (`:270`, `:378`, `:343` plus `:378`, `:694`). *Conjunct 2 is* **clean**: 20 notations swept over the whole tracked tree (bare `rejected` 236 files/542 lines, `rate_limit` 123 files, `AskUserQuestion` 18 files, `error_max_structured_output_retries` 7 files, `"captured live"` 0, and 15 more), 46 candidate files intersected and read, 44 code-side `'rejected'`-shape lines classified one by one; every site is explicitly hedged as SDK-typed, hand-built, unobserved-live, fake-engine-only or not-probe-verified. **Two sites do better than hedging in prose**, which is why this is recorded as clean rather than merely un-violated: `packages/testkit/src/fake-engine/rate-limit-fixtures.test.ts:21` makes the prohibition an executable assertion, and `packages/engine-claude/src/live/live-harness.ts:623` inverts the polarity by aborting the live suite when a `rejected` status appears. Positive structural proof rather than "grep found nothing": `packages/engine-claude/src/limit-signal.ts` implements **both** channels `:378` prescribes — the typed path at `:82` and the error-string fallback at `:223` — and names the unobserved status in its own header at `:8`. Two nits are reported rather than buried, neither a Hard Rule 1 violation: `docs/evidence/criteria-closeout/defects/00-unresolved-hedge-nits.md`. Census: `docs/evidence/phase-00/closeout/closeout-committed-and-census.txt` §4–§5.

## Risks & open questions

- **Release velocity** (adaptation §10 #1) — 2.1.x ships weekly; mitigation: pin the exact tested version, publish the "changes that would invalidate this baseline" list, and re-run the full probe suite before adopting a newer version (phase 23's "00/06 policy").
- **`--permission-prompt-tool` undocumented schema** (§10 #2) — not probed, not built on; the SDK `canUseTool` callback is the documented equivalent phases 03/06 use instead.
- **SDK `settingSources` default ambiguity** (§10 #3) — the auth and hermeticity spikes (work items 2–3) always pass `settingSources: []` explicitly rather than probing the default; downstream phases must do the same.
- **Sandbox default read-open for credential paths** (§10 #5) — the sandbox probe (work item 5) treats `denyRead` as something that must be explicitly asserted, never assumed safe by default.
- **Subscription-auth workers share plan rate limits** (§10 #9) — the auth spike's go/no-go call and the rate-limit capture (work item 8) are both blocking inputs to phase 13's pause-and-resume design.
- **`MAX_MCP_OUTPUT_TOKENS`, hook-input field details, exact stream-json event taxonomy unconfirmed** (§10 #10) — this phase does not assert a raw event taxonomy (fixtures capture observed transcripts only, per In scope); `MAX_MCP_OUTPUT_TOKENS` is out of scope here and enforced gateway-side by phase 16 instead.
- **Verify-at-build-time items this phase must close before phase 03 proceeds:** the Bash command-prefix colon-spacing form beyond the doc's literal examples; whether `settingSources: []` is fully hermetic; the exact `--json-schema` violation behavior; the exact rate-limit error/event shape. Any of these coming back UNRESOLVED means phase 03 may use only the doc's own confirmed literal forms and must not generalize.
