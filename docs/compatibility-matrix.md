# Compatibility matrix

**Status:** Phase 23 (release hardening) work item 9. Every claim below cites its source —
`docs/engine-baseline.md`, a `docs/evidence/phase-*/` record, or a container recipe under
`docker/`. Where a claim is cassette-modeled, pending a live run, or blocked on a vendor
publication gap, it is marked **EVIDENCE-PENDING** explicitly — no aspirational text.

## Claude Code / Agent SDK

| Component                                                | Tested / accepted range                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Source                                                                                                                                                                                                                                                                              |
| -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `claude` CLI (Claude Code)                               | **2.1.207 – 2.1.220** (accepted range). The upper end covers the **CLI transport only** and rests on a narrower evidentiary base than the rest of the range: the 2026-07-25 re-baseline that extended it to 2.1.220 was deliberately narrow — no spike was re-run, no fixture regenerated, and §10's invalidation list was not re-checked item-by-item. The **full spike suite was last run at 2.1.218** (see the sub-probe row below); a full-suite re-run at 2.1.220 is recorded as owed.                                                                                                                                             | `docs/engine-baseline.md` header ("Accepted range: **2.1.207–2.1.220**" and the "Narrow re-baseline (2026-07-25)" paragraph) + §10 + §11 ("Full-suite re-run at 2.1.220 … OWED"). Doc baseline (`docs/claude-code-adaptation.md`) itself was verified against 2.1.207 (2026-07-12). |
| `@anthropic-ai/claude-agent-sdk`                         | **0.3.207 – 0.3.218** — deliberately **not** extended alongside the CLI range, and the two are therefore no longer symmetric. Only the host's `PATH` `claude` moved to 2.1.220; the SDK transport still runs the engine binary bundled with `0.3.218`, which reports `2.1.218 (Claude Code)`. The documented 1:1 release correspondence (`0.3.210`↔`2.1.210`, `0.3.218`↔`2.1.218`) does not oblige syncing them: bumping the SDK dependency is a separate act with its own evidence requirement, and it was not bumped. `EXPECTED_SDK_PIN` (`e2e/release/src/enginePinCheck.ts`) stays `0.3.218` accordingly.                           | `docs/engine-baseline.md` header ("Transport caveat, load-bearing") + §10 (final bullet: "**The two ranges are deliberately no longer symmetric**")                                                                                                                                 |
| Pinned release version (exact, in the published package) | Recorded as **EVIDENCE-PENDING** in this pass — the exact pin is asserted by the `engine-pin-lint` CI check (`scripts/check-engine-pin.mjs`, cited in `docs/evidence/phase-06/wi6-security-hardening.md`: "`node scripts/check-engine-pin.mjs` → PASS") against whatever version is checked out at release-tag time, not a fixed literal this document should restate independently (it would drift out of sync with the lockfile). The release-gate report (the generated release-gate report) carries the `engine-pin-recorded` checklist item, currently `EVIDENCE-PENDING` (interim scoring; see "What is EVIDENCE-PENDING" below). | `docs/evidence/phase-06/wi6-security-hardening.md`; `e2e/report/src/checklist.ts`                                                                                                                                                                                                   |
| 30 of 32 recorded engine sub-probes                      | PASS, zero FAIL, at **both of the two versions the suite has actually been run at — 2.1.210 and 2.1.218** — with zero behavioral delta between them. **Nothing has been verified at 2.1.220 in the spike-suite sense:** the 2026-07-25 round that took the accepted range there re-ran no spike, so this tally is unchanged and remains a set of 2.1.218 figures, not a claim about 2.1.220.                                                                                                                                                                                                                                            | `docs/engine-baseline.md` §9 ("Full verdict tally", incl. "**Narrow re-baseline (2026-07-25, CLI 2.1.220): this tally is UNCHANGED**")                                                                                                                                              |
| Remaining UNRESOLVED engine facts                        | `ratelimit.trigger-safety-and-simulation-strategy`, `ratelimit.exhausted-variant-shape` (opportunistic capture only — never deliberately triggered against the owner's subscription, per the repo's own safety rule)                                                                                                                                                                                                                                                                                                                                                                                                                    | `docs/engine-baseline.md` §8, §9, §11                                                                                                                                                                                                                                               |

Every downstream package that touches engine behavior cites this exact document, never memory
— per this repository's own ground rule (`CLAUDE.md`: "Engine facts about Claude Code drift
weekly. Anything engine-touching cites `docs/engine-baseline.md`").

## Jira

| Target                                | Status                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | Source                                                                                                                       |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Jira Cloud (v3 API)                   | Cassette-modeled + live sandbox tenant provisioned per phase 18's own note; conformance suite parameterized                                                                                                                                                                                                                                                                                                                                                                                                                         | `roadmap/18-jira-cloud-adapter.md`; `docs/evidence/phase-18/README.md`                                                       |
| Jira Data Center **10.3**             | Container recipe committed: `docker/jira-datacenter/10.3/docker-compose.yml`                                                                                                                                                                                                                                                                                                                                                                                                                                                        | `docker/jira-datacenter/10.3/docker-compose.yml`; `docker/jira-datacenter/README.md`; `docker/jira-datacenter/smoke-test.sh` |
| Jira Data Center **11.3**             | Container recipe committed: `docker/jira-datacenter/11.3/docker-compose.yml`                                                                                                                                                                                                                                                                                                                                                                                                                                                        | `docker/jira-datacenter/11.3/docker-compose.yml`                                                                             |
| Live DC container conformance run     | **EVIDENCE-PENDING.** The provisioning harness (`e2e/provisioning/src/provisioning.ts`, health-probe/compose-runner) and its own unit suite are real and passing (see "Provisioning harness" below), but a full parameterized-conformance run against both DC containers as part of a release-candidate cut has not been captured in this pass — the release-gate report's `jira-grafana-exactly-once` and `jira-grafana-version-support-windows` items are both `EVIDENCE-PENDING` as of the current release-gate-report snapshot. | `e2e/report/src/checklist.ts`                                                                                                |
| Vendor support-window re-confirmation | **EVIDENCE-PENDING** — owed at the actual release cut, per 19's own deferred note and this phase's own exit criterion ("Jira DC / Grafana version-support windows re-confirmed current at release time"). Not re-checked as part of this docs-only pass.                                                                                                                                                                                                                                                                            | `roadmap/23-release-hardening.md` Exit criteria; `roadmap/19-jira-datacenter-adapter.md`                                     |

## Grafana

| Target                                | Status                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Source                                                                                                                                                                                                                                                                                                                                                     |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Grafana Cloud                         | Cassette-modeled (cassette refresh mechanism per phase 20's own note)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | `roadmap/20-grafana-adapters.md`; `docs/evidence/phase-20/README.md`                                                                                                                                                                                                                                                                                       |
| Grafana OSS **12.4**                  | Container recipe committed and **live-smoke-tested, PASS**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | `docker/grafana/12.4/docker-compose.yml`; `docs/evidence/phase-23/provisioning/grafana-12.4-oss-smoke-test.txt`                                                                                                                                                                                                                                            |
| Grafana Enterprise **12.4**           | Container recipe committed and **live-smoke-tested, PASS**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | `docker/grafana/12.4/docker-compose.enterprise.yml`; `docs/evidence/phase-23/provisioning/grafana-12.4-enterprise-smoke-test.txt`                                                                                                                                                                                                                          |
| Grafana Enterprise **13.1**           | Container recipe committed and **live-smoke-tested, PASS** (image `grafana/grafana-enterprise:13.1` exists on Docker Hub, confirmed `200` as of 2026-07-24)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | `docker/grafana/13.1/docker-compose.enterprise.yml`; `docs/evidence/phase-23/provisioning/grafana-13.1-enterprise-smoke-test.txt`; `docs/evidence/phase-23/provisioning/grafana-13.1-tag-check.txt`                                                                                                                                                        |
| Grafana **OSS 13.1**                  | **NOT vendor-published as of this pass — a genuine, reproducible vendor-timing asymmetry, not a defect in this recipe.** Docker Hub returns `404` for `grafana/grafana-oss:13.1`, `:13.1.0`, and `:13.1.1`; the newest published OSS tag observed is `13.0.2`. `grafana/grafana-enterprise:13.1` was published (`tag_last_pushed: 2026-07-22T05:51:24Z`) two days before this repo's project date, but no corresponding OSS tag has followed yet. The recipe (`docker/grafana/13.1/docker-compose.yml`) is pinned to the conventional first-patch tag (`13.1.0`) it will resolve to the moment Grafana Labs publishes it — **no change to the compose file is required**, only the vendor's own publication. The live smoke test against this recipe fails today with `manifest unknown` (captured verbatim, not hidden). | `docs/evidence/phase-23/provisioning/grafana-13.1-tag-check.txt`; `docs/evidence/phase-23/provisioning/grafana-13.1-oss-smoke-test-FAILS-vendor-tag-not-published.txt`; corroborated by `docs/evidence/phase-23/provisioning/live-test-run.txt` (the `grafana-oss.live.test.ts` live suite: 1 failed / 3 passed, the one failure being this exact tag gap) |
| Vendor support-window re-confirmation | **EVIDENCE-PENDING** — same disclosure as Jira DC above; owed at the actual release cut.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | `roadmap/23-release-hardening.md` Exit criteria                                                                                                                                                                                                                                                                                                            |

### Grafana 11.6 — RETIRED from the supported matrix (2026-07-26)

Grafana OSS and Enterprise **11.6** were committed to by earlier revisions of this
document and have been **withdrawn**, owner-ratified. They are not a supported target of
this release.

The reason is a real vendor event rather than a convenience: Grafana Labs supports each
minor for 9 months, and **11.6.x left support on 2026-06-25** — a month before this cut —
per <https://grafana.com/docs/grafana/latest/upgrade-guide/when-to-upgrade/>, which lists
its support level as "Not Supported". The support-window probe
(`e2e/provisioning/src/supportWindows.ts`) surfaced it, and
`e2e/attestation/src/versionSupportWindows.ts` reported this document as "shipping an
out-of-support version" for as long as the commitment stood. roadmap/23's own exit
criterion (`:134`, "fixtures refreshed if vendor support windows moved") prescribes
refreshing the fixture, which is what withdrawing the target does; weakening the check
instead would have manufactured a green gate over a true finding.

Two self-managed Grafana targets remain committed, both inside their windows: **12.4**
(supported to 2027-05-24) and **13.1** (to 2027-03-20).

What this does **not** change: `packages/connectors-grafana` keeps its 11.6
capability-discovery fixture. Which builds the adapter can _talk to_ is roadmap/20's scope
— its §In scope names 11.6/12.4/13.1 as compatibility fixtures — and roadmap/23 lists
adapter fixtures under §Out of scope. "We provision and support this version" and "the
adapter understands this version's API shape" are different claims; only the first is
withdrawn here. The `docker/grafana/11.6/` recipes are likewise retained, unreferenced by
any supported target, so the smoke-test evidence already cited in this repository stays
reproducible.

## Provisioning harness (phase 23 work item 2)

- `e2e/provisioning/` — the disposable-environment provisioning + guaranteed-teardown
  scripts. Own test suite: **PASS** (`docs/evidence/phase-23/provisioning/vitest-run.txt` —
  92.62% statement / 89.74% branch coverage over `src/`; `eslint-clean.txt`, `tsc-clean.txt`,
  `prettier-clean.txt` all clean).
- Forced-abort teardown verification: **PASS** — a forced-abort scenario leaves no
  tenant/container alive, per the phase's own failing-test-first framing
  (`docs/evidence/phase-23/provisioning/forced-abort-passing.txt`, 1 test file / 1 test
  passed).
- Live provisioning run (`live-test-run.txt`): 3 of 4 tests passed; the one failure is the
  Grafana OSS 13.1 vendor-tag gap documented above, not a harness defect.

## Linux platform (x86-64 / ARM64 / WSL2)

| Platform         | Status                                                                                                                                                                                                                                                                                                              | Source                                                                                         |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Linux **x86-64** | **Verified, hardware-tested.** This host: `6.6.87.2-microsoft-standard-WSL2`, Node v24.18.0. Every engine-baseline probe (30/32 PASS), every phase's own package-level `tsc`/`vitest`/`eslint`/`prettier` gate, and the phase-23 provisioning/security-review work in this pass all ran natively on this substrate. | `docs/engine-baseline.md` header; every `docs/evidence/phase-*/README.md` gate-results section |
| **WSL2**         | **Verified, host-confirmed.** This entire repository's development and CI-equivalent gate history to date has run under WSL2 on this exact kernel — WSL2 is not a separate untested target, it is the substrate every other row in this document was produced on.                                                   | `docs/engine-baseline.md` header ("WSL2 Linux (6.6.87.2-microsoft-standard-WSL2)")             |
| **ARM64**        | **Not hardware-verified in this pass.** See "ARM64 close-out" below for the full, honest status.                                                                                                                                                                                                                    | This document                                                                                  |

### ARM64 close-out

**Honest status: ARM64 has not been hardware-verified.** This host is x86_64
(`docs/engine-baseline.md` header records the exact kernel string; no ARM64 hardware or
emulated ARM64 environment was available to this session). Recording the substitute
mechanism rather than a false hardware-verified claim, per this phase's own explicit
instruction:

- **Mechanism identified, execution pending:** GitHub Actions offers hosted `ubuntu-24.04-arm`
  (and other `*-arm`) runners for public and Team/Enterprise repositories, which is the
  documented, standard way to close phase 01's deferred ARM64 CI gate without needing
  dedicated ARM64 hardware in this development environment. `roadmap/01-repo-bootstrap.md`'s
  own CI skeleton is described as covering "lint/typecheck/unit/coverage, Linux
  x86-64+ARM64" (per `roadmap/23-release-hardening.md`'s own "Interfaces consumed" table,
  row 01) — the CI _skeleton_ exists; whether an actual ARM64 job run has executed
  end-to-end against the current release candidate is the open item this section discloses.
- **What this pass did NOT do:** claim ARM64 was hardware-verified when it wasn't, or silently
  omit the gap. The release-gate report's own `arm64-verification` checklist item is
  `EVIDENCE-PENDING` in the current snapshot (the generated release-gate report) — this document
  agrees with that record rather than contradicting it.
- **Recommended closing action (not performed by this docs-only pass):** run the existing CI
  build/test suite once on a GitHub-hosted `ubuntu-24.04-arm` runner against the exact
  release-candidate object ID, and archive the resulting green run's URL/run-id as the
  `EvidenceRecord` the release-gate report's `arm64-verification` item requires. Until that
  run exists, ARM64 support is a documented, CI-gated intent, not a verified fact — do not
  cite it as hardware-verified in any release announcement.
- **x86-64 stands as the fully hardware-verified substrate** for this release, per the row
  above — this is the one platform every gate, probe, and test in this repository's evidence
  trail has actually executed on.

> **Superseded 2026-08-06 — ARM64 HAS since been CI-verified on real `aarch64` hardware, at BOTH
> release candidates.** The section above is left verbatim; it was honest when written and is now
> out of date, and the instruction it ends with ("do not cite it as hardware-verified in any
> release announcement", four lines above this block) is **retired by this note rather than
> deleted**.
>
> Two hosted `ubuntu-24.04-arm` CI jobs ran lint, typecheck and the full coverage-gated suite:
>
> - **`2435cb9` (v1.0.0 candidate)** — `CI / unit-test+coverage (ubuntu-24.04-arm)`, job
>   **89923390404** of run
>   [30249293110](https://github.com/WitchyNibbles/crabgic/actions/runs/30249293110). Job-log
>   line 1640 echoes the record the step is about to write, unexpanded —
>   `  "arch": "$(uname -m)",` — and line 1656 is what the machine actually reported:
>   `  "arch": "aarch64",`. Lane totals at lines 822-823: ` Test Files  557 passed (557)` /
>   `      Tests  4672 passed (4672)`.
> - **`6b9dd7b` (v1.5.0 candidate, checkout == candidate)** — same job name, job
>   **91002998165** of run
>   [30581597639](https://github.com/WitchyNibbles/crabgic/actions/runs/30581597639). Same pair at
>   lines 1866 and 1882. Lane totals at lines 997-998: ` Test Files  605 passed (605)` /
>   `      Tests  5802 passed | 1 skipped (5803)`.
>
> **Why the pair and not just the second line.** The first line is the heredoc the workflow is
> about to expand; the second is its output. Quoting both is what proves the architecture was
> **observed on the runner**, not merely requested in a job label — a label can be wrong, a
> `uname -m` echoed back from the machine cannot.
>
> The archived final release-gate reports agree: `docs/evidence/phase-23/closeout/release-gate-report-final-6b9dd7b.json:1496`
> is `      "id": "arm64-verification",` and its verdict three lines later at `:1499` is
> `      "verdict": "PASS",`; the `2435cb9` report carries the same item at the same offsets.
>
> Both job logs were re-downloaded and byte-compared for this note under the one-space rule
> (ANSI-strip, then strip the timestamp and its ONE separator space) — see
> `docs/evidence/phase-23/closeout/c14-release-docs-citations.txt`.

## What is EVIDENCE-PENDING vs. verified, at a glance

Cross-referenced against the current release-gate-report snapshot
(`releaseCandidateObjectId: 008ae4b2848d3d3c84a5b2d19100f12e073235e3`,
`scoringMode: "interim"`) — every one of its 15 checklist items is currently
`EVIDENCE-PENDING` ("zero EvidenceRecord matched this item's required gate tags for the
release candidate object ID yet — no run attempted"), because the full live/containerized
release-candidate run this phase's other work items (1–8, 10) provision and execute has not
yet been run end-to-end as of this docs-only pass. This document's own claims are more
granular than that report (individual container recipes and smoke tests have run live, per
the tables above), but the **release-gate-report's own verdicts remain the authoritative,
higher-bar record** for whether the release candidate as a whole has cleared every checklist
item — this document does not claim otherwise.

- **Verified, hardware/live-tested in this pass:** Claude Code engine facts (30/32 probes);
  Grafana OSS/Enterprise 12.4; Grafana Enterprise 13.1; Linux x86-64 + WSL2 (this host);
  the provisioning harness's own teardown/forced-abort guarantees.
- **EVIDENCE-PENDING (owed before `v1.0.0` tag):** Grafana OSS 13.1 (vendor-side, not
  actionable from this repo); the full Jira Cloud/DC + Grafana Cloud live-conformance matrix
  as a release-candidate-scoped run; Jira DC / Grafana vendor support-window
  re-confirmation; ARM64 hardware verification; the exact pinned engine/SDK version's
  citation into a live `engine-pin-lint` CI run for this exact release commit; every
  release-gate-report checklist item currently marked `EVIDENCE-PENDING`.

---

## Corrections (2026-08-06) — release-candidate citations

Everything above this heading is left byte-identical. This section is a dated correction block,
added by the closeout pass that walked this document against the two release candidates. It
corrects three things and deliberately upgrades **nothing**.

### 1. The "at a glance" snapshot is superseded

The section above pins its authority to a release-gate report at
`releaseCandidateObjectId: 008ae4b2848d3d3c84a5b2d19100f12e073235e3` in `scoringMode: "interim"`
with all 15 checklist items `EVIDENCE-PENDING`. That snapshot is from 2026-07-24 — three days
before the v1.0.0 candidate — and **two `final` reports now contradict it**, both committed
verbatim in this repository:

| report                                                                   | candidate          | mode    | items | verdicts         | linked evidence entries |
| ------------------------------------------------------------------------ | ------------------ | ------- | ----- | ---------------- | ----------------------- |
| `docs/evidence/phase-23/closeout/release-gate-report-final-2435cb9.json` | `2435cb9` (v1.0.0) | `final` | 15    | 15 PASS / 0 FAIL | **158**                 |
| `docs/evidence/phase-23/closeout/release-gate-report-final-6b9dd7b.json` | `6b9dd7b` (v1.5.0) | `final` | 15    | 15 PASS / 0 FAIL | **160**                 |

The two counts are **not** interchangeable: 158 belongs to the `2435cb9` report and 160 to the
`6b9dd7b` one. The runs that produced them are
[30250453824](https://github.com/WitchyNibbles/crabgic/actions/runs/30250453824) (`release-e2e`
at `2435cb9`) and
[30581930006](https://github.com/WitchyNibbles/crabgic/actions/runs/30581930006) (the tag-gated
`publish` run at `6b9dd7b`, whose `release gate` job **91004033370** is the blocking gate).
Prefer the `6b9dd7b` report: the `2435cb9` run's checkout was two commits ahead of the candidate
it stamped, and the `6b9dd7b` run's checkout and candidate are the same commit.

### 2. The "owed before `v1.0.0` tag" list, retired item by item — without upgrading anything

That list is at `docs/compatibility-matrix.md:174-179` in this tree. (Records written before
2026-08-06 cite it as `:140-145`; the ARM64 correction block above added 34 lines beneath it, so
an older citation is off by that much and is not wrong about its subject.)

| owed item, as written above                                                                                       | state at the candidates                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Grafana OSS 13.1                                                                                                  | **Still owed, still vendor-side.** Nothing in this repository can close it; the recipe resolves the moment Grafana Labs publishes the tag.                                                                                                                                                                                                                                                                                                                                                                                                       |
| the full Jira Cloud/DC + Grafana Cloud live-conformance matrix, release-candidate-scoped                          | **Scored PASS, but on cassette evidence — read this before quoting it.** `docs/evidence/phase-23/closeout/release-gate-report-final-6b9dd7b.json:218` is `      "id": "jira-grafana-exactly-once",` and `:221` is `      "verdict": "PASS",`, over **28** linked records — and all 28 carry the gate tag `release-gate:connector-matrix`, **none** a live tag. The live exactly-once run has never happened. It is filed as the defect record named `23-jira-live-exactly-once-never-run`, and roadmap/23's two "pass live" boxes stay unticked. |
| Jira DC / Grafana vendor support-window re-confirmation                                                           | **Scored PASS.** `docs/evidence/phase-23/closeout/release-gate-report-final-6b9dd7b.json:1515` is `      "id": "jira-grafana-version-support-windows",` with `:1518` `      "verdict": "PASS",`. Its bearer ran at the candidate: `src/versionSupportWindows.test.ts (19 tests)` at line 929 of job 91004033370.                                                                                                                                                                                                                                 |
| ARM64 hardware verification                                                                                       | **Closed** — see the superseded block in the ARM64 close-out above.                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| the exact pinned engine/SDK version's citation into a live `engine-pin-lint` CI run for this exact release commit | **Closed.** `engine-pin-lint` is green at both candidates (jobs 91002998151 at `6b9dd7b`, 89923390171 at `2435cb9`), and `docs/evidence/phase-23/closeout/release-gate-report-final-6b9dd7b.json:1586` is `      "id": "engine-pin-recorded",` with `:1589` `      "verdict": "PASS",`.                                                                                                                                                                                                                                                          |
| every release-gate-report checklist item currently marked `EVIDENCE-PENDING`                                      | **Superseded** by the two `final` reports in §1: 15 PASS, 0 FAIL, at both candidates.                                                                                                                                                                                                                                                                                                                                                                                                                                                            |

### 3. The pinned-release-version row

The row headed "Pinned release version (exact, in the published package)" above records itself as
`EVIDENCE-PENDING` and declines to restate a literal. That disclosure stands as a description of
this document, and the row itself is left verbatim — but the release-gate item it defers to has
since scored: see the `engine-pin-recorded` line in the table in §2. The pin is the exact string
`0.3.218`.

### What this section does NOT claim

It does not claim live Jira, Jira Data Center or Grafana Cloud conformance; it does not move
roadmap/23's two "pass live" boxes; and it does not speak to deployment, which lives solely in
`docs/deploy-posture.md` and is **conditional, not clear**. The four documents' remaining
status-bearing claims are cited to committed artifacts that pre-date the release candidates
rather than to a candidate-scoped CI run — measured, with numbers, in
`docs/evidence/phase-23/closeout/c14-release-docs-citations.txt`, which is why roadmap/23's
release-docs box stays **unticked**.
