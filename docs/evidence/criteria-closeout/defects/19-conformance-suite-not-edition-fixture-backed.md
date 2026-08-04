# Defect 19-conformance-suite-not-edition-fixture-backed

**Phase:** 19 — Jira Data Center adapter (`roadmap/19-jira-datacenter-adapter.md`, exit criterion 1)

**Criterion (verbatim):**

> Parameterized conformance suite green on both `cloud` and `datacenter` (10.3 and 11.3) fixture-backed runs — CI job artifact.

**Found:** 2026-08-04, criteria-closeout pass (phase 19), at
`3dec9bf2caa6b94bd817aee414f9458c37750fd9`.

**Severity:** evidence-channel-only. The parameterized suite is real, non-trivial and green for
both deployment types, and it drives the genuine Data Center resource client and apply client
through the real `executeMutationPlan` and a real temp-dir journal. What has never happened is the
thing the parenthetical names: a run of that suite backed by per-edition 10.3 and 11.3 fixtures. No
product defect is implied or observed. The residual risk is exactly the one the clause exists to
retire — that hand-modelled wire fixtures disagree with a real Jira Data Center, and that 10.3 and
11.3 disagree with each other.

## Gap

A four-conjunct criterion. Three conjuncts hold; the parenthetical one has no bearer at all.

| Conjunct                              | Status at `3dec9bf`                                                                                                                       |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| suite green on `cloud`                | **met** — `parameterized-conformance.integration.test.ts:53` `describe.each(["cloud", "datacenter"] …)`, 3 cases, green in CI and locally |
| suite green on `datacenter`           | **met** — same `describe.each`; the harness genuinely selects the DC client pair at `conformance-harness.ts:88-123`                       |
| `(10.3 and 11.3) fixture-backed` runs | **not met** — see below. No bearer of any kind.                                                                                           |
| CI job artifact                       | **met** — CI run 30922070286, job 92034932036, job-log line 368                                                                           |

### Why the parenthetical has no bearer

Full transcript: `docs/evidence/phase-19/closeout-c1-conformance-fixture-backing.txt` (UTC-stamped,
HEAD-pinned, every command echoed with its own exit status).

1. **The suite has no cassette code path.**
   `git grep -nE "cassette|Cassette" -- …/parameterized-conformance.integration.test.ts …/conformance-harness.ts`
   exits 1. It is driven entirely by `FakeProviderScriptEntry` literals written inline in the test.
2. **The harness pins the Data Center run to one edition.** `conformance-harness.ts:93` reads
   `edition: "10.3"`, and that is the only `edition:` line in the file. There is no 11.3 conformance
   variant of any kind.
3. **The only DC cassettes are a read scenario.**
   `packages/connectors-jira/fixtures/datacenter/{10.3,11.3}/read-scenario.cassette.json` hold 7
   responses each — project, board, sprint, search, issue.get, comments, worklogs
   (`scripted-read-scenario-dc.ts:30-98`). They contain no create, link, worklog, attachment,
   transition or 412, i.e. none of the operations the conformance suite asserts.
4. **The two per-edition cassettes are byte-identical.** `md5sum` gives
   `0494d8e13d9ccf60d938d3faa2d4cf6c` for both. Nothing anywhere in the tree distinguishes 10.3 from
   11.3 on the wire, so even the read-path "per-edition" parity test
   (`fake-cassette-parity-dc.test.ts:24`) is running the same bytes twice.
5. `fake-cassette-parity-dc.test.ts` is honest about its own provenance at `:16-22`
   ("hand-authored/MODELED … not live-captured"), and its second case at `:36` asserts
   `cassette.responses` equals the hand-authored script — so the parity assertion at `:30` is a
   tautology by the suite's own construction. This is already recorded as a merged phase-18 defect
   for the Cloud sibling of the same pattern; it is noted here only to explain why that test cannot
   serve as independent 10.3/11.3 backing either way.

### Scope finding recorded alongside (probe P1)

Widening `conformance-harness.ts:63`'s condition so the **Cloud** client pair is returned for
`"datacenter"` too leaves the whole package suite green (47/47 files, 456/456 tests). The
conformance suite therefore proves _contract_ conformance, not Data-Center-ness — it asserts no REST
path, and the scripted fake transport answers any request. DC-ness is carried elsewhere
(`reads-dc.test.ts:36-43`'s `not.toContain("/rest/api/3/")` and the URL assertions in
`jira-mutation-apply-client-dc.test.ts`). This does not falsify the `datacenter` conjunct — the run
genuinely constructs and drives the DC pair — but it bounds what the green means.

### The nearest thing that exists, and why it is not this

`e2e/matrix/connector/src/exactly-once/jira-cassette-readback.test.ts:107-121` replays each
per-edition cassette through the real DC resource client, per edition, and did execute in the
v1.5.0 release-gate run (job 91004033370). It is the 7-call **read** scenario, not the conformance
suite, and it lives in a lane outside the default `npm test` fan-out. It evidences a different
sentence.

### Why this is `UNMET` and not a wording correction

Reading `(10.3 and 11.3) fixture-backed` down to "the suite is green, and separately some read
fixtures exist that are named 10.3 and 11.3" removes the guarantee the parenthetical exists for:
that the conformance assertions themselves survive contact with each supported Data Center edition's
real wire format. The closeout protocol classifies a weaker guarantee as `UNMET`, never as a wording
fix. `roadmap/19` §Work items item 6 states the intended channel in its own words — "the
parameterized suite (item 5) run in cassette-replay mode against `datacenter` fails for lack of
recordings before capture" — and that cassette-replay mode does not exist in code.

Nor is this discharged by phase 23. The criterion carries no deferral clause, and 23's ticked
provisioning work is about booting containers and probing health, not about replaying this flow.

## Proposed remedy

Two steps, in order:

1. **Capture mutation-capable per-edition cassettes.** Boot `docker/jira-datacenter/10.3/` and
   `…/11.3/` (see criterion 7's own defect record for the state of those recipes), run the
   conformance flow against each, and record the traffic to
   `packages/connectors-jira/fixtures/datacenter/<edition>/conformance-scenario.cassette.json`. The
   two files must not come out byte-identical; if they do, the capture did not happen.
2. **Add a cassette-replay mode to the conformance suite.** `buildConformanceHarness` already takes
   `readonly FakeProviderScriptEntry[]`, and `loadDatacenterReadScenarioCassette`
   (`scripted-read-scenario-dc.ts`) already shows the loader shape, so the change is a second
   `describe.each` axis over `["10.3", "11.3"]` feeding the loaded cassette in place of the inline
   literals, plus threading the edition into `conformance-harness.ts:93` instead of the pinned
   `"10.3"`.

**Effort: M.** Step 2 alone is S — the harness is already parameterized and the loader already
exists. Step 1 is what makes it M.

**Needs:** a **licensed, running Jira Data Center instance** for step 1. Atlassian requires a
licence for the REST surface the mutation flow touches, which is precisely why this phase's existing
cassettes are hand-modelled and say so. This is owner-gated: it needs both authorisation and a
licence, though it needs neither the Claude engine nor the owner's subscription. Step 2 needs
nothing but the fixtures.

**Ticket-ready:** yes.
