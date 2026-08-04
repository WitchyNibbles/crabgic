# 18 — the Jira flow is never replayed from a cassette; the only Cloud cassette is read-only

**Phase:** 18 — Jira Cloud adapter + intake/milestone synchronization
(`roadmap/18-jira-cloud-adapter.md`, exit criterion 1)

**Criterion (verbatim):**

> Plan's Jira flow passes on fakes + cassettes: board → sprint → epic → issue → link → worklog → attachment; ADF/text conversion; transitions; concurrent-edit conflicts.

**Found:** 2026-08-02, criteria-closeout pass, batch 4 (phase 18), at `main` @
`d60398f6b1d3aca2f2efbb8adfbac081d6c16904`.

**Severity:** evidence-channel-only. The engineering guarantee — that the whole named chain
applies through the real mutation pipeline, that markdown converts to ADF on the way out, that a
transition verifies, and that a 412 fails as a typed conflict — is fully and non-vacuously
evidenced on fakes. What has no bearer is the criterion's second fixture channel: no cassette in
this repository contains any part of that flow.

## Gap

### What the criterion asks for

Two fixture regimes, named conjunctively: the flow must pass "on fakes **+** cassettes". The
phase's §Interfaces produced lists both as separate deliverables of this phase —

> Fake-Jira: scriptable REST v3 + Agile double, fault-injectable, extending 16's fake-provider
> harness.
>
> Recorded Cloud v3/Agile cassettes.

— and §Out of scope makes clear who consumes them: "this phase produces the fixtures/cassettes
23 replays, not the harness itself."

### What exists

The fakes half, in `packages/connectors-jira/src/testkit/jira-flow.integration.test.ts`, is
complete and strong. Every step of the named chain is applied through the real
`@crabgic/gateway` `executeMutationPlan` against a real temp-dir `JournalStore`
(`:113`, `:123`, `:132`, `:141`, `:149`, `:161`, `:171`, `:186`), markdown is converted with 17's
`toADF` (`:152-158`), the transition's target status is resolved server-side and verified
(`:245`), and a `preconditionFailedResponse()` on `issue.update` resolves to
`{ status: "failed", errorKind: "conflict" }` (`:284-285`).
`packages/connectors-jira/src/testkit/parameterized-conformance.integration.test.ts` re-runs the
same chain under `describe.each(["cloud", "datacenter"])`.

### What is missing

There is exactly one Cloud cassette in the repository:
`packages/connectors-jira/src/testkit/fixtures/read-scenario.cassette.json`. It holds seven
`{ status, bodyText }` entries for a **read** scenario — projects list, boards list, sprints
list, issue search, issue get, comments list, worklogs list. It contains:

- no `board.create`, no `sprint.create`, no `issue.create`, no `issue.link`, no `worklog.create`,
  no `attachment.upload`;
- no transition response and no `transitions` read;
- no 412, and no non-2xx status of any kind.

So no cassette replay of this flow is possible with the fixtures that exist, and none is
attempted: the cassette's only two consumers are
`packages/connectors-jira/src/testkit/fake-cassette-parity.test.ts` and
`e2e/matrix/connector/src/exactly-once/jira-cassette-readback.test.ts`, both of which drive the
same seven read calls.

### Search trail

1. `git ls-files packages/connectors-jira | grep -i cassette` → three files: the Cloud fixture
   above and the two Data Center per-edition fixtures under `fixtures/datacenter/{10.3,11.3}/`
   (which belong to phase 19 and are likewise read-only).
2. `git grep -n cassette -- packages/connectors-jira/src packages/gates/src e2e` → the two
   consumers named above, plus Grafana-side references.
3. Read the Cloud cassette in full (29 lines) — enumerated above.
4. Read `jira-flow.integration.test.ts` and `parameterized-conformance.integration.test.ts` in
   full: both construct their responses inline via `createFakeProviderTransport`; neither reads
   a fixture file.
5. `git grep -n "loadReadScenarioCassette"` → declared in `scripted-read-scenario.ts`, used by
   the parity suite; the e2e matrix suite bypasses the loader and reads the same bytes directly
   (documented at `jira-cassette-readback.test.ts:31-49`).

### The alternative reading, and why it was not taken

"on fakes + cassettes" could be read as naming this phase's offline fixture regime as a whole —
the flow on fakes, the cassettes exercised separately by criterion 9 — rather than requiring the
flow to be replayed twice. That reading was considered and rejected for two reasons. First, it
makes the tick depend on criterion 9, which is itself unmet (see
`docs/evidence/criteria-closeout/defects/18-cassette-parity-is-a-tautology.md`), so nothing is
gained. Second, the closeout protocol forbids reading a criterion more weakly in order to tick
it; a reading that drops a named channel is exactly that.

### Related root cause

This and criterion 9's defect share one root: phase 18 has no recorded Cloud traffic at all. They
are filed separately because they fail for different reasons — here the cassette does not
**cover** the flow; there the cassette is not **independent** of the fake.

## Proposed remedy

Two options, smallest first.

1. **Extend the Cloud cassette to a write scenario and replay the flow from it** (preferred).
   Add `packages/connectors-jira/src/testkit/fixtures/write-scenario.cassette.json` holding the
   eight mutation responses `jira-flow.integration.test.ts` currently inlines, plus the
   transitions read, the 204, the verify read-back and the 412. Then parameterize the existing
   flow suite over `describe.each(["fake", "cassette"])`, sourcing the script from the inline
   array or from the fixture. The assertions do not change; only the response source does. This
   is honest only if the cassette is not simply a copy of the inline array — see the companion
   defect; at minimum the fixture must be captured from something, even a container.
2. **Correct the criterion's wording** through the dated annotation protocol, to say the flow is
   proven on fakes and that cassette coverage is read-only in this phase. This is a wording
   change to a pinned criterion, so it is a separate reviewed roadmap commit re-pinning
   `PRE_CLOSEOUT_REVISIONS` in `scripts/generate-criteria-baseline.mjs` — not something a
   closeout pass may do, and not the recommended route while option 1 is cheap.

**Effort sizing: M** for option 1 (one new fixture, one `describe.each` parameterization,
~60 lines, in existing files). No CI job needed, no live engine. Owner input is needed only if
the fixture is to be captured against a real Jira Cloud sandbox rather than hand-authored —
which is the question the companion defect raises.

**Ticket-ready:** yes.
