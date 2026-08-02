# 18 — the fake/cassette parity assertion cannot fail: the cassette is a copy of the fake

**Phase:** 18 — Jira Cloud adapter + intake/milestone synchronization
(`roadmap/18-jira-cloud-adapter.md`, exit criterion 9)

**Criterion (verbatim):**

> Fake-Jira/cassette parity proven: the scripted scenario set replayed against both fake and recorded cassette yields identical typed results.

**Found:** 2026-08-02, criteria-closeout pass, batch 4 (phase 18), at `main` @
`d60398f6b1d3aca2f2efbb8adfbac081d6c16904`.

**Severity:** evidence-channel-only, at the top of that band. Nothing is mis-rendered, leaked or
mis-applied; the connector's read path is genuinely exercised. What does not exist is the
guarantee the box claims — that a fake and an independently-sourced recording agree — because
the two sources are the same bytes and the suite asserts that they are.

## Gap

### What the criterion asks for

Parity between two independently-sourced scripts: a hand-authored fake and a **recorded**
cassette. The phase's work item 6 states the failing-test entry point in the same terms:

> Entry point: failing parity test — the same scripted scenario must produce identical typed
> results from the fake and from cassette replay.

A parity test is only meaningful if the two sides can disagree.

### What exists

`packages/connectors-jira/src/testkit/fake-cassette-parity.test.ts`, two cases:

- `:16-21` — `runScriptedReadScenario(HAND_AUTHORED_READ_SCENARIO)` versus
  `runScriptedReadScenario(loadReadScenarioCassette())`, asserted with
  `expect(fromCassette).toEqual(fromFake);` (`:20`).
- `:23-27` — the "sanity" case, whose last line is
  `expect(cassette.responses).toEqual(HAND_AUTHORED_READ_SCENARIO.responses);` (`:26`).

### Why the first assertion cannot fail

`:26` asserts that the two response arrays are element-wise equal. `runScriptedReadScenario`
(`packages/connectors-jira/src/testkit/scripted-read-scenario.ts:116-146`) is a pure function of
its script: a fixed base URL (`:113`), a fixed token (`:127-129`), `sleep: async () => undefined`
(`:125`), no clock and no randomness anywhere in the returned `ScenarioResults` — the six fields
it returns are parsed straight from the scripted bodies. Equal inputs therefore produce equal
outputs by construction. Given `:26`, the assertion at `:20` is a tautology; the only thing it
could ever catch is nondeterminism inside the read path, which is not what the criterion claims.

Confirmed by reading the fixture rather than trusting the description. Every entry of
`packages/connectors-jira/src/testkit/fixtures/read-scenario.cassette.json` is byte-identical to
`JSON.stringify` of the corresponding object literal in `scripted-read-scenario.ts:34-93` — e.g.
fixture line 5 is
`"bodyText": "{\"values\":[{\"id\":\"10000\",\"key\":\"PROJ\",\"name\":\"Project\"}]}"`,
which is exactly `JSON.stringify({ values: [{ id: "10000", key: "PROJ", name: "Project" }] })`
from `scripted-read-scenario.ts:37`. The file carries no capture metadata of any kind: no
timestamp, no request URLs, no response headers, no instance identity — nothing a recording of
real Cloud traffic would carry.

### The doc comment asserts the opposite

`scripted-read-scenario.ts:23-31` states the condition the suite then forbids:

> `HAND_AUTHORED_READ_SCENARIO` ("the fake") and `./fixtures/read-scenario.cassette.json` ("the
> recorded cassette") are deliberately kept as two INDEPENDENT sources for the SAME 7-call
> scripted scenario … which is only meaningful if the two sources are maintained independently
> rather than one being derived from the other at runtime.

The final clause is technically satisfied — nothing is derived at _runtime_ — while the intent
is not, because `:26` pins them to be identical at rest.

### Search trail

1. Read `fake-cassette-parity.test.ts` and `scripted-read-scenario.ts` in full.
2. Read `fixtures/read-scenario.cassette.json` in full (29 lines) and compared each `bodyText`
   against the corresponding literal in `scripted-read-scenario.ts`.
3. `git log --oneline -- packages/connectors-jira/src/testkit/fixtures/read-scenario.cassette.json`
   → introduced in `09ecda8` ("feat: phase 18 Jira Cloud adapter + intake/milestone sync"), the
   same commit as the fake; no capture tooling accompanies it.
4. `git grep -n cassette -- packages/connectors-jira/src e2e` → the only other consumer is
   `e2e/matrix/connector/src/exactly-once/jira-cassette-readback.test.ts:100-104`, which repeats
   the same assertion (and the same "independently-maintained" wording) in the release-e2e
   matrix. It adds a second instance of the tautology, not independent evidence.
5. Checked the sibling connectors for precedent: the repository already discloses this honestly
   elsewhere. `e2e/attestation/src/traceabilityEvidence.ts:11-12` records that Grafana's
   cassettes "are HAND-AUTHORED, not recorded", and
   `packages/connectors-jira/src/testkit/fake-cassette-parity-dc.test.ts:16-22` says the same for
   the Data Center cassettes ("hand-authored/MODELED fixtures … not live-captured recordings").
   The Cloud side is the one place the disclosure is missing and the doc comment claims the
   reverse.

### Root cause shared with criterion 1

Phase 18 recorded no Cloud traffic. Criterion 1 fails because no cassette covers the flow; this
one fails because the cassette that does exist is not independent of the fake. Filed separately
because the remedies differ.

## Proposed remedy

Ordered by increasing cost; the first is enough to stop the box being false.

1. **Delete the tautology and say what is true.** Drop `:26`'s
   `expect(cassette.responses).toEqual(HAND_AUTHORED_READ_SCENARIO.responses);`, keep the
   non-triviality half (`expect(cassette.responses.length).toBeGreaterThan(1);`), and replace
   `scripted-read-scenario.ts:23-31`'s "two INDEPENDENT sources" paragraph with the same honest
   disclosure `fake-cassette-parity-dc.test.ts:16-22` already carries for Data Center. This makes
   the suite an honest fixture-loadability test — but it does **not** make criterion 9 tickable,
   because there would still be no recording.
2. **Capture a real cassette.** The phase's own §Risks bullet already flags what is needed:
   "Live Jira Cloud sandbox needed by 23 — provision early; cassettes refreshed by 21's drift
   job." Add a capture mode to the fake transport (record `{status, headers, bodyText}` per call
   to a JSON file), run the seven-call read scenario once against a real Cloud sandbox, and
   commit the result with its capture metadata. Then `:20` becomes a real assertion: the
   hand-authored fake must faithfully model what Cloud actually returns.
3. If a sandbox is not available, the honest alternative is the wording protocol — but that is a
   change to a baseline-pinned criterion and therefore a separate reviewed roadmap commit
   re-pinning `PRE_CLOSEOUT_REVISIONS` in `scripts/generate-criteria-baseline.mjs`, not a
   closeout edit.

**Effort sizing: S** for remedy 1 (two-line test change plus a doc-comment rewrite; no
production change). **L** for remedy 2 — it needs a Jira Cloud sandbox, owner input on
credentials, and a capture path; no CI minutes and no engine subscription.

**Ticket-ready:** yes for remedy 1. Remedy 2 needs an owner decision on sandbox provisioning
first, and is the same decision phase 23's live matrix already depends on.
