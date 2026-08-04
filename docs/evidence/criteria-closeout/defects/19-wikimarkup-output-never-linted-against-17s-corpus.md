# Defect 19-wikimarkup-output-never-linted-against-17s-corpus

**Phase:** 19 — Jira Data Center adapter (`roadmap/19-jira-datacenter-adapter.md`, exit criterion 4)

**Criterion (verbatim):**

> `wikiMarkupRenderProfile` output passes 17's blocking-artifact-lint corpus — golden-file diff test, zero exceptions.

**Found:** 2026-08-04, criteria-closeout pass (phase 19), at
`3dec9bf2caa6b94bd817aee414f9458c37750fd9`.

**Severity:** evidence-channel-only. The serializer is genuinely wired into production
(`jira-mutation-apply-client-dc.ts:91, 99, 107`), byte-parity with 17's own `toWikiMarkup` is
proven, and the adversarial escaping battery around it is strong — including the fixed
`{code}`-fence breakout. The gap is that no test anywhere runs either converter's **output** through
`lint()`, against 17's corpus or any other. An ad-hoc probe recorded in the merged phase-17 defect
record passed 8 of 8, so no mis-render is observed; what is missing is the standing check.

## Gap

Three conjuncts. None of the first two is met.

| Conjunct                                                   | Status at `3dec9bf`                                                               |
| ---------------------------------------------------------- | --------------------------------------------------------------------------------- |
| serializer **output** passes 17's blocking-lint **corpus** | **not met** — no `lint(` call anywhere takes converter output as its argument     |
| **golden-file** diff test                                  | **not met** — `GOLDEN_CORPUS` is a 7-item in-file array; no golden file is diffed |
| zero exceptions                                            | vacuously true of a check that does not run                                       |

Full search trail: `docs/evidence/phase-19/closeout-c4-wiki-lint-corpus-search.txt` (UTC-stamped,
HEAD-pinned, every command with its own exit status).

### The three `lint()` calls in this phase's serializer suite all lint the INPUT

`wiki-markup-render-profile.test.ts:105`, `:168` and `:389` each call
`lint(candidate, kind, DEFAULT_COMMUNICATION_POLICY)` on the **candidate markdown string**, assert
`outcome.ok`, and only then convert. The converted output is subsequently checked with `toContain`
and with the suite's own metacharacter helpers — never with `lint()`. Tree-wide,
`git grep -nE "lint\(\s*(adfDocumentToWikiMarkup|toWikiMarkup|wiki|wikiMarkup)" -- packages/ e2e/`
exits 1.

### 17's corpus has two consumers, neither of them a wiki-markup test

`packages/renderer/fixtures/corpus/` holds 33 fixtures. `git grep -rln "fixtures/corpus"` finds
`packages/renderer/src/corpus.test.ts` and `packages/git-engine/src/renderer-corpus-shared.test.ts`.
Both lint `fixture.candidate` — the input — exactly as they should for their own purposes. Neither
converts anything.

### 17's own remedy has not landed

`packages/renderer/src/wiki-markup.test.ts` still calls `lint()` zero times. The merged phase-17
defect record on this same gap proved it tree-wide, committed its search trail at
`docs/evidence/phase-17/closeout-c5-wiki-corpus-search-trail.txt`, and explicitly left the mirror
assertion "to 19's own closeout" — which is this record. A closeout pass files defects; it does not
fix them, so the situation is unchanged and now recorded on both sides.

### No golden file is diffed

`git grep -nE "toMatchFileSnapshot|readFileSync.*golden"` over
`packages/connectors-jira/src/resource-client/datacenter/` exits 1. What exists is
`wiki-markup-render-profile.test.ts:44-62`'s in-file `GOLDEN_CORPUS` — 7 markdown strings, each
asserted `adfDocumentToWikiMarkup(toADF(md))` byte-equals `toWikiMarkup(md)`. That is a real and
useful parity proof between two independent serializers. It is not a golden **file**, and parity is
not lint conformance. The nearest golden-file thing, `packages/renderer/src/golden.test.ts:105-107`,
snapshots one `toWikiMarkup` output — byte stability, again not lint.

### The reduction that makes this precise

Because the parity test pins this phase's serializer output to `toWikiMarkup`'s, the criterion's
property reduces to "does `toWikiMarkup`'s output pass 17's corpus". That is exactly the check the
phase-17 defect record documents as absent. So the missing bearer is shared, not DC-specific, and
fixing it once fixes both boxes.

### Out of scope for this record

The DC-specific `{code}`/`{noformat}` fence-breakout residual is **fixed and well tested**
(`wiki-markup-render-profile.test.ts:286-404`, ZWSP neutralization, a 6-item benign-code golden, a
`pr_body`-kind lint-interaction case and a 300-run property). It is orthogonal to this criterion's
missing bearer and is not re-filed here.

### Why this is `UNMET` and not a wording correction

Reading "output passes 17's blocking-artifact-lint corpus" down to "the output byte-matches another
serializer whose input passed lint" removes the guarantee the clause exists for: that the
_serialized wiki markup itself_, not its markdown source, survives the blocking lint. Prohibited
content can in principle be introduced by a serializer — that is why the phase's own adversarial
suite exists — so the substitution is strictly weaker. The protocol classifies a weaker guarantee as
`UNMET`.

## Proposed remedy

Mirrors the remedy in the merged phase-17 defect record, so the two land together:

<!-- prettier-ignore-start -->
```text
for each fixture in packages/renderer/fixtures/corpus/ whose expectation is "ok":
  expect(lint(adfDocumentToWikiMarkup(toADF(fixture.candidate)), fixture.kind,
              DEFAULT_COMMUNICATION_POLICY).ok).toBe(true)
```
<!-- prettier-ignore-end -->

plus the same anti-vacuity floor `packages/renderer/src/corpus.test.ts` already applies to itself
(assert the fixture count is at least 21, so a loader that silently reads nothing fails loudly).
For the attack fixtures, assert the converted output still fails lint — otherwise the serializer
could be laundering them.

Land the same loop against 17's own `toWikiMarkup` in `packages/renderer/src/wiki-markup.test.ts`,
which is what the phase-17 record asks for, and the "golden-file diff" conjunct is best satisfied by
writing the converted corpus outputs to `packages/connectors-jira/fixtures/wiki-golden/` and
diffing against them, rather than by keeping the 7-item in-file array.

**Effort: S.** No new infrastructure: the corpus loader, `lint()`, `toADF`, both serializers and the
fixture-count floor all already exist and are already composed pairwise.

**Needs:** nothing — no live instance, no container, no engine, no secret.

**Ticket-ready:** yes.
