# Phase 03 evidence

This directory is the evidence trail for `roadmap/03-envelope-compiler-engine-adapter.md`'s
exit criteria, following the same convention `docs/evidence/phase-02/README.md` established:
each file name is prefixed `wiN-` (work item N) or `exit-criteria-`, describes what it
captures, and — where the phase's own choreography calls for "failing-first" — a
`*-failing.txt` file captured **before** the implementation landed, paired with a
`*-passing.txt` file captured **after**.

Two workers built this phase. **W1** built `packages/engine-core` in full (work items 1-4:
the `EngineAdapter` contract types, `compileEnvelope`'s permission/sandbox emission, the
`WorkerSettingsJson`/`WorkerSdkOptions` serializers, the golden settings artifacts, and the
footgun/property/mutation suites) — evidence files `wi1-*` through `wi4-*`, dated
2026-07-17. **W2** (this worker) built the scriptable fake engine and the
envelope-conformance fixture format in `packages/testkit` (work items 5-6), plus this
directory's integration README and package-gate capture — evidence files `wi5-*`/`wi6-*`
and `exit-criteria-package-gate.txt`, dated 2026-07-18. Every claim below was verified
against the cited evidence file's actual content before being cited here.

## Exit-criteria → evidence map

| # | Exit criterion (roadmap/03-envelope-compiler-engine-adapter.md) | Owner | Evidence file(s) |
| --- | --- | --- | --- |
| 1 | `EngineCapabilities` field-exhaustiveness test passes: exactly `supportsJsonSchema, supportsSessionResume, permissionModel, sandboxModel, engineVersion`, no more, no fewer (Gap 7) | W1 | `wi1-adapter-types-failing.txt`, `wi1-adapter-types-passing.txt` (23/23 tests green, incl. the runtime-keys test and the `ENGINE_CAPABILITIES_FIELD_NAMES` exhaustiveness assertion) |
| 2 | Compiler property suite (no allow outside the envelope; mandatory denies survive any envelope; no blanket `mcp__*` deny ever emitted) green at ≥10k fast-check cases in CI | W1 | `wi4-footguns-failing.txt`, `wi4-footguns-passing.txt` (`footguns/property.test.ts`'s three properties + `mcp-deny.test.ts`'s own property each run at `numRuns: 10000`, all green) |
| 3 | Golden settings artifacts for the three canonical envelopes (read-only, standard implementation, network-granted) committed and byte-stable across two consecutive builds | W1 | `wi3-sandbox-goldens-failing.txt`, `wi3-sandbox-goldens-passing.txt` (Part 2: `tsc -b --force` + `write-goldens.ts` run twice, `diff -r` empty across all 6 committed artifacts) |
| 4 | Fake-engine replay parity: every fixture in the initial envelope-conformance set produces its hand-derived expected per-layer verdict | **W2** | `wi6-conformance-failing.txt`, `wi6-conformance-passing.txt` (`conformance-fixtures/fixtures.test.ts`, 7/7 fixtures reproduce their hand-derived `{permissions, adjudication, sandbox}` verdicts — the test file's own title cites this exit criterion verbatim); cross-checked against the actual committed `spikes/fixtures/*.verdicts.json` files in `wi5-fake-engine-passing.txt`'s `parity.test.ts` portion (deliverable 5) |
| 5 | Demo test: spawn fake worker → attempt a smuggled command (`allowed-cmd && curl …`) → observe denial → receive a structured `WorkerResult`-shaped failure — runs green in CI with no `claude` binary installed | **W2** | `wi5-fake-engine-failing.txt`, `wi5-fake-engine-passing.txt` (`demo.test.ts`'s single test, green; `FakeEngineAdapter` spawns no subprocess anywhere in `packages/testkit`, so "no `claude` binary installed" holds by construction) |
| 6 | Mutation suite: each seeded broken-compiler variant (blanket `mcp__*` deny; missing control-repo `denyRead`; space-before-colon `Bash` literal) is caught by a failing test, recorded in the mutation-test report | W1 | `wi4-mutation-report.txt` (all 3 seeds: real-output negative control PASS + seeded-variant CAUGHT, each with its expected typed error) |

## W2's additional deliverables (roadmap/03 work items 5-6, beyond the 6 exit criteria)

| What | Evidence file(s) |
| --- | --- |
| Fake engine implementing `EngineAdapter` — permission/sandbox/adjudication layer evaluators, `FakeEngineAdapter.spawn/resume/cancel/capabilities`, injectable failure modes (crash, `limitSignal`, schema-violating result, hang/timeout), all exercised through the public adapter surface | `wi5-fake-engine-failing.txt`, `wi5-fake-engine-passing.txt` |
| Adjudication-hook-bypass security test (fail-closed: throwing callback, and a runtime-bypassed/non-function callback) | `wi5-fake-engine-failing.txt`/`-passing.txt` (`fake-engine-adapter.security.test.ts`, `adjudication-layer.test.ts`) |
| Envelope-conformance fixture format (`z.object(...).strict()`) + validator, RED-first against a fixture missing a required per-layer verdict field | `wi6-conformance-failing.txt`, `wi6-conformance-passing.txt` |
| Package wiring: `@eo/engine-core` dependency, tsconfig project reference, barrel export | `exit-criteria-package-gate.txt` §1 (clean `tsc -b`) |
| Full package gate: `tsc -b`, `vitest run`, `lint`, `format`, gateway sole-definition-site scanner | `exit-criteria-package-gate.txt` |

## Deviations

### Carried from W1 (`packages/engine-core/README.md`, briefly — full text there)

1. **Seam decision: control-repo/journal deny-path literals are XDG-DEFAULT fallbacks**
   (`~/.local/state/engineering-orchestrator/**`, `~/.cache/engineering-orchestrator/**`),
   deliberately simpler than phase 04's eventual `$XDG_STATE_HOME`/`$XDG_CACHE_HOME`-resolved,
   per-project-hash-nested convention — `packages/engine-core` cannot depend on `@eo/journal`
   (phase 04) without creating a forbidden edge. **W2 found a downstream consequence of this
   seam** during the full-repo regression pass: `packages/journal/src/layout/
   xdg-sole-definition.test.ts` (a concurrent phase-04 worker's own sole-definition-site
   scanner) flags `packages/engine-core/src/compiler/xdg-default-paths.ts` as a
   "reimplementation" of XDG root resolution. This is a genuine cross-phase interface gap
   between two already-landed pieces of work, not something introduced by either this phase's
   worker — confirmed via `git stash` that it reproduces identically with every one of W2's
   changes removed. **Reported only** (`packages/engine-core` is frozen and
   `packages/journal` is a concurrent worker's package — see
   `exit-criteria-package-gate.txt`'s closing note for the full write-up); W1's own README
   already names the exact obligation this satisfies: "once both `@eo/engine-core` and
   `@eo/journal` are linked by a downstream phase, 05/06 must add a consistency test proving
   these defaults never silently diverge" — that consistency test is what should resolve this,
   not an edit to either frozen/owned package.
2. **Placeholder-token convention for `sandbox.filesystem.allowWrite`**: `<worktree>`/
   `<worker-tmp>` symbolic tokens, since `compileEnvelope`'s signature has no worktree/tmp
   path parameter (phase 06/07 substitute the real absolute paths at spawn time). **This
   directly shaped W2's own sandbox-layer scope decision below.**
3. **Placeholder value for `WorkerSdkOptions.mcpServers`**: an empty object
   (`{ [GATEWAY_MCP_SERVER_NAME]: {} }`) — this pure compiler has no access to a live, wired
   SDK MCP server instance (phase 16's job).
4. **Deviation from adaptation Appendix B's illustrative sketch**: no unconditional
   `Read`/`Grep`/`Glob` allow, no `Edit(//.../worktree/.git/**)` deny, no
   `sandbox.credentials.files` sub-block — roadmap/03's own binding work-item-2 text
   ("contains only … ") is stricter than that older sketch.

### W2's own decisions

1. **Sandbox-layer (layer 4) scope, `sandbox-evaluator.ts`**: checks
   `network.allowedDomains` (Bash-invoked network commands) and `filesystem.denyRead`
   (Edit/Write/Read path containment) only — deliberately **not** `filesystem.allowWrite`,
   which the compiled profile only ever populates with W1's `<worktree>`/`<worker-tmp>`
   placeholder tokens (deviation 2 above), un-testable without phase 06/07's spawn-time path
   substitution. Documented directly in `sandbox-evaluator.ts`'s own doc comment. This is why
   the `path-escape-relative`/`path-escape-absolute` conformance fixtures record
   `sandbox: "allow"` even though the permission layer (layer 2) denies both — a genuine,
   honest demonstration that the two layers catch different things, not an evaluator bug.
2. **Path-matching anchor convention (`path-matching.ts`)** — **SUPERSEDED 2026-07-18, see
   "Validation round" below**: originally, the `//`-anchor form was matched against
   worktree-relative target path strings by treating `//` itself as a synonym for
   "worktree-relative" (the opposite partition from the real engine's filesystem-root
   anchor). The 2026-07-18 security-fix round corrected this: `//` now resolves the SAME
   `WORKTREE_WRITE_PLACEHOLDER` token the compiler emits, stripping it specifically rather
   than treating the whole `//` anchor as worktree-relative. `~/` and bare `/` anchors are
   still matched literally (home-relative / filesystem-absolute).
3. **Envelope-conformance fixture `permissionOverride`/`additionalPermissionLevels` fields**:
   two of the seven fixtures (`compound-command-smuggling`, `process-wrapper-smuggling`) and
   both deny-wins fixtures bypass `compileEnvelope`'s own mandatory allow/deny set entirely,
   replacing it with the minimal `Bash(echo:*)`-only ruleset docs/engine-baseline.md §3's own
   live probes actually used — the closest possible parity with the recorded probe setup
   (see `parity.test.ts` and each fixture's own `baselineCitation`/`description` fields).
4. **`toWorkerResult` (`engine-result-to-worker-result.ts`)**: this worker's own
   minimal-sufficient mapping from a terminal `EngineResultEvent` to a `WorkerResult`, built
   only to make exit criterion 5's "receive a structured `WorkerResult`-shaped failure"
   concretely demonstrable. Not pinned by any cited roadmap/03 source — phases 13/06 own the
   real `EngineResultEvent`-to-scheduler mapping downstream of this phase.
5. **`FakeEngineAdapter` is constructed with one `FakeEngineScript` per instance** (not a
   `TaskPacket`-keyed script resolver) — the simplest shape satisfying "scriptable" for this
   phase's own tests; a resume continuation is expressed via the script's own optional
   `onResume` field rather than a second registration call.
6. **The adjudication layer (layer 3) runs for every scripted tool call**, regardless of the
   permission layer's own verdict — matches `@eo/engine-core`'s adapter-responsibility doc
   ("Every `AdjudicationCallback` invocation → `adjudication_decision` … Per tool call").

## Validation round (2026-07-18)

An adversarial Opus validator reproduced 1 CRITICAL, 2 MAJOR, and 2 lower-severity findings
against this phase's otherwise-green build. All were fixed with TDD (RED reproducing the
validator's exact attack against the unfixed code, then GREEN). Full per-finding fix summary
is in the security-fix worker's own report; this section is the permanent evidence-trail
record.

### CRITICAL 1 — owned-path confinement escape via unanchored `//` emission

`permission-profile.ts`'s `emitPermissionProfile` compiled `envelope.ownedPaths` directly
into `Edit(//${path}/**)`/`Write(//${path}/**)` with no validation and no worktree anchoring.
`//` is the filesystem-root anchor (adaptation §4.1), so `ownedPaths:["etc/cron.d"]` compiled
to `Edit(//etc/cron.d/**)` = `/etc/cron.d/**`, an absolute system grant from an
innocuous-looking relative path (`["home/victim/.ssh"]`, `["**"]`, `[".."]`, `[".git"]` all
escaped the same way). No Edit/Write deny backstop existed, and the fake engine's own
`//`-anchor semantics were the OPPOSITE partition from the real engine's, so every test was
green and the escape was invisible.

**Fix**: `owned-path.ts`'s `validateOwnedPath` rejects (throws `EnvelopeCompilationError`)
absolute/home-anchored/`..`-bearing/glob-bearing owned paths; every validated path is now
emitted worktree-anchored via a token (`worktree-placeholders.ts`) shared with the sandbox
layer — `Edit(//<worktree>/${relpath}/**)`; Edit/Write deny backstops added for every
sensitive root plus the worktree's own `.git`. Two new structural invariants
(`assertAllOwnedPathAllowRulesAreWorktreeScoped`, `assertEditWriteDenyBackstopPresent`) and
two new mutation seeds guard this. The property suite's "no allow outside the envelope" test
was rewritten from a tautological string-equality check to a genuinely semantic confinement
check (`confinement-check.ts`). `@eo/testkit`'s fake `path-matching.ts` was corrected to
resolve the same worktree placeholder rather than silently redefining `//` as
worktree-relative. Evidence: `fix-crit1-owned-path-escape-failing.txt` /
`fix-crit1-owned-path-escape-passing.txt`. Full writeup:
`packages/engine-core/README.md`'s "Security-fix round (2026-07-18)" section.

### MAJOR 2 — fake bash evaluator allows shell-metacharacter smuggling

`@eo/testkit`'s `bash-command-matching.ts` only split compound commands on
`&&`/`||`/`;`/`|`. `git status & curl evil`, `git status $(curl evil)`, and
`` git status `curl evil` `` all evaluated as ALLOW — the whole string stayed one segment
that `.startsWith("git status ")`, an unmatched trailing command smuggled through as if it
were part of the allowed prefix. This fake engine is the conformance oracle reused by 05/06.

**Fix**: `containsUnprovenShellMetacharacter` (`bash-command-matching.ts`) flags any segment
carrying `&`, `$`, backtick, `<`, `>`, or a newline — characters docs/engine-baseline.md §3
never probed — and `permission-evaluator.ts`'s `bashCommandMatchesEveryRule` denies the whole
command outright if any segment carries one, even if it also happens to match an allowed
prefix lexically. Evidence: `fix-major2-shell-metachar-failing.txt` /
`fix-major2-shell-metachar-passing.txt`.

### MAJOR 3 — tautological property/anchor-forms tests

`footguns/property.test.ts`'s "no allow outside the envelope" property re-derived the exact
string the compiler itself emitted (`rule === Edit(//${path}/**)`) and asserted equality —
passed for ANY hostile path, unable to detect a confinement escape by construction.
`anchor-forms.test.ts` fed `ownedPaths:["~/.ssh", ...]` and asserted the resulting
`Edit(//~/.ssh/**)` allow rule was CORRECT output — framing the CRITICAL 1 escape as
intended behavior.

**Fix**: the property is now semantic (see CRITICAL 1 above); `anchor-forms.test.ts` now
asserts `compileEnvelope` THROWS on the same `~/`-prefixed input it previously endorsed.
`envelope-arbitrary.ts` now generates `ownedPaths`/`networkDestinations` in two buckets
(well-formed, malformed) so the general property suite never throws unexpectedly while two
new dedicated properties assert malformed inputs are always rejected. `numRuns` bumped from
5000 to 10000 in `anchor-forms.test.ts` and `smuggling.test.ts` (Test plan says ≥10k). Two
new mutation seeds added. Evidence: `fix-major3-tautological-property-failing.txt` /
`fix-major3-tautological-property-passing.txt`.

### MINOR 4 — unvalidated `networkDestinations`

`sandbox-profile.ts` copied `envelope.networkDestinations` into `network.allowedDomains`
verbatim; `*`, `**`, `0.0.0.0/0`, `http://evil`, `evil.com:443` all passed through. Fixed by
`network-destination.ts`'s `validateNetworkDestination`, rejecting empty/wildcard/scheme/
path-or-CIDR/port-bearing entries. Not one of the three files given a dedicated RED/GREEN
evidence pair (the task scoped that requirement to the CRITICAL + 2 MAJOR findings only);
covered instead by unit tests in `sandbox-profile.test.ts` and a property test in
`property.test.ts`.

### NOTE 5 — cross-anchor sensitive-path evasion (fake-engine fidelity limitation)

The fake path matcher was purely anchor-partitioned: an absolute-spelled read
(`/home/user/.ssh/id_rsa`) did not match a `~/`-anchored deny (`Read(~/.ssh/**)`), though the
real engine resolves `~` and would deny it — a potential false-ALLOW in the oracle. Hardened
(not fully solved — documented as a known fidelity limitation, see
`path-matching.ts`/`path-matching.test.ts`): a bare-absolute target that lexically resolves
under a known sensitive suffix now still hits the `~/`-anchored deny. This widening can only
ever produce a false-DENY (over-blocking), never a false-ALLOW, because this compiler never
emits a `~/`-anchored ALLOW rule. A genuine gap remains for case-insensitive-filesystem
spellings — documented as a known limitation, not fixed (would require a full home-directory
resolution model, out of this fake's scope).

### Engine-fact-drift gap recorded by this round

`docs/engine-baseline.md` §3 has no path-anchor probe at all. The compiler now commits to the
`//<worktree>/…/**` worktree-anchored form as its confinement mechanism, but the exact
real-engine matching semantics of that substituted form are UNPROBED — a phase-00-style probe
is owed to phase 06's `@live` suite, exactly as Gap 12 handled Bash colon-spacing. Flagged for
the orchestrator to carry to `docs/interface-ledger.md` at the next reconcile.

### Independent re-audit (2026-07-18) and LOW-residual dispositions

A fresh, context-free adversarial Opus re-audit re-attacked all five findings against the fixed
compiled output (~28 hostile `ownedPaths` through the real `compileEnvelope`; the full shell-
metacharacter smuggling battery; independent verification that `footguns/confinement-check.ts`'s
matcher is genuinely independent and non-vacuous; goldens regenerated byte-identical; 316 tests
green) and returned **PASS** — every CRITICAL/MAJOR/MINOR closed, no new CRITICAL/MAJOR, no
vacuous test. It raised three LOW observations, disposed of as follows:

1. **Latent flake (fixed):** the positive-confinement property asserted `isEditAllowed(profile,
   \`${ownedPath}/file.ts\`) === true` for every generated owned path, which would flip to false
   if fast-check ever produced a sole owned path of exactly `.git` (deny-shadowed by the
   `Edit/Write(//<worktree>/.git/**)` backstop). Closed by excluding `.git` from
   `envelope-arbitrary.ts`'s `safeSegmentArbitrary` pool — no negative coverage lost (`.git` is a
   well-formed, never-malformed path; only its deny-shadowed positive assertion was flaky).
2. **Bare `.` network destination (fixed):** `validateNetworkDestination` now rejects any entry
   with no alphanumeric label character (bare `.`, `..`, `-`), with malformed-arbitrary coverage.
3. **Owned-path empty-interior-segment / control chars (accepted LOW residual):** `foo//bar`,
   `foo\nbar` survive validation but stay strictly `//<worktree>/`-anchored — no filesystem
   escape is possible, only cosmetically odd rule strings; a settings-rule-parser injection via an
   embedded newline is not demonstrable (the value remains a single escaped JSON string). Left as
   documented defense-in-depth hardening for a future pass rather than expanded here.

Post-disposition gate: `tsc -b packages/engine-core packages/testkit` clean; 316 tests green;
goldens unaffected (no compiler emission logic changed by dispositions 1–2 beyond the added
network rejection, which the canonical envelopes never trigger).

## Worker provenance

- **W1** — `packages/engine-core` (roadmap/03 work items 1-4), `packages/engine-core/README.md`,
  evidence `wi1-*` through `wi4-*` and `wi4-mutation-report.txt`. Dated 2026-07-17.
- **W2** (this worker) — `packages/testkit/src/fake-engine/**` (roadmap/03 work items 5-6),
  this README, evidence `wi5-*`, `wi6-*`, and `exit-criteria-package-gate.txt`. Dated
  2026-07-18.
