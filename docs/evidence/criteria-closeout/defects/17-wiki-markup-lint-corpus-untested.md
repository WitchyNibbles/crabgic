# 17 — `toWikiMarkup` output is never linted against 17's corpus

**Phase:** 17 — Shared-text renderer & blocking artifact lint
(`roadmap/17-renderer-communication-lint.md`, exit criterion 5)

**Criterion (verbatim):**

> `toWikiMarkup` output passes the same corpus subset phase 19 names as its own exit criterion.

**Found:** 2026-08-02, criteria-closeout pass, batch 3 (phase 17), at `main` @
`eabb65acb723ad1e21cfcbe4869fcfb432fe4625`.

**Severity:** evidence-channel-only. The property the criterion asserts is _true_ when measured
ad hoc today (see "What is missing", step 4) — what does not exist is any committed check that
would notice if it stopped being true. Nothing is currently mis-rendered or leaking; the
regression guard the box claims is simply absent.

## Gap

### What the criterion asks for

Phase 17's own §Test plan fixes the reading, so there is no ambiguity to exploit
(`roadmap/17-renderer-communication-lint.md:70`):

> `toWikiMarkup` output checked against 19's own stated exit criterion ("wiki rendering passes
> the 17 lint corpus").

And phase 19's own exit criterion, which criterion 5 defers to by name
(`roadmap/19-jira-datacenter-adapter.md:86`):

> `wikiMarkupRenderProfile` output passes 17's blocking-artifact-lint corpus — golden-file diff
> test, zero exceptions.

So the corpus named is `packages/renderer/fixtures/corpus/` — 17's blocking-artifact-lint corpus
— and the thing that must pass it is **the converter's output**, not its input.

### What exists

- `packages/renderer/src/wiki-markup.test.ts` (9 tests). Its last case is even named "passes the
  same corpus subset toADF validates (roadmap/17 Test plan)" (`:40`) — but it neither reads
  `fixtures/corpus/` nor calls `lint()`. It is a `toContain` round-trip check over a
  hand-written six-line markdown string (`:41-56`), i.e. a conversion-fidelity test, not a lint
  conformance test.
- `packages/renderer/src/golden.test.ts:105-107` snapshots one `toWikiMarkup` output. Byte
  stability, not lint conformance.
- `packages/connectors-jira/src/resource-client/datacenter/wiki-markup-render-profile.test.ts`
  is the only file in the tree that imports both `lint` and `toWikiMarkup` (`:4`). It calls
  `lint()` exactly three times — `:105`, `:168`, `:389` — and **every one of them lints the
  input `candidate`, then converts afterwards**; the converted wiki markup is only ever checked
  with `toContain`/metacharacter-escaping helpers. Its `GOLDEN_CORPUS` (`:44-61`) is a
  seven-item array of markdown strings declared inside the test file, not
  `packages/renderer/fixtures/corpus/`.
- Its `:64-71` parity case (`adfDocumentToWikiMarkup(toADF(md))` byte-equals `toWikiMarkup(md)`)
  is real and useful, but it is a _parity_ proof between two serializers, not a proof that
  either one's output survives 17's lint.

### What is missing

No test anywhere runs `toWikiMarkup`'s **output** through `lint()`, against any corpus.

### Search trail

Committed verbatim as `docs/evidence/phase-17/closeout-c5-wiki-corpus-search-trail.txt`
(command line and exit status in its header). Six steps:

1. `git grep -ln "toWikiMarkup"` (dist/ excluded) → 11 files.
2. Of those, the only non-doc, non-roadmap file that also contains `lint(` is
   `wiki-markup-render-profile.test.ts`.
3. All three `= lint(` call sites in that file printed with context — each lints `candidate`
   and _then_ converts.
4. Every file that reads the corpus directory (`corpus.test.ts`,
   `renderer-corpus-shared.test.ts`) cross-checked for `toWikiMarkup` → neither mentions it.
5. Phase 19's four `wikiMarkupRenderProfile` lines quoted, including its exit criterion.
6. Phase 17's §Test plan sentence quoted.

Additionally, an ad-hoc probe run during this pass (a throwaway script under the pass's
scratch directory, **deliberately not committed as evidence and not cited by any tick**)
fed each of the eight `valid-*.json` corpus fixtures through
`lint(toWikiMarkup(candidate), fixture.kind, DEFAULT_COMMUNICATION_POLICY)`: all eight returned
`{ ok: true }`. That is what makes this evidence-channel-only rather than a live defect — and
it is also why the remedy is small: the assertion the criterion wants would be green on the
day it is written.

### Related, recorded so the next reader is not misled

`docs/evidence/phase-17/README.md`'s exit-criterion-5 row describes the existing test as one
"that runs the identical markdown fixture used in `golden.test.ts`'s `toADF` case through
`toWikiMarkup`". The two markdown strings differ. `golden.test.ts:90-99` uses
`# Milestone update`, `Outcome: shipped the **renderer** lint pipeline.`, `- unit suite green`,
`- property suite green`, `See [the build](https://ci.example.com/build/42) for details.`;
`wiki-markup.test.ts:41-48` uses `# Heading`,
`A paragraph with **bold**, *italic*, \`code\`, and [a link](https://example.com).`,
`- bullet one`, `- bullet two`. The README also never mentions `lint()` for this row, which is
the actual gap.

## Proposed remedy

Smallest honest fix, in `packages/renderer/src/wiki-markup.test.ts` (the phase's own package,
no new file, no production change):

1. Load `packages/renderer/fixtures/corpus/` the same way `corpus.test.ts` does — `readdirSync`
   then `JSON.parse` — reusing that suite's fixture interface.
2. For every fixture with `expect === "ok"`, assert
   `lint(toWikiMarkup(fixture.candidate), fixture.kind, DEFAULT_COMMUNICATION_POLICY)` equals
   `{ ok: true }` — the converter must not _introduce_ a violation into text that was already
   clean.
3. Carry the same anti-vacuity floor `corpus.test.ts` uses
   (`expect(fixtures.length).toBeGreaterThanOrEqual(21)` and one valid fixture per
   `ArtifactKind`), so a broken glob cannot certify the absence.
4. Write it failing-first in the ordinary way (assert against a stubbed `toWikiMarkup` that
   returns a `<script>` tag, confirm red, revert the stub), so the box gets the red-then-green
   provenance the rest of this phase's stages have.

Whether phase 19 should carry the mirror assertion for `adfDocumentToWikiMarkup` against the
same corpus is 19's own exit criterion's business and is deliberately left to 19's closeout —
this remedy closes 17's box only.

**Effort sizing: S** (one `describe` block, ~25 lines, in an existing test file). No CI job
needed, no live engine, no owner input. Runs inside the default `npm test` fan-out.

**Ticket-ready:** yes.
