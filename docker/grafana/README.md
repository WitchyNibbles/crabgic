# Grafana container recipes (roadmap phase 20 / 23)

Disposable, single-node Grafana container recipes for the three self-managed fixture
versions roadmap/20-grafana-adapters.md and roadmap/23-release-hardening.md name —
`11.6/`, `12.4/`, `13.1/` — each a standalone OSS `docker-compose.yml` **plus** an
Enterprise `docker-compose.enterprise.yml`, a shared `smoke-test.sh`, and this README.
Phase 20 shipped the per-version fixture cassettes under
`packages/connectors-grafana/fixtures/`; it did not ship these container recipes — this
directory is that owed deliverable, built as part of roadmap/23 work item 2
("disposable-environment provisioning... Grafana OSS/Enterprise 11.6/12.4/13.1
containers"), mirroring `docker/jira-datacenter`'s structure.

## OSS vs Enterprise licensing (read this before assuming Enterprise needs a license key)

**Grafana OSS boots with no license, full stop** — every recipe here reaches a healthy
`/api/health` unauthenticated-admin-default, no license file, no trial, no signup.

**Grafana Enterprise also boots with no license applied.** Enterprise is the OSS binary
plus additional gated plugins/features (SAML/LDAP sync, reporting, licensed data sources,
fine-grained access control, etc.) behind a license file. With no license mounted, the
container starts normally and serves the **same OSS-equivalent API surface** — including
`/api/health`, which every smoke test and the phase-23 provisioning harness's health probe
checks — it simply never unlocks the enterprise-only features. This is exactly why these
recipes are "genuinely runnable": no secret, trial key, or paid account is needed for any
of the six compose files in this directory to reach the healthy state their smoke tests
check for.

## What these are for

1. **Local/CI smoke test** (`smoke-test.sh <version> [oss|enterprise]`): boots one
   version+edition, polls `/api/health` until Grafana reports `"database":"ok"`, tears
   down. Proves the recipe itself boots and serves the health endpoint — it does not
   exercise `packages/connectors-grafana`'s `observability.*` surface against a live
   instance (that is a separate, future live-capture pass, mirroring
   `docker/jira-datacenter/README.md`'s own honesty note).
2. **Phase 23's disposable-environment provisioning harness**
   (`e2e/provisioning/`): brings up these exact compose files via an injectable
   `ComposeRunner`, waits for the same `/api/health` signal, runs a caller-supplied probe,
   and guarantees teardown (`down -v` + a label-scoped second sweep) even on a forced
   abort. See `e2e/provisioning/`'s own module docs for the crash-safe design.

## Usage

```bash
docker compose -f docker/grafana/11.6/docker-compose.yml up -d
docker/grafana/smoke-test.sh 11.6 oss
docker compose -f docker/grafana/11.6/docker-compose.yml down -v   # teardown

docker compose -f docker/grafana/13.1/docker-compose.enterprise.yml up -d
docker/grafana/smoke-test.sh 13.1 enterprise
docker compose -f docker/grafana/13.1/docker-compose.enterprise.yml down -v   # teardown
```

Or, for the smoke test end-to-end (boot, poll, teardown, in one step) — every one of these
six commands was actually run against this environment's live Docker daemon while
authoring this directory; see `docs/evidence/phase-23/provisioning/grafana-*.txt` for the
raw transcripts:

```bash
docker/grafana/smoke-test.sh 11.6 oss
docker/grafana/smoke-test.sh 11.6 enterprise
docker/grafana/smoke-test.sh 12.4 oss
docker/grafana/smoke-test.sh 12.4 enterprise
docker/grafana/smoke-test.sh 13.1 oss           # see honesty note below — fails today
docker/grafana/smoke-test.sh 13.1 enterprise
```

## Image tags and host ports

| Version | Edition    | Image                              | Host port |
|---------|------------|-------------------------------------|-----------|
| 11.6    | OSS        | `grafana/grafana-oss:11.6.5`        | 3000      |
| 11.6    | Enterprise | `grafana/grafana-enterprise:11.6`   | 3001      |
| 12.4    | OSS        | `grafana/grafana-oss:12.4.3`        | 3002      |
| 12.4    | Enterprise | `grafana/grafana-enterprise:12.4`   | 3003      |
| 13.1    | OSS        | `grafana/grafana-oss:13.1.0`        | 3004      |
| 13.1    | Enterprise | `grafana/grafana-enterprise:13.1`   | 3005      |

Distinct host ports let more than one version/edition run side by side without a port
clash (useful for the provisioning harness's own test runs, which boot several of these in
one process).

## Honesty note: Grafana OSS 13.1 does not exist yet upstream (checked live, 2026-07-24)

Every recipe above except **OSS 13.1** was actually booted, health-probed, and torn down
live in this environment while this directory was authored — verified, not assumed. `OSS
13.1` was also actually attempted, and **honestly failed**: a live Docker Hub registry
check on this project's date found `grafana/grafana-oss` had no `13.1`, `13.1.0`, or
`13.1.1` tag published (newest published OSS tag: `13.0.2`), while
`grafana/grafana-enterprise:13.1` already existed (pushed two days earlier). See
`docs/evidence/phase-23/provisioning/grafana-13.1-tag-check.txt` for the raw registry
check and `grafana-13.1-oss-smoke-test-FAILS-vendor-tag-not-published.txt` for the actual
`docker compose up` failure this produces (`manifest unknown`) — this recipe is not faked
or skipped; it fails exactly the way a real user hitting this vendor-timing gap would see
it fail, and `docker/grafana/13.1/docker-compose.enterprise.yml`'s live PASS
(`grafana-13.1-enterprise-smoke-test.txt`) proves the 13.1 recipe *shape* itself is
correct — only the OSS image tag is not yet published. `docker/grafana/13.1/
docker-compose.yml`'s pinned tag (`13.1.0`, the conventional first-patch tag a new minor
uses) needs no code change once Grafana Labs publishes it — this is a vendor-availability
gap, not a defect in the recipe or the provisioning harness, exactly the same category of
honesty note `docker/jira-datacenter/README.md` records for its own cassette-vs-live gap.

## Refreshing supported versions

Grafana's self-managed support window shifts over time (roadmap/20 §Risks: the
`/api`→`/apis` route migration is ongoing). Before a v1.0.0 release, re-confirm `11.6`,
`12.4`, `13.1` are still within Grafana Labs' supported window, re-run
`docs/evidence/phase-23/provisioning/grafana-13.1-tag-check.txt`'s registry check to see
whether OSS 13.1 has since been published (if so, this directory needs no further edit —
the pinned `13.1.0` tag will simply resolve), and bump image tags in all six compose files
together with `packages/connectors-grafana`'s fixture directory names — never one file
without the others, mirroring `docker/jira-datacenter/README.md`'s own coordinated-bump
guidance.
