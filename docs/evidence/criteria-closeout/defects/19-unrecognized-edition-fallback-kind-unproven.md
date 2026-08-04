# Defect 19-unrecognized-edition-fallback-kind-unproven

**Phase:** 19 — Jira Data Center adapter (`roadmap/19-jira-datacenter-adapter.md`, exit criterion 3)

**Criterion (verbatim):**

> `DcEditionFeatureMatrix` resolves capability discovery correctly for both known editions (10.3, 11.3) and falls back to typed `unsupported` for an unrecognized edition — fixture-proven, no raw fallback.

**Found:** 2026-08-04, criteria-closeout pass (phase 19), at
`3dec9bf2caa6b94bd817aee414f9458c37750fd9`.

**Severity:** evidence-channel-only. The production code does the right thing today — both branches
of `assertActionSupported` throw `ConnectorError.unsupported`, and discovery of an unrecognized
version does produce a fail-closed read-only snapshot. What is missing is any measurement that
either stays true. Two independent mutations of the code this criterion is about leave the entire
repository suite green, so nothing defends the guarantee against the next edit.

## Gap

Five conjuncts. Four hold; the fallback conjunct does not.

| Conjunct                                                          | Status at `3dec9bf`                                                                                         |
| ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| resolves discovery correctly for **10.3**                         | **met** — `discovery-datacenter.test.ts:32-45`, scripted `serverInfo`/`mypermissions` through a real client |
| resolves discovery correctly for **11.3**                         | **met** — `discovery-datacenter.test.ts:47-55`                                                              |
| falls back to **typed `unsupported`** for an unrecognized edition | **not met** — two measured gaps, below                                                                      |
| fixture-proven                                                    | **met** — the scripted fixtures above drive the real `GatewayHttpClient`                                    |
| no raw fallback                                                   | **met** — same emptiness proof as criterion 2                                                               |

Full transcript: `docs/evidence/phase-19/closeout-c3-discovery-fallback-probe.txt` (UTC-stamped,
HEAD-pinned, both probes with their commands and exit statuses).

### Gap (i) — the typed kind is asserted by nothing (probe P3b)

`assertActionSupported` (`jira-datacenter-resource-client.ts:83-94`) has two branches.

- The **second** branch (a recognized edition whose `availableActions` omits the action) has its
  canonical kind asserted at `jira-datacenter-resource-client.test.ts:142`
  (`expect((err as ConnectorError).kind).toBe("unsupported")`).
- The **first** branch — `dcFeatures === undefined`, which _is_ the unrecognized-edition fallback
  this criterion names — is exercised only by `:146-160`, which asserts `.toThrow(ConnectorError)`
  and never inspects the kind.

Splitting the condition and downgrading only the first branch from `ConnectorError.unsupported` to
`ConnectorError.validation` leaves **625 test files and 6216 tests green**, repository-wide. The
word "typed" in the criterion is therefore carried by nothing.

That is not a theoretical worry in this phase: the field path measured in criterion 2's defect
record already returns `validation` where the roadmap says `unsupported`. The same silent drift on
the action path would land green.

### Gap (ii) — the discovery→client join is exercised by nothing (probe P3)

The only production path from a discovered edition to the client's gate is
`jira-datacenter-connection-registry.ts:87-93`, which composes
`discoverJiraDatacenterCapabilitySnapshot` → `resolveDcEditionFeatures` → the client's `dcFeatures`.
Replacing that whole expression with `undefined` also leaves **625 files / 6216 tests** green.

The reason is visible in the tests: `jira-datacenter-connection-registry.test.ts:24-47` registers
with an **empty** response script, so discovery throws, `.catch(() => undefined)` at `:93` swallows
it, and the entry is built with `dcFeatures === undefined`; the test then asserts only that
`entry.resourceClient` is defined. `register-datacenter.test.ts` uses `skipDiscovery: true` or
`dcFeaturesOverride`. So no test has ever seen a _successful_ discovery reach the client.

### What is actually proven for an unrecognized edition

`discovery-datacenter.test.ts:57-66` proves a scripted `8.20.1` resolves `edition: "unknown"`,
`isReadOnly: true`, `actions: []`. That is a genuine, valuable fail-closed guarantee — a **safe
snapshot**. It is a different guarantee from "falls back to typed `unsupported`", which is about a
canonical `ConnectorError` kind (P02) reaching the caller.

### Why this is `UNMET` and not a wording correction

Reading "falls back to typed `unsupported`" down to "produces an empty `actions` list" substitutes
the snapshot guarantee for the typed-error guarantee. `roadmap/19` §In scope names the error
explicitly ("Unrecognized fields or actions return typed `unsupported` (P02) — never guessed, never
a raw-endpoint fallback"), and §Work items item 3's failing-first entry point is "a query against an
unrecognized edition/version asserts typed `unsupported`". Losing that is a weaker guarantee, which
the protocol classifies as `UNMET`.

This one is close to the line, and the call is deliberate: had the kind been asserted anywhere, the
unwired join alone would have been recorded as a note against a ticked box. It is the combination —
the kind unmeasured **and** the only path that produces the condition unexercised — that leaves the
conjunct with no bearer at all.

## Proposed remedy

Two small additions, no production change required:

1. **Assert the kind on the undefined branch.** In
   `jira-datacenter-resource-client.test.ts:146-160`, replace `.toThrow(ConnectorError)` with the
   same `try`/`catch` + `expect(err.kind).toBe("unsupported")` shape the sibling case at `:129-144`
   already uses, and assert `provider === "jira-datacenter"` while there.
2. **Exercise the real chain once.** One registry test that scripts a _successful_ discovery — a
   `serverInfo` of `{ "version": "8.20.1" }` plus a `mypermissions` response, which is exactly the
   pair `discovery-datacenter.test.ts:57-66` already uses — registers without `skipDiscovery` or
   `dcFeaturesOverride`, then asserts a `plan*` call on the returned `entry.resourceClient` throws
   typed `unsupported`. A second case with `{ "version": "10.3.1" }` asserting the same call
   _succeeds_ would additionally kill the P3 mutation.

**Effort: S.** Roughly 30 lines of test across two existing files; every fixture shape needed
already exists in the tree.

**Needs:** nothing — no live instance, no container, no engine, no secret. This is the cheapest of
phase 19's four open defects.

**Ticket-ready:** yes.
