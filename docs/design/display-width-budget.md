# Design proposal — display width as a first-class budget

**Status: PROPOSAL, not authority.** `docs/presentation-policy.md` remains the authority on the
limits themselves. This proposes fixing how they are _measured_.

## 1. The residual, and why it is bigger than it looks

Reported at merge: `elideToWordBudget` counts **words**, so a single 500-character token — a
digest, a URL, a stack frame — passes a 15-word budget untouched and renders as a horizontal wall.

That is one symptom. The actual defect is that **the codebase has four different notions of
"length" and uses them interchangeably**:

| Notion              | Obtained by    | Where used today                                                                      |
| ------------------- | -------------- | ------------------------------------------------------------------------------------- |
| UTF-16 code units   | `text.length`  | `renderKeyValues` padding, `renderHeading` rule length, the format gate's char budget |
| Code points         | `countChars()` | `renderer-core`, for `CommunicationPolicy` limits                                     |
| Grapheme clusters   | _nothing_      | —                                                                                     |
| **Display columns** | _nothing_      | — but this is what every one of the above is trying to approximate                    |

Every limit in `HUMAN_REPORT_LIMITS` is ultimately about **how much screen a thing occupies**. None
of them measures that.

## 2. Where it actually bites

### 2.1 `renderHeading` — a latent shearing bug

```
const rule = HEADING_RULE[ctx.profile].repeat(title.length);
```

`docs/presentation-policy.md` says this "is correct because section titles are plain single-width
text by contract". **Nothing enforces that contract.**

Measured 2026-08-11 against the shipped `renderHeading`:

| Title      | Title columns | Rule columns | Result              |
| ---------- | ------------- | ------------ | ------------------- |
| `Evidence` | 8             | 8            | correct             |
| `評価結果` | 8             | 4            | **sheared by half** |

Latent today because every caller passes ASCII — but it is a comment where a check should be.

Note the trap: a first pass at measuring this reported "aligned", because it compared
`title.length` to `rule.length` — 4 and 4. That is the exact confusion this document is about, and
it is easy to reproduce accidentally while trying to verify the bug.

### 2.2 `renderKeyValues` — alignment shears on any wide character

Padding is computed with `padEnd` on `.length`. The module's own doc rightly explains that padding
must be measured on the _plain_ text rather than the painted one — correct, and insufficient: plain
text still mis-measures wide glyphs.

Measured against the shipped `renderKeyValues`, keys `run` and `実行`:

```
"run  r-1"     value starts at column 5
"実行   r-2"   value starts at column 7   <-- the column this function exists to align
```

A CJK path, or any emoji in a key, breaks the value column by exactly the number of wide
characters. This is the single clearest argument for the primitive: the function's entire purpose
is alignment, and it aligns the wrong quantity.

### 2.3 Bullets — the reported residual

Word count is uncorrelated with width. `"a b c … o"` (15 words) is ~29 columns;
`"sha256:<64 hex>"` is 1 word and 71 columns. The budget does not bound the thing it exists to bound.

### 2.4 The format gate

`PROSE_BLOCK_MAX_CHARS` counts code units. Emoji-dense prose over-counts (blocks too early); CJK
prose under-counts (blocks too late — and CJK is exactly where a character _is_ two columns).

## 3. Proposed design

### 3.1 One primitive, in `contracts`

Add `displayWidth(text: string): number` to `packages/contracts/src/renderer-core/`, beside the
existing `countChars`, which already names this gap as out of scope.

**Algorithm**, zero dependencies (Node ≥24 is the declared engine, so `Intl.Segmenter` is available):

1. Segment into **grapheme clusters** with `Intl.Segmenter(undefined, {granularity:"grapheme"})`.
   This collapses combining marks, ZWJ emoji sequences and flags to one unit each.
2. Per cluster, width from its base code point:
   - zero-width / control / combining → **0** (reuse the codepoint set already enumerated in
     `packages/renderer/src/unicode-defense.ts` — do not write a second list)
   - East Asian Wide + Fullwidth → **2**
   - emoji presentation, incl. a base followed by VS16 → **2**
   - otherwise → **1**
3. Sum.

### 3.2 Honest limits, stated up front

**Terminal-dependent by nature.** `⚠️` (U+26A0 + VS16) renders 1 column in some terminals and 2 in
others; East Asian Ambiguous characters depend on locale. A single correct answer does not exist.

The design must therefore **pick a convention and document it** rather than imply precision:

- VS16-qualified emoji → 2 (matches the common modern terminal and the glyph vocabulary's intent)
- Ambiguous → 1 (the Western-locale default)
- Record the convention in `presentation-policy.md`, and state that ±1 column per emoji is expected
  and tolerated.

Budgets are floors on legibility, not layout guarantees, so ±1 is acceptable. Silent shearing of an
aligned column is not, which is why §3.4 matters more than exactness.

### 3.3 New limits

Add to `HUMAN_REPORT_LIMITS` (a contract change — schema, doc, and the hook's parity test):

| Limit              | Proposed | Rationale                                                  |
| ------------------ | -------- | ---------------------------------------------------------- |
| `bulletMaxColumns` | 100      | bounds the reported residual; ~15 words of ordinary prose  |
| `titleMaxColumns`  | 40       | turns `renderHeading`'s "by contract" comment into a check |

**Keep `bulletMaxWords`.** The two bound different failure modes — many short words vs. one huge
token — and whichever bites first should win. Removing the word budget would let 100 columns of
40 tiny words through, which is still unscannable.

### 3.4 Elision must cut safely

`elideToWordBudget` becomes `elideToBudget`, and must:

- cut on a **grapheme boundary** — never split a ZWJ sequence or a surrogate pair into mojibake;
- prefer the last **word** boundary at or before the column budget, falling back to a grapheme cut
  for a single over-long token (the residual's own case);
- never cut inside an ANSI escape — today it runs pre-paint, which is correct; a test should pin
  that ordering so a later refactor cannot invert it.

### 3.5 Call sites to migrate

| Site                      | Change                                                      |
| ------------------------- | ----------------------------------------------------------- |
| `renderKeyValues`         | pad by `displayWidth`, not `.length`                        |
| `renderHeading`           | rule length by `displayWidth`; throw past `titleMaxColumns` |
| `renderHumanReport`       | bullets and rows elide on both word and column budgets      |
| `stop-report-format-gate` | `PROSE_BLOCK_MAX_CHARS` measured in columns                 |

The gate is a plain `.mjs` that cannot import the workspace package, so it restates the function —
same arrangement as its limits, and it needs the **same parity test** so the two implementations
cannot drift.

## 4. Testing

- **Fixture table** of (string, expected width): ASCII, CJK, Hangul, combining acute, ZWJ family
  emoji, flag, VS16 warning sign, zero-width space, control chars.
- **Property**: `displayWidth(a + b) === displayWidth(a) + displayWidth(b)` for non-combining
  inputs — and a deliberate counter-example documenting where it fails (a combining mark at a
  boundary), since an unqualified property here would be false.
- **Alignment invariant**: for any rows, every rendered value starts at the same column, measured
  by `displayWidth` of the prefix. This is what 2.2 currently gets wrong and nothing catches.
- **Round-trip**: `displayWidth(stripAnsi(painted)) === displayWidth(plain)` — extends the existing
  colour-additive invariant to width.

## 5. Risks

| Risk                                          | Mitigation                                                                                             |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `Intl.Segmenter` cost in a hot path           | Statusline is the only hot path and does not import this. Measure before use there; memoise if needed. |
| Width tables drift with Unicode versions      | Derive from ranges, pin the Unicode version in the doc, fixture-test.                                  |
| Contract change ripples into merged closeouts | New optional limits, existing ones untouched → no criterion changes meaning.                           |
| Two implementations (contracts + `.mjs` hook) | Parity test, exactly as `IN_FLIGHT_STATES` and the limits already do.                                  |

## 6. Sequencing

1. `displayWidth` + fixtures, exported, unused. Pure addition, no behaviour change.
2. Migrate `renderKeyValues` and `renderHeading` — fixes 2.1 and 2.2, both latent today.
3. Add the two limits + `elideToBudget` — fixes the reported residual.
4. Migrate the gate's budget + parity test.

Steps 1–2 are behaviour-neutral on current inputs and can land independently of any decision about
the format gate.
