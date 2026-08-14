# UNVERIFIED ENGINE FACT — Grafana build-info wire format

**Status:** ⚠️ built against a documented approximation, **not verified against a live Grafana**
**Owner ruling:** 2026-08-14 — "build it, mark the fact unverified"
**Introduced by:** issue #135 defect 3 (Grafana half)
**Code:** `packages/connectors-grafana/src/discovery/http-discovery.ts`

## Why this file exists

The repo's ground rules forbid asserting engine facts from memory, and
`packages/connectors-grafana/src/discovery/build-info-fixtures.ts` states
that its response shape "is fixture data, not an assertion about Grafana's
exact wire format ... a deliberate approximation pending live
verification".

Registering a Grafana connection requires a live `CapabilitySnapshot`, so
until something could produce one, **no Grafana connection could ever be
registered** and every `observability.*` call answered "was never
registered". The owner ruled to build the discoverer against the
approximation and mark the fact, rather than leave Grafana undispatchable.

This file is that mark. It is not evidence that the mapping is correct —
it is a record that it has **not been checked**.

## What is unverified

| #   | Guess                                                                                            | Where it lives            |
| --- | ------------------------------------------------------------------------------------------------ | ------------------------- |
| 1   | `GET /api/frontend/settings` returns a `buildInfo` object carrying `version` and `edition`       | `GRAFANA_BUILD_INFO_PATH` |
| 2   | `buildInfo.edition` is a display string mapping onto the 3-member enum (`"Open Source"` → `oss`) | `normalizeGrafanaEdition` |

`/api/health` was **not** used: it returns `{commit, database, version}`
and no edition, and `CapabilitySnapshot.edition` is required.

Route probing itself is **not** on this list. It asks the candidate base
path from the connector's own route table whether it answers, which is a
behavioural question rather than a wire-format claim.

## Failure posture

Both guesses fail **closed**, and none of them can silently widen
authority:

- An unrecognized edition raises a typed `validation` error **naming the
  value seen**, so a live run produces the correction directly.
- A missing `buildInfo`, a non-JSON body, or a non-2xx status fails
  discovery outright rather than defaulting.
- A `401` on either the build-info call or a route probe is **propagated**,
  never absorbed. Absorbing it would record a bad credential as a
  capability fact ("this Grafana supports nothing") and the snapshot cache
  would hold that for the whole TTL.
- An unknown build still forces `isReadOnly` via the pre-existing
  `isKnownGrafanaBuild` guard, which this change does not touch.

## How to discharge this

Run against a real Grafana (a container is enough) and capture the actual
`/api/frontend/settings` response:

```bash
curl -sS -H "Authorization: Bearer $GRAFANA_TOKEN" https://<host>/api/frontend/settings
```

Then either confirm the mapping or correct `normalizeGrafanaEdition` /
`GRAFANA_BUILD_INFO_PATH`. Per roadmap/20's "the route table is data, not
code", the fix is expected to be confined to those two symbols — if it is
not, that is itself a finding worth recording here.

Replace this file with the captured response and a dated confirmation when
that run happens.
