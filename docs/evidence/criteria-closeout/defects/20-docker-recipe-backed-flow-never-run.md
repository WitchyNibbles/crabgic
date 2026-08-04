# Defect 20-docker-recipe-backed-flow-never-run

**Phase:** 20 — Grafana adapters (Cloud / OSS / Enterprise) (`roadmap/20-grafana-adapters.md`, exit
criterion 1)

**Criterion (verbatim):**

> `folder→dashboard→annotation→alert-rule` integration suite green on all three version cassettes (11.6/12.4/13.1) + the current-Cloud cassette, plus the OSS/Enterprise Docker-recipe run.

**Found:** 2026-08-02, criteria-closeout pass (batch 4, phase 20), at
`d60398f6b1d3aca2f2efbb8adfbac081d6c16904`.

**Severity:** evidence-channel-only. The connector logic under test is exercised thoroughly against
recorded cassettes and, for one resource kind, against a real container. What has never happened is
the specific run the criterion's second clause names: the seven-kind flow against a
Docker-recipe-provisioned Grafana. No product defect is implied or observed; a real Grafana could
still disagree with the hand-modelled wire fixtures, which is precisely the risk this clause exists
to retire.

## Gap

This is a **split criterion**. Its first clause is fully met; its second is not.

| Clause                                                                  | Status at `d60398f`                                                                                                   |
| ----------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| integration suite green on 11.6 / 12.4 / 13.1 / current-Cloud cassettes | **met** — `integration-cassette-replay.test.ts:159-175`, four `it()`s, all green in CI (job-log line 335) and locally |
| ...`plus the OSS/Enterprise Docker-recipe run`                          | **not met** — no run of that flow against a real container exists anywhere in the repository                          |

`roadmap/20` §Test plan disambiguates the second clause and rules out the weaker reading:

> **Integration:** cassette replay per version (11.6, 12.4, 13.1, current Cloud) exercising
> folder→dashboard→annotation→alert-rule→contact-point→mute-timing→notification-template;
> Docker-recipe-backed OSS/Enterprise runs **of the same flow**.

### Search trail

Full transcript: `docs/evidence/phase-20/closeout-c1-docker-recipe-run-search.txt` (UTC-stamped,
HEAD-pinned, every command echoed with its own exit status).

| Check                                                                                                         | Result at `d60398f`                                                                      |
| ------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `git grep -nE "child_process\|execFile\|spawnSync\|docker compose\|dockerode" -- packages/connectors-grafana` | **no match** (`exit=1`) — this package never starts a container                          |
| `git grep -ln "RealComposeRunner"`                                                                            | `e2e/provisioning/src/live/realComposeRunner.ts` + its two configs + one `.live.test.ts` |
| what that live test asserts against a booted container                                                        | `/api/health` `database:ok`, then teardown — no resource client, no plan, no mutation    |
| `git grep -ln "connectors-grafana" -- e2e/`                                                                   | 8 files; exactly one reaches a real container (below)                                    |
| `e2e/attestation/src/live/grafanaTraceabilityBinding.ts:119`                                                  | `allowedResources: ["dashboard"]` — one of seven kinds, OSS only, owner-gated `@live`    |

Three things resemble the missing run. None is it:

1. **`integration-cassette-replay.test.ts:177-189`**, whose `describe` is titled
   `"integration: OSS/Enterprise Docker-recipe-backed runs (cassette-replayed — no live container is started, per this repo's no-live-network-calls rule)"`.
   It asserts a string equality between each recipe's `buildInfoFixtureLabel` and a build-info
   fixture, then replays the same cassette the version-cassette block already replayed. The suite is
   honest about this in its own title; it is simply not the criterion's channel.
2. **`e2e/provisioning/test/grafana-oss.live.test.ts`** — a genuine `docker compose up`, health
   probe and teardown against `docker/grafana/<version>/`. Recorded runs exist in
   `docs/evidence/phase-23/provisioning/` (12.4 OSS, 12.4 Enterprise, 13.1 Enterprise green;
   13.1 OSS a real `manifest unknown` failure on an unpublished vendor tag). It touches no resource
   client.
3. **`e2e/attestation/src/live/grafanaTraceabilityBinding.ts`** — the closest thing that exists, and
   genuinely container-backed: it drives the real `createGrafanaMutationApplyClient` +
   `buildGrafanaMutationPlan` through the real `executeMutationPlan` against a TLS-fronted
   containerised Grafana OSS. Its `allowedResources` is exactly `["dashboard"]`, so it covers one
   kind of seven, OSS only, and it is reached only from `requirementTraceabilityBinding.live.test.ts`,
   an owner-gated `@live` suite a closeout pass may not run.

### Why this is `UNMET` and not a wording correction

Reading `plus the OSS/Enterprise Docker-recipe run` down to _"a cassette replay against the
build-info fixture each recipe declares it would report"_ removes the guarantee the clause exists
for — that the hand-modelled wire fixtures survive contact with a real Grafana. The closeout
protocol classifies a weaker guarantee as `UNMET`, never as a wording fix. `docs/evidence/phase-20/README.md`
§Deviations item 1 already records the deviation honestly at build time ("Phase 23 ... is the natural
place to wire an actual `docker run` against these recipes"), and its item 2 states the residual
risk directly: "Grafana wire-format fixtures are plausible, not live-captured."

Nor is this discharged by phase 23. `SUPERSEDED-DISCHARGED` requires the criterion to carry its own
deferral clause; this one carries none — the deferral lives in the phase file's §Out of scope prose,
not in the checkbox — and phase 23's ticked provisioning box is about booting containers and
probing health, not about this flow.

### Not a 11.6-retirement case

Plan C forecast this criterion as phase 20's guaranteed wording reconciliation, on the grounds that
it names Grafana 11.6, retired 2026-07-26 (owner-ratified). It is not, and asserting it would be
wrong. The ratification carves this phase out by name — `roadmap/23-release-hardening.md`'s risk
note reads:

<!-- prettier-ignore-start -->
```text
**Not affected:** `packages/connectors-grafana`'s 11.6 capability-discovery fixture — which builds
the *adapter* understands is roadmap/20's scope and is listed under this phase's own §Out of
scope; `docker/grafana/11.6/` is likewise retained, unreferenced by any supported target, so
existing smoke-test evidence stays reproducible.
```
<!-- prettier-ignore-end -->

(Reproduced in a fenced block, not a blockquote, because `npm run format` silently rewrites
`*adapter*` to `_adapter_` inside quoted markdown — the quote above is byte-for-byte what
`roadmap/23-release-hardening.md` says.)

`docs/compatibility-matrix.md:63-68` and `e2e/attestation/src/versionSupportWindows.ts:44-57` repeat
it. `docs/vendor-support-policy.json` carries no `grafana-11.6` entry precisely because the
retirement concerns supported deployment targets, not which builds the adapter can talk to. The
11.6 cassette remains in scope, pinned and green.

## Proposed remedy

Smallest honest fix, in preference order:

1. **Extend the existing container harness to the full flow.** `e2e/attestation/src/live/grafanaTraceabilityBinding.ts`
   already provisions a real Grafana, resolves a real secret reference and drives the real apply
   client; broadening its `allowedResources` from `["dashboard"]` to the seven kinds and replaying
   `RESOURCE_FLOW_ORDER` against it reuses everything that exists. Add an Enterprise case alongside
   the OSS one, using `docker/grafana/<version>/docker-compose.enterprise.yml`.
2. Record the run into `docs/evidence/phase-20/` the way phase 23 records its provisioning smoke
   tests, then tick criterion 1 citing both clauses.

**Effort: M.** No new infrastructure — the compose recipes, the real compose runner, the TLS seam,
the secret resolution and the cassette flow order all already exist and are already composed
pairwise; what is missing is the one composition of all of them.

**Needs:** a live Docker daemon and an Enterprise licence file for the Enterprise half (the OSS half
needs neither). **Does not need** the Claude engine or the owner's subscription. Two caveats for
whoever picks this up: the run lands in the owner-gated `@live` lane, so it needs the same approval
`e2e/provisioning`'s live suite does; and `grafana/grafana-oss:13.1.0` was still unpublished on
Docker Hub as of 2026-07-25 (`docs/evidence/phase-23/provisioning/grafana-13.1-tag-check.txt`), so
the OSS half should target 12.4 until that tag ships.

**Ticket-ready:** yes.
