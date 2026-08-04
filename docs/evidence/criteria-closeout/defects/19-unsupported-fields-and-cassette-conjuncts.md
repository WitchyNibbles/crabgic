# Defect 19-unsupported-fields-and-cassette-conjuncts

**Phase:** 19 — Jira Data Center adapter (`roadmap/19-jira-datacenter-adapter.md`, exit criterion 2)

**Criterion (verbatim):**

> DC-only unsupported actions/fields return typed `unsupported` — fixture-proven cassette test, zero raw-fallback occurrences.

**Found:** 2026-08-04, criteria-closeout pass (phase 19), at
`3dec9bf2caa6b94bd817aee414f9458c37750fd9`.

**Severity:** mixed. The **fields** half is a real, measured product-behaviour divergence — a Data
Center connection rejecting an undiscovered custom field returns canonical kind `validation`, not
`unsupported`, and attributes the error to provider `"jira-cloud"`. That is a wrong canonical kind
and a wrong provider on a live code path, not merely a missing test, though the write is still
refused so nothing unsafe reaches the wire. The **cassette** half is evidence-channel-only. The
actions half and the zero-raw-fallback half both hold.

## Gap

Four conjuncts. Two hold, two do not.

| Conjunct                                | Status at `3dec9bf`                                                                                                                          |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| unsupported **actions** → `unsupported` | **met** — `jira-datacenter-resource-client.test.ts:129-144` asserts `kind === "unsupported"`; production gate at `…resource-client.ts:83-94` |
| unsupported **fields** → `unsupported`  | **not met** — measured `kind = "validation"`, `provider = "jira-cloud"` (below)                                                              |
| fixture-proven **cassette** test        | **not met** — no cassette anywhere asserts any `unsupported`                                                                                 |
| zero raw-fallback occurrences           | **met** — emptiness proof below                                                                                                              |

Full transcript: `docs/evidence/phase-19/closeout-c2-unsupported-actions-and-fields.txt`
(UTC-stamped, HEAD-pinned, both probe sources reproduced verbatim, every command with its exit
status).

### The fields conjunct — measured, not read (probe P2b)

Driving three custom-field write paths through the **real** Data Center resource client with an
empty field-metadata index:

<!-- prettier-ignore-start -->
```text
issues.planUpdate  customfield_99999 (undiscovered): kind="validation" provider="jira-cloud" retryable=false
issues.planCreate  customfield_99999 (undiscovered): kind="validation" provider="jira-cloud" retryable=false
issues.planBulkUpdate customfield_99999 (undiscovered): kind="validation" provider="jira-cloud" retryable=false
```
<!-- prettier-ignore-end -->

Two divergences from the criterion's own words, and from `roadmap/19` §In scope ("Unrecognized
fields or actions return typed `unsupported` (P02) — never guessed, never a raw-endpoint fallback"):

1. **Wrong canonical kind.** Field-level enforcement is phase 18's shared
   `packages/connectors-jira/src/capability/field-metadata.ts:58-81`
   (`assertCustomFieldWritesAreDiscovered`), which throws `ConnectorError.validation` at both `:67`
   and `:74`.
2. **Wrong provider attribution.** The same two throws hardcode `JIRA_PROVIDER_NAME`, which is
   `"jira-cloud"` (`errors/jira-error-mapping.ts`), so a Data Center connection's field rejection is
   attributed to Cloud. Note that this phase already fixed the _same_ class of mis-attribution for
   unsafe-ADF rejections, by pre-checking with `JIRA_DATACENTER_PROVIDER_NAME` at the DC plan-build
   boundary (`jira-datacenter-resource-client.ts:159-163, 169-173, 240-244, 249-253`) — the
   custom-field path was not given the same treatment.

No DC-context test exercises a field rejection at all, which is why neither divergence was visible.

### `DcEditionEntry.availableFields` is a dead data member

`availableFields` is the literal `"discovered-only"` for both matrix entries
(`dc-edition-feature-matrix.ts:25, 34, 35`) and no production code branches on it — the unfiltered
grep finds only the declaration, the two entries, and test/harness fixtures. The criterion's
"fields" half therefore has no per-edition mechanism behind it either; the phase's own evidence
README carry-forward 3 admits the placeholder.

### The cassette conjunct has no bearer

The only Data Center cassettes are the happy-path 7-call read scenario (see criterion 1's defect
record). `git grep -nE 'kind.*unsupported|toBe\("unsupported"\)' -- packages/connectors-jira/src/testkit/`
exits 1: no testkit test asserts a typed `unsupported` at all, cassette-backed or otherwise.

### Do not cite `isActionSupportedForDcEdition` (probe P2c)

`docs/evidence/phase-19/README.md`'s criterion-2 row offers that function's `fast-check` property as
the "never guesses" proof. The function has **zero production callers** — the unfiltered grep finds
its own module, its own test, and the `index.ts:206` barrel export. Replacing its body with
`return true;` reddens only its own test file (2 tests), with the other 46 files green. The real
gate is client-internal `assertActionSupported`, which deliberately consults
`dcFeatures.availableActions` directly (doc comment at `jira-datacenter-resource-client.ts:71-82`).
This closeout does not rely on it, and neither should any future one.

### Bound on the actions conjunct (probe P2a)

The action gate is one shared helper reached through 17 `gate("…")` call sites. Deleting each call
site individually and running the whole package suite reddens for exactly **3 of 17** —
`board.create` (line 114), `sprint.create` (line 130), `worklog.create` (line 267), the three
actions the two unsupported-action tests happen to call. The other fourteen can each be dropped with
the suite green. The mechanism is proven; per-action coverage is not. Recorded here so the tick on
the actions conjunct is not read as more than it is.

### Why the zero-raw-fallback conjunct does hold

Emptiness proof scoped to `packages/connectors-jira/src/resource-client/datacenter/` (re-run at
merge time): every request path built by `jira-mutation-apply-client-dc.ts` is a string literal
under `/rest/api/2/` or `/rest/agile/1.0/` — ten of them, enumerated in the transcript — and
`git grep -nE "raw\.request|rawEndpoint|rawFallback|plan\.(url|endpoint|path)"` over that directory
exits 1. `jira-mutation-apply-client-dc.ts:345` additionally re-checks 18's closed allowlist
`assertAllowedJiraOperation`, whose forged-action table explicitly includes `"raw.request"`
(`security/preflight-capability-guard.test.ts:15-30`), and the DC apply client's own
`:231` case asserts a forged out-of-scope action is rejected before any request is built.

### Why this is `UNMET` and not a wording correction

Reading "unsupported actions/**fields**" down to "unsupported actions, and fields get refused
somehow" drops a canonical-taxonomy guarantee that `roadmap/19` §In scope states twice, and reading
"fixture-proven **cassette** test" down to "fixture-proven test" drops the fixture provenance the
clause exists for. Both are weaker guarantees, which the protocol classifies as `UNMET`.

## Proposed remedy

Three independent pieces; the first two close the fields conjunct, the third closes the cassette
conjunct.

1. **Decide and fix the canonical kind.** Either give
   `assertCustomFieldWritesAreDiscovered` an explicit kind/provider parameter (Cloud keeps
   `validation`/`jira-cloud`; Data Center passes `unsupported`/`JIRA_DATACENTER_PROVIDER_NAME`), or
   obtain a criterion-owner ruling that `validation` is the right kind for an undiscovered field and
   re-word the criterion accordingly. The provider mis-attribution is a bug either way and should be
   fixed regardless — the DC client already demonstrates the pre-check pattern that fixes it, at
   `jira-datacenter-resource-client.ts:159-163`.
2. **Add a DC field-rejection test.** One case per entry point (`planUpdate`, `planCreate`,
   `planBulkUpdate`) asserting both `kind` and `provider`. This is what would have caught (1).
3. **Add a cassette that carries a refusal.** Requires the per-edition mutation cassettes described
   in criterion 1's defect record, plus one recorded response for an action the edition does not
   offer.

**Effort: S** for pieces 1 and 2 (roughly 25 lines of production change plus a test file), **M**
overall once piece 3's capture is included.

**Needs:** piece 3 needs a licensed live Data Center instance (owner-gated, same dependency as
criterion 1). Pieces 1 and 2 need nothing beyond a normal working tree — but piece 1 is a production
change, so it belongs to an implementation pass, not to a closeout pass.

**Ticket-ready:** yes.
