# Jira Data Center container recipes (roadmap phase 19)

Disposable, single-node Jira Data Center container recipes for two supported fixture
versions — `10.3/` and `11.3/` — each a standalone `docker-compose.yml` plus a shared
`smoke-test.sh` boot/health-probe script. These are **recipes and teardown**, not the
release-time disposable-environment harness itself (that is roadmap phase 23's job,
which reuses these files unmodified).

## What these are for

1. **CI smoke test** (`.github/workflows/jira-datacenter-smoke.yml`, manual
   `workflow_dispatch` only): boots one edition, polls `/status` until Jira reports
   `RUNNING`, tears down. No Jira license is required to reach `RUNNING` — that state is
   reached by Tomcat finishing boot, before the first-run setup wizard (which does need a
   license) is ever engaged. This proves the recipe itself is soundand boots — it does
   not exercise this connector's REST v2/Agile surface against a live instance.
2. **Future live-capture** (not performed in this session — see honesty note below): a
   later pass with real licenses could point `packages/connectors-jira`'s cassette-capture
   tooling at one of these containers to replace the hand-authored/modeled cassettes under
   `packages/connectors-jira/fixtures/datacenter/{10.3,11.3}/` with byte-recorded traffic.
3. **Phase 23's disposable-environment tooling**: reuses these compose files unmodified
   for its own release-time E2E matrix.

## Usage

```bash
docker compose -f docker/jira-datacenter/10.3/docker-compose.yml up -d
docker/jira-datacenter/smoke-test.sh 10.3
docker compose -f docker/jira-datacenter/10.3/docker-compose.yml down -v   # teardown
```

Or, for the smoke test end-to-end (boot, poll, teardown, in one step):

```bash
docker/jira-datacenter/smoke-test.sh 10.3
docker/jira-datacenter/smoke-test.sh 11.3
```

## Honesty note (mirrors phase 20's Grafana precedent)

No live Jira Data Center license or running instance was available in the environment
this phase was implemented in. The cassette fixtures under
`packages/connectors-jira/fixtures/datacenter/{10.3,11.3}/` are **hand-authored/modeled**
against Jira's documented REST v2/Agile response shapes — they are not byte-recorded
traffic from a real 10.3/11.3 instance. These container recipes exist so that gap can be
closed later (by this phase's own author, by phase 23, or by a release-time refresh)
without needing to design the recipe from scratch — boot them, point a capture tool at
them, replace the modeled JSON with recorded JSON. The CI smoke-test job proves the
recipes themselves are sound (they boot and reach a healthy state) independent of that
future live-capture step.

## Refreshing supported versions

Jira Data Center's supported-version window shifts over a multi-year OSS lifetime
(roadmap/19 §Risks). Before a v1.0.0 release, confirm `10.3`/`11.3` are still within
Atlassian's supported window and bump the image tags in both `docker-compose.yml` files
(plus the fixture directory names, plus `dc-edition-feature-matrix.ts`'s
`DC_EDITION_FEATURE_MATRIX`) together, in one coordinated change — never one file without
the others.
