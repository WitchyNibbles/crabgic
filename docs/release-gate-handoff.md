# Release-gate work — session handoff

**Written:** 2026-07-25, against release candidate `5e2c6b5`; committed the same day.
**Status:** the work described below is **committed** on `main`, not pushed.

This is session state, not a project document. Once its open items are actioned it can be
deleted. The durable analysis lives in `docs/release-gate-remediation-plan.md`.

---

## Where things stand

`e2e/release-gate-report.json` (gitignored — regenerate it, don't trust a stale copy):

| Verdict          | Count |
| ---------------- | ----- |
| PASS             | 12    |
| FAIL             | 3     |
| EVIDENCE-PENDING | 0     |

Started this session at 7 PASS / 8 EVIDENCE-PENDING. Every checklist item now either passes or
fails for a stated, actionable reason — nothing is silently unreported.

### The three remaining failures

| Item                                   | Why it fails                                                                                                                                                                | Action                                                                                                                            |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `jira-grafana-version-support-windows` | **Real finding.** Grafana 11.6 left vendor support 2026-06-25, a month before this cut, while `docs/compatibility-matrix.md` and `docker/grafana/11.6/` still commit to it. | **Deferred by the owner** — to become a future task. Do not "fix" it by weakening the check.                                      |
| `arm64-verification`                   | No ARM64 CI run has been archived yet.                                                                                                                                      | Mechanism is complete end to end; turns green on the first successful `ubuntu-24.04-arm` leg once CI runs. Nothing to build.      |
| `requirement-traceability`             | Every requirement reports `bound to no remote (Jira/Grafana) resource`.                                                                                                     | Environment-blocked: needs a live Jira Cloud tenant, and no credentials exist on this host. Corpus and evidence-linking are done. |

---

## The one genuinely open question — RESOLVED (2026-07-25)

**The supervisor idle-RSS contract was flaky at its boundary**: 104.7 MiB, then 113.9 MiB, then
under budget, against `roadmap/05`'s <100 MiB. It passed at the last gate run by luck.

**Answer: neither remedy the question offered.** Not a regression, not a stale number. The
daemon was eagerly importing an engine it never uses while idle. Full analysis, with the
measurement table, is in `docs/release-gate-remediation-plan.md` §"Resolution: the idle-RSS
breach was an eager engine import". In short:

- Idle RSS is **byte-identical flat** over 16 s (`101816 kB` at every sample) → never a leak;
  the whole footprint is module loading, and the "flakiness" was variance across boots.
- Bare Node 24.18.0 floor is **41.2 MiB**; journal+supervisor+contracts reach **65.5 MiB**;
  adding `run-dispatcher.js` jumps to **108.2 MiB** — it statically imports `@eo/engine-claude`
  → `@anthropic-ai/claude-agent-sdk`, **+40.9 MiB alone**. `resolveWorkerAuthMaterial` lived in
  that same module and is called at startup, so resolving a token pulled the engine in too.
- Fixed by moving auth resolution to `worker-auth.ts` and deferring the dispatcher import to
  first `dispatch()` (`lazy-run-dispatcher.ts`). Idle RSS is now **65.6–66.2 MiB across five
  boots — ~34% headroom**, spread down from 8.4 MiB to 0.6 MiB.

**05's documented budget stands unchanged — no spec amendment, so no owner decision was
needed.** The contract now passes on merit.

Two non-blocking notes carried into the remediation plan: the Node `>=24` floor alone eats 41%
of the budget, and two zod majors (v3 hoisted, v4 under `engine-claude`) both load once the
engine does.

---

## Inventory of what landed

Modified:

- `.github/workflows/ci.yml` — ARM64 matrix leg now writes and uploads a run record.
- `.github/workflows/drift-ci.yml` — runs the vendor support-window probe weekly.
- `e2e/matrix/git/src/evidence.ts`, `e2e/matrix/installation/src/evidence.ts` — added the
  `$EO_RELEASE_CANDIDATE_OBJECT_ID` fallback (see Gotchas — the single highest-impact fix).
- `e2e/matrix/git/test/evidence.test.ts`, `e2e/matrix/installation/test/evidence.test.ts` —
  control the env var explicitly, plus regression tests.
- `package.json` — wired `e2e/attestation` into `test:e2e`, `test:e2e:release-evidence` and
  `check:e2e-types`; added `probe:support-windows`, and `tsx` as the devDependency that runs
  it. The script was authored against a `tsx` this repo did not depend on, so
  `npm run probe:support-windows` failed with `tsx: not found` — and because the drift-ci step
  is `continue-on-error` with `if-no-files-found: warn`, the weekly probe would have failed
  silently and green.
- `packages/cli/src/bin/supervisord.ts` — boots via the lazy dispatcher and `worker-auth.js`,
  keeping the engine out of the daemon's boot graph.
- `packages/cli/src/daemon/run-dispatcher.ts` — `resolveWorkerAuthMaterial` moved out (to
  `worker-auth.ts`); the now-unused `readFile` import dropped.

New:

- `packages/cli/src/daemon/worker-auth.ts` + `worker-auth.test.ts` — engine-free credential
  resolution, previously untested anywhere.
- `packages/cli/src/daemon/lazy-run-dispatcher.ts` + `lazy-run-dispatcher.test.ts` — defers the
  engine import to first dispatch. **This is the idle-RSS fix.**
- `e2e/attestation/` — the release-cut attestation harness (13 test files, 148 tests).
- `e2e/provisioning/src/supportWindows.ts`, `supportWindowsCli.ts` + their tests — the vendor
  support-window prober.
- `docs/vendor-support-policy.json` — human-attested, source-cited vendor support-end dates.
- `docs/evidence/phase-23/vendor-support-windows.json` — probe output (regenerable).
- `docs/release-gate-remediation-plan.md` — the audit and plan.
- `docs/release-gate-handoff.md` — this file.

---

## How to run things

```bash
# Regenerate the gate report end to end (the authoritative check).
S=$(mktemp -d)
export EO_RELEASE_GATE_JOURNAL_DIR="$S/journal"
export EO_RELEASE_CANDIDATE_OBJECT_ID="$(git rev-parse HEAD)"
npm run test:e2e:release-evidence          # all 8 e2e projects, sequentially
node e2e/report/dist/cli.js                # writes e2e/release-gate-report.json

# Individual projects
npx vitest run --config e2e/attestation/vitest.config.ts
npx vitest run --config e2e/provisioning/vitest.config.ts

# Re-probe vendor support windows (needs network)
npm run probe:support-windows

# Gates
npm run check:e2e-types && npx eslint e2e && npx prettier --check "e2e/**/*.ts"
```

Last full verification: prettier + eslint + `check:e2e-types` clean; attestation 148 tests
(94.4% statements / 83.7% branches), provisioning 53, git 36, installation 46; full
release-evidence chain exit 0.

---

## Gotchas found the hard way

Non-obvious things that cost real time. Worth knowing before touching this area again.

**Evidence linking.** `e2e/report`'s generator links an `EvidenceRecord` to a checklist item
only when BOTH the `gateTag` matches AND `objectId` equals the report's
`releaseCandidateObjectId`. `e2e/matrix/git` and `e2e/matrix/installation` were stamping their
throwaway repo's own object ID, so their evidence was **structurally unlinkable** — genuine,
green, and invisible to the gate forever. Emitting evidence that cannot link is
indistinguishable, at the gate, from emitting none.

**`requirementId` is the traceability join key.** `EvidenceRecord.requirementId` is optional in
02's schema and was `undefined` at essentially every emission site, and 21's
`buildTraceabilityView` matches evidence to a requirement on that field alone. Traceability
could never have linked anything regardless of evidence volume.

**Perf measurement.**

- `trySampleProcess` from `@eo/perf` is **async**. Not awaiting it yields a Promise whose
  `.stat` is `undefined`.
- The daemon's control socket path must stay under the **108-byte `sun_path` limit**. A
  conventional `mkdtemp(tmpdir(), "eo-perf-release-")` root plus a 32-char project hash
  overruns it, and the daemon dies with `listen EINVAL` before it can be sampled. Hence the
  terse `eo-p` prefix and 9-char hash.
- Sample **`VmRSS`**, not `VmHWM`. The high-water mark is cumulative since process start, so it
  carries the startup peak into every "idle" sample.
- Exclude startup. A window opened at spawn measures module loading and socket bind — the first
  run reported **123% of a core** against a 1% budget, which is true about booting and false
  about idling.
- `decide()` enforces `MIN_INTERLEAVED_REPETITIONS = 10` per side and refuses below it. One
  whole-window average is not a sample series.

**Test wiring.**

- `e2e/provisioning`'s vitest config includes **`test/**` only**, not `src/**`. A test placed in
  `src/` silently never runs — caught here only by a coverage drop to 54%.
- `npm run test:e2e:release-evidence` exports `EO_RELEASE_CANDIDATE_OBJECT_ID` for the whole
  chain, so any test asserting a scenario-local `objectId` must save/delete/restore it, or it
  asserts one thing locally and another in CI.

**API shapes that differ from the obvious guess.**

- `lint(candidate, kind, policy)` — three positional args, and `LintOutcome` is a discriminated
  union (`{ok: true}` | `{ok: false, findings}`).
- `nameBranch` is **async** and returns `{status: "named", branchName}` | `{status: "blocked", …}`.
- `createGitPlumbing()` takes options, not a spawn function.
- `renderPrTitle` / `renderPrBody` / `renderReviewComment` take domain fields
  (`{type, outcome}` / `{outcome, validation, risk, tracking}` / `{finding, evidence, action}`).
- Node's `child_process` rejects any argv entry containing `NUL`, so `git log -z` cannot be
  expressed through `execFile`.

**Running TypeScript outside vitest.** The `e2e/*` projects are typechecked with `--noEmit` and
executed by vitest, so nothing in them is ever compiled to `dist/`. A standalone CLI under
`e2e/` therefore needs a TS runner — `node file.ts` will not do, because Node 24's native type
stripping does not remap a `./foo.js` specifier onto `foo.ts`, and every import in these
projects is written `.js`-extended for `verbatimModuleSyntax`. Hence the `tsx` devDependency.

---

## Design notes worth carrying forward

- **`e2e/attestation/` exists** because the seven items it covers attest to properties of the
  release candidate's own committed state (docs, journal, traceability, platform coverage)
  rather than exercising a subsystem against live infrastructure — which is precisely why no
  matrix harness covered them.
- **Verdicts are data, not test outcomes.** The emitter suite asserts that evidence was emitted
  _correctly_ (right tag, right object ID, schema-valid, exit status faithful to the verdict)
  and never asserts the verdict itself. If it went red on a FAIL, the release-evidence run would
  abort and the report would be generated from a partial journal — failing items would revert to
  showing "no evidence" instead of "checked, here is what is wrong".
- **`emitAttestationEvidence` derives `exitStatus` from the verdict** and does not accept it as
  a parameter. A caller cannot journal a green record for a failing check.
- The vendor support-window design splits **mechanical** facts (is the tag published? — probed
  live) from **attested** ones (when does support end? — human-recorded with a cited source),
  because Atlassian and Grafana publish EOL dates as prose, and scraping prose then calling it
  verified evidence is exactly what this phase forbids.
