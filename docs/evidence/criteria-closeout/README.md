# Criteria-closeout index

One record per roadmap phase — `phase-NN.json` — written by the closeout pass that walks that
phase's exit criteria against its own recorded evidence, ticking only what the evidence actually
proves.

`roadmap/README.md`'s completion ledger is the reason this directory exists: "each checkbox must
map to a CI run, journal entry, or committed artifact." These records apply that rule to the
closeout itself, so a tick's citation is machine-resolvable rather than a claim in prose.

Validated by `scripts/check-criteria-closeout.mjs`
(`npm run check:criteria-closeout`, a step in `ci.yml`'s `meta-checks` job), backed by the frozen
original-wording baseline `criteria-baseline.json`, which `npm run check:criteria-baseline`
re-derives from git history in the same job. The validator's own rejection paths — 142 cases, almost
all rejections — are unit-tested in `scripts/check-criteria-closeout.test.mjs`; the baseline generator
(11) and the run resolver (27) add 38 more, for 180 across the three suites.

## Layout

| Path | Owner |
|---|---|
| `phase-NN.json` | the agent that closed phase NN |
| `defects/NN-<slug>.md` | same — one file per criterion left unticked |
| `defects/INDEX.md` | the closeout integrator (last batch), not individual phase agents |
| `criteria-baseline.json` | **nobody** — frozen. See "The frozen baseline" below |

Every path is phase-prefixed, so parallel agents never collide.

## Record shape

```jsonc
{
  "schemaVersion": 1,
  "phase": "12",                                  // two digits, must match the filename
  "roadmapFile": "roadmap/12-stack-detection-quarantine.md",
  "pass": {
    "date": "2026-08-01",                         // YYYY-MM-DD
    "agent": "criteria-closeout pass, batch 0 (pilot)",
    "headSha": "4f2b33bbf68f517643a8d4f8eb5f85c793e99e3f"   // full 40-char object ID
  },
  "criteria": [                                   // one entry per checkbox, in file order
    {
      "index": 1,                                 // 1-based, contiguous
      "text": "…",                                // the criterion VERBATIM, pre-annotation
      "textSha256": "…",                          // sha256(text), utf8
      "classification": "EVIDENCE-EXISTS",        // one of the seven classes below
      "ticked": true,                             // derived from the class — never chosen freely
      "citations": [
        {
          "kind": "ci-run",                       // ci-run | artifact | test | journal-export | discharge
          "ref": "CI / unit-test+coverage (ubuntu-latest), job 91399985018, step \"…\"",
          "url": "https://github.com/WitchyNibbles/crabgic/actions/runs/30711622357",
          "commit": "4f2b33b…",
          "quotedAssertion": "file:line — 'the load-bearing assertion, verbatim'"
        }
      ],
      "notes": "optional — scope caveats, anti-vacuity controls, anything a reader needs",
      "wordingCorrection": { "before": "…", "after": "…" },        // WORDING-MISMATCH only
      "defectRef": "docs/evidence/criteria-closeout/defects/12-….md" // untickable classes only
    }
  ]
}
```

Unknown keys are rejected at every level. `url`, `commit` and `quotedAssertion` are optional on a
citation **except on a `ci-run`, where all three are required** — see check 8. Everything else shown
is required.

**Every path a record writes — a `test`/`artifact`/`journal-export` `ref`, and a `defectRef` — must
already be the plain repository path.** No `./`, no `..`, no leading `/`, no backslash. Dot segments
were a live bypass (see check 7); requiring normal form means the string a check reads and the file
that resolution opens can never be two different things.

## Defect record shape (`defects/NN-<slug>.md`)

`UNMET` **must** name one. `EVIDENCE-NEEDS-CI` and `EVIDENCE-NEEDS-LIVE` **may**, to machine-link
the handoff record for the run that has not happened yet — phase 10's live-gated criterion 7 was the
first to need it, and phases 06 and 19 have the same shape. A handoff is a defect record in
everything but name: identical file shape, identical checks, no new schema key. The permitted set is
**derived** as "the classifications that may not be ticked", so a criterion carrying a tick can never
name one — a tick means the evidence is in hand, and a record of what is outstanding contradicts it.

Checked, not merely required to exist — a reviewer truncated a real one to zero bytes and the old
validator stayed green. A defect (or handoff) record must carry:

| Element | Recognised as | Why it is checked |
|---|---|---|
| a real file | not a directory, not a symlink | `existsSync` alone let a **directory** named `NN-slug.md` pass — and then reading it threw `EISDIR` and took the validator down |
| the criterion, verbatim | `**Criterion (verbatim):**` then a `> …` blockquote **equal to the record's `text`** | the one part that cannot be boilerplate; it binds this file to this box |
| the phase | `**Phase:** NN — …` | convention, not enforced |
| a severity | `**Severity:** …` or `## Severity` | an unrated defect cannot be triaged |
| a remedy | `## Proposed remedy` (or `## Remedy`) | filing without a way forward is not a deliverable |
| effort sizing | an `S`/`M`/`L` near the words *effort*/*size*/*sizing* | "how big is this" is what makes it ticket-ready |

Everything else the existing records carry — `**Found:**`, `## Gap`, `### Search trail`, "what
exists" vs "what is missing" — is strongly expected by review and not machine-checked. Copy
`defects/12-capability-tools-stub-mcp-client.md`.

## Classifications

| Class | Ticked | Meaning |
|---|:-:|---|
| `EVIDENCE-EXISTS` | yes | A committed artifact, resolvable CI run, or committed journal export already demonstrates it, non-vacuously |
| `EVIDENCE-REPRODUCED` | yes | No recorded execution existed; the agent's own scoped run is the only execution evidence, committed verbatim |
| `SUPERSEDED-DISCHARGED` | yes | The criterion's own deferral clause is discharged by a later closed phase's ticked box |
| `WORDING-MISMATCH` | yes | The check passes but the criterion's literal words claim something adjacent; corrected per the wording protocol |
| `EVIDENCE-NEEDS-CI` | no | The wording demands a CI run of a job with no green record. Costs CI minutes, not the owner's subscription. May name a handoff record in `defectRef` |
| `EVIDENCE-NEEDS-LIVE` | no | Needs the real engine / owner subscription (`@live`, `engine-live`). Owner-gated batch only. May name a handoff record in `defectRef` |
| `UNMET` | no | No check exists, the check fails, or the claim is false. Stays unticked, defect record filed |

**Settled: `EVIDENCE-EXISTS` vs `EVIDENCE-REPRODUCED` when both apply.** If the named check was
executed by a CI run you can cite — and you have confirmed from the job log that the run really
executed *that* suite — the class is **`EVIDENCE-EXISTS`**, and a local transcript you produce is a
*supplementary* `artifact` citation, not the primary one. **`EVIDENCE-REPRODUCED`** is reserved for
the case where your own scoped run is the *only* execution evidence in existence. Pinned here so 23
records do not classify the same situation three different ways.

## What the validator enforces

1. **Strictness** — unknown or missing keys fail. A typo'd `citation` cannot silently record nothing.
2. **One real `## Exit criteria` section** — a phase file must contain **exactly one**, and the
   parser blanks fenced code blocks before looking, so a `## Exit criteria` line inside a ```
   example is not mistaken for it. Criterion-shaped `- [ ]` lines outside the section fail too.
   This sits first among the content checks because everything below is downstream of it: the
   parser used to read only the **first** such section, so a decoy inserted earlier in the file —
   mirroring the record exactly — let the **real** section be fraudulently ticked and wholly
   rewritten with the validator reporting **zero errors**. One duplicated heading bypassed the
   baseline manifest, the wording pin, tick discipline and the two-way cross-check at the same
   time, because none of them ever looked at the real section. A **nested sub-bullet** inside a
   criterion is rejected for the same reason: the parser dropped it, so
   `- EXCEPT stop conditions 3-7, which are waived for this phase` rode past both the hash pin and
   the annotation check untouched. Zero of the 211 criteria carry one, so fold any such qualifier
   into the criterion's own sentence.
3. **The wording pin** — `sha256(text)` must match, *and* `text` must account for the **whole**
   checkbox item in the phase file: it must be that item's prefix, and whatever follows must be
   empty or start with `— **` (the citation annotation, `— **Evidence …**`). Both halves are
   load-bearing. A bare prefix match would let a record pin a harmless opening substring and leave
   a softened tail invisible; a bare *em dash* lead would let a record stop at the criterion's
   **own** internal em dash, against an unmodified checkbox, so the evidence-channel clause after
   it (`— suite \`install.matrix.test\``) escaped the hash — 95 of the roadmap's 211 criteria
   contain an internal em dash, and zero contain `— **`. A criterion reworded to make it tickable
   fails here.

   **The annotation itself is now shaped, and the weakening clause moved into it.** Requiring the
   lead `— **` closed the em-dash channel and the text simply moved four characters right:
   `— **Evidence (2026-08-02), WAIVED for all cases except empty dir; the suite is advisory only:**`
   validated green, while the validator's own error message already claimed the tail was "the
   `— **Evidence …**` citation annotation". Four things are now checked — the bold span must
   **close**; the bold head must lead with a **recognised label** (`Evidence` when the box is
   ticked, `Left unticked` / `Open defect` / `UNMET` when it is not); the label must therefore
   **agree with the tick**; and the head must carry a **date**. The two vocabularies are **disjoint**
   and the suite asserts they stay so — that disjointness is the whole bite, and the enumeration is
   asserted to still cover every merged record, so it fails in the suite rather than surprising the
   next closeout PR. Two stronger rules were measured against all 132
   annotated criteria and **rejected because honest records fail them**: a strict
   `— **<Label> (<date>):**` shape fails 7 criteria across 5 honest forms, and requiring the
   annotation's date to equal the record's `pass.date` fails 14 in phases 01 and 11. **This does not
   close the weakening channel** — see limit 7.

   **Every criterion must use the `-` bullet.** GitHub renders `* [x]` and `+ [x]` as ticked task
   list items exactly like `- [x]`, and this parser read only `-` — so such a line was invisible to
   the hash pin, the counts, the tick cross-check and the stray scan alike. Appending
   `* [x] <anything>` inside a real `## Exit criteria` section of a phase that **has** a closeout
   record left both `check-criteria-closeout` and `generate-criteria-baseline --check` reporting
   PASS while github.com rendered a ticked criterion nothing pinned. Rejected rather than absorbed,
   for the same reason as the nested sub-bullet: absorbing would silently move a baseline hash the
   first time somebody reached for a different bullet.
4. **Two-way agreement with the roadmap** — checkbox count equals criteria count, and each box's
   `[x]`/`[ ]` state equals its record's `ticked`. Within a phase that has a record, a box ticked
   without a matching entry fails, and so does a record claiming a tick the file does not have.
   A phase file that *cites* `phase-NN.json` without that file existing is reported, so ticking
   boxes and forgetting the JSON is not invisible — **and so is a phase file with ticked criteria
   and no record at all.** That last one was the cheapest attack on this whole directory: every
   other check is anchored on a record existing, so ticking all seven of `roadmap/13`'s boxes and
   writing nothing passed. Phase **23** is the single grandfathered exemption (closed and evidenced
   against `release-e2e` run 30250453824 before this index existed); the list is closed.
   **A pinned phase file that has been DELETED is reported.** Every other check here — and
   `--check` in the baseline generator — iterates over the phase files that are *present*, so
   nothing asserted that a pinned phase still has one: deleting `roadmap/22-learning-system.md`, 8
   unticked criteria, left both reporting PASS. With 12 phases still unclosed, deleting a phase file
   is strictly easier than closing it. Removing a phase is a roadmap decision that re-pins the
   baseline in its own commit, not something a closeout pass does.
5. **The frozen baseline** — every criterion's text must also hash to its entry in
   `criteria-baseline.json` (see below). Checks 2 and 3 compare the record against the phase file
   **in the same commit**, so co-editing the checkbox and the record defeated both at once; the
   baseline is the one anchor that does not move when the commit under review moves.
6. **Tick discipline** — `ticked` is derived from the classification; every tick carries ≥1 citation;
   every `WORDING-MISMATCH` carries a before/after whose **`before` is the criterion's own pinned
   `text`** (whitespace-normalized), because the protocol leaves the original wording in the phase
   file and puts the correction in the annotation — so `before` is, by construction, what the box
   still says. Every `UNMET` names a defect record that is a **real defect record**, not merely a
   file that exists: non-empty, quoting its criterion verbatim in a blockquote, stating a severity,
   and proposing a remedy with S/M/L sizing. The two `NEEDS-*` classes may name one too (their
   handoff record); no class that carries a tick may.
7. **Citations resolve** — `test` and `artifact` refs are repository paths (with an optional
   `:line` or `:line-line` suffix) and must resolve to a **regular file inside the repository
   root**. A directory ref, an absolute path and a `..` escape all fail; so does a **symlink**,
   whether cited directly or sitting in a parent directory, because `existsSync`/`statSync` follow
   links while `path.resolve` does not — a committed `evidence/evil.txt -> /etc/hostname` otherwise
   reads as evidence. The **line span must exist in the file**: `:9999` on a 200-line file, a `:0`,
   and an inverted range are all rejected. This pass's own phase-12 defect exists *because* a cited
   test file was deleted in a refactor and nothing noticed, and the pilot's single rebase slid five
   of its own `file:line` citations with the files still present. A ref into **`node_modules/` or
   `.git/`** fails — `npm ci` runs before the validator in every CI job, so `node_modules` always
   resolves while being precisely *not* content this repository carries. A ref naming a **closeout
   record** (`phase-NN.json`) fails too: a record is the claim, never the evidence for itself —
   **and so does anything else in this directory.** That refusal matched the `phase-NN.json`
   filename shape *alone*, so a reviewer appended to a ticked criterion, each with wholly forged
   `quotedAssertion` text, an `artifact` citation of the pass's **own defect record**, an `artifact`
   citation of **this README**, and a `journal-export` citation of **`criteria-baseline.json`** — and
   the validator passed. No path games were needed; it simply aimed one directory to the side. A
   defect record, this README and the baseline are all written by the same pass, in the same PR, as
   the record that would be citing them, so the whole **claim-space** is refused. Measured before
   enforcing: across the merged records, **zero of 774** citations resolve into this directory.
   Evidence transcripts belong under `docs/evidence/phase-NN/`, which is where the real records
   already file them.

   **And a record may not cite its OWN phase file** — the sharpest form of the same thing. A
   reviewer made a ticked criterion's *only* citations (a) `roadmap/22-learning-system.md:96`, the
   phase's own checkbox **annotation quoted as evidence for itself**, and (b) that pass's own defect
   record. Both passed, so the mandatory "a ticked criterion needs ≥1 citation" was satisfiable
   entirely by text the pass wrote in the same commit. Note that path canonicality does **not** reach
   this: it hardens how a ref is *matched*, not which targets are refused. Scoped to the record's
   **own** phase file, deliberately — zero merged records cite their own, while phase 17
   legitimately cites `roadmap/19-…` across phases, and refusing `roadmap/` generally would break
   that honest citation.

   **A ref must already be its own normal form**, and this was a live bypass:
   `docs/evidence/criteria-closeout/./phase-14.json:1-5` validated **green** as an `artifact`
   citation while the plain form was correctly refused — so a ticked criterion's mandatory ≥1
   citation could be satisfied by a **self-citation**. `defects/14-decoy/../14-ratchet-….md`
   passed the same way, borrowing the mandatory `defects/NN-` phase prefix from a directory the
   `..` then discards. One cause, several victims: the self-citation regex, the segment scan and
   the `defectRef` prefix all matched the **raw string** while `path.resolve`/`path.join`
   normalized underneath them. Requiring normal form — rather than merely normalizing before each
   check, which would silently *accept* the decoy path as though the real one had been written —
   closes the class rather than its instances. A **backslash** is refused for the same reason
   (POSIX resolution reads it as a filename character, the segment scan as a separator), and the
   self-citation and `node_modules`/`.git` comparisons are now case-insensitive, because macOS and
   Windows checkouts open `Phase-14.json` while a case-sensitive regex reads it as an unrelated
   path. A `defectRef` is now held to the same containment and symlink rules as a citation: it had
   **none**, so `..` past the repository root named a "defect record" no reviewer of this
   repository can see — and the validator read it.

   **And the same two content checks now run on what the path OPENS, not only on what it says.**
   They ran on the cited ref alone, while the containment check accepts any target inside the
   repository root — and `node_modules/` and `.git/` *are* inside the repository root. A committed
   `docs/evidence/nmlink -> ../../node_modules`, cited as
   `docs/evidence/nmlink/vitest/package.json:3`, therefore passed everything: the final component is
   a regular file, so the direct-symlink refusal never fired, and the parent-realpath check only
   rejects escapes *outside* the root. The same laundering aimed a citation at a **closeout record**
   through a symlinked directory. Both are the dot-segment defect wearing a different hat — the
   check ran on the wrong string — so the segment scan and the self-citation refusal now also run
   against the repo-relative realpath.
8. **Every other citation kind resolves as far as it can.** None of them was checked for anything
   at all until a reviewer built a **wholly forged `phase-13.json`** — real checkbox texts, so every
   frozen baseline hash matched; all seven criteria `EVIDENCE-EXISTS`; every citation
   `job 00000000000` / `runs/1` — and got a green validator, a green baseline `--check` and green
   CI.
   - **`discharge`** is the one kind that resolves offline, and now does: the ref must name a
     `roadmap/NN-<slug>.md` **and** quote the discharged criterion's wording; that criterion must
     really exist in that file; and it must be **ticked** — an unticked one has discharged nothing.
     A phase-09 reviewer discharged a tick against a completely fabricated phase-23 criterion and
     it passed. It no longer does. The quote must also be **at least 40 characters**, must match
     **exactly one** criterion in that file, and must not name the record's **own** phase file —
     without those, a one-character quote, an unrelated phase's criterion, and a phase discharging
     against itself all passed. This identifies a criterion; it does not establish that the
     criterion is *relevant*. See limit 6.
   - **`journal-export`** is a committed file like any other, and resolves as one.
   - **`ci-run`** cannot be resolved from a checkout, so offline it must carry a `url` in this
     repository's `actions/runs/` (or `actions/jobs/`) space, a `quotedAssertion` — logs expire,
     the quote is the durable part — **the `commit` the run ran at**, and a `ref` that **leads with
     the workflow name** (`CI / unit-test+coverage (ubuntu-latest), job 91399985018, step "…"`).
     Making the run actually **exist**, and be the run the citation says it is, is
     `npm run check:citation-runs`, a separate `meta-checks` step that resolves each URL against
     the GitHub API. Its failure semantics are deliberately asymmetric: a **404 fails the build**
     (the run is not there), and so does a **`head_sha` or workflow name that disagrees with the
     citation**, while "could not ask" — no token, rate limit, 5xx, DNS, or a response that simply
     does not carry the field — warns and passes, so an API blip cannot red an honest PR. That
     asymmetry cannot be turned into a bypass, because an attacker can make the API return neither
     404-shaped success nor a matching `head_sha` for a run that ran somewhere else. It deliberately
     does **not** require `conclusion: success`: a record may legitimately cite a **red** run as
     evidence that a gate really bites, and phase 01's closeout does exactly that. A
     `/runs/<rid>/job/<jid>` URL also has its **job** resolved and checked to belong to that run —
     the suffix used to be matched and then discarded, so a fabricated job number pinned under a
     real run was free text.

     **Provenance was the second live bypass, and the more serious one.** Until it was closed,
     existence was *all* this proved. A reviewer repointed phase 01's criterion 1 at run
     **30250453824** — a months-old `release-e2e` run: wrong workflow, wrong commit, months before
     the criterion existed — set `commit` to the null object id, and replaced `quotedAssertion`
     with a fabrication. The offline validator reported **zero errors**, and `check-citation-runs`
     would have passed too, because it only 404-checks existence and **nothing anywhere read
     `commit`**. So *any* real run in this repository's Actions history could stand as evidence for
     *any* criterion at *any* claimed commit. Both endpoints carry `head_sha` and the job endpoint
     carries `workflow_name`, so both claims are now checked with the request this step already
     made. Making `commit` required cost the merged corpus nothing: all **108** `ci-run` citations
     across the eleven records already carried one, and all **14** distinct runs they name resolve
     to exactly the recorded `head_sha` (phase 08's abbreviated `d11b0594` is compared as a prefix).
     The **dead-check guard is doubled** to match: the step already fails when it resolved runs but
     verified none, and now also when it resolved runs but confirmed **not one** cited commit — a
     provenance check that silently stops working must not print a green line.

## The frozen baseline

`criteria-baseline.json` records `sha256` of every roadmap exit criterion's whitespace-normalized
wording, **as the phase file carried it before any closeout touched it**. Closed phases are read
from their closeout commit's parent; the rest from the `main` the baseline was created against
(`af46e00`). Each phase entry pins the revision its hashes came from.

**It is not edited by closeout agents.** There is deliberately **no in-record escape hatch** — not
even `WORDING-MISMATCH`. That was the obvious design and it is unsound: the same agent writing the
record picks the classification, so a self-issued excuse is no excuse. It is also unnecessary,
because the wording protocol never changes a checkbox's words in the first place: the original is
preserved verbatim and the correction lives in the appended annotation and in
`wordingCorrection.after`. A closeout pass that needs the baseline to move has misread the protocol.

A criterion whose wording changes for **legitimate scope reasons** (not a closeout) re-pins that
phase's `sourceRev` and regenerates, in its **own** commit, reviewed as the roadmap change it is:

```
node scripts/generate-criteria-baseline.mjs --write   # after editing the pin table
node scripts/generate-criteria-baseline.mjs --check   # what CI runs
```

`--check` re-derives every committed hash straight from `git show <sourceRev>:roadmap/NN-*.md`. It
is a `meta-checks` step (which is why that job checks out with `fetch-depth: 0`). So the baseline is
not merely "a file somebody committed": forging an entry means rewriting published git history, not
editing JSON in the same PR.

## What the validator cannot catch

The baseline closed the "rewrite the criterion and its record together" hole. What remains is
narrower, and still real:

1. **The prose around the checkbox is unpinned.** The baseline hashes criterion *sentences*. A
   phase's `## Test plan`, `## Definition of done`, in-scope list or `## Risks` section can be
   hollowed out — deleting the fixtures, thresholds or named suites a criterion leans on — while
   every checkbox and hash stays byte-identical and `meta-checks` stays green.
2. **Words, not meaning.** A criterion can be satisfied by a test that technically asserts its
   sentence and misses its intent. No hash can see that; only reading the cited test can.
3. **A re-pin is only as honest as its review.** Re-pinning is loud — and note the lever is
   `PRE_CLOSEOUT_REVISIONS` in `scripts/generate-criteria-baseline.mjs`, **not**
   `criteria-baseline.json`: `--check` verifies the committed JSON against the pin table's
   revisions, so editing the table and regenerating in one PR is internally consistent and passes.
   That is by design — it is the intended way to change a criterion, so it is also the dishonest
   way. Treat any diff to **either** the pin table or the baseline JSON as the first thing to read.
4. **`quotedAssertion` is not verified against the file it quotes.** This is the largest remaining
   hole and it is named here rather than hidden: the citation's *file* must exist, be a real
   non-symlink file, and be long enough for the line — but the quoted assertion itself is free
   text, so a real file plus a real in-range line plus an invented assertion passes.

   Enforcing it is not a small change. The figures below were measured when the index held **three**
   records; the corpus is now 17 records and ~1,000 citations, so treat the ratio as indicative and
   re-measure before acting on it. At that time the three merged records carried **143 citations**, of which
   **123** are `test`/`artifact` — the only kinds that name a file a quote could be checked
   against. Between **10 and 16 of those 123** have backticked fragments appearing verbatim
   (whitespace-normalized) in the cited file: **10** counting only fragments of ≥12 characters and
   requiring all of them to match, **16** counting fragments of any length. (An earlier draft of
   this file said "8 of 143". That was wrong in both numerator and denominator; a reviewer
   measuring independently got 3, 13 or 16 across its own strictness settings. The methodology is
   spelled out here so the figure can be reproduced instead of trusted.) Either way at most ~13%
   would survive as-is — the rest paraphrase, reformat, or splice several lines. Closing this means
   first settling a machine-checkable `quotedAssertion` format: a protocol change, not a validator
   change.
5. **A `ci-run` citation is now pinned to a run, a commit and a workflow — but not to a log line.**
   What is checked: the run exists, it ran at the commit the citation claims, and it belongs to the
   workflow the `ref` names. What is *not*: the log itself. Nothing reads it, so the
   `quotedAssertion` on a `ci-run` remains free text — a real run, at the real commit, of the right
   workflow, plus an **invented quoted line**, still passes. That channel is inherently human
   territory once a run's logs pass GitHub's retention window and stop being fetchable at all; it is
   named here rather than claimed closed. Narrower residue with the same shape: when the URL carries
   a `/job/<jid>` suffix that job is resolved and checked to belong to the run, but the job and step
   named in the `ref` **prose** (`…, job 91399985018, step "…"`) are not, so a citation can name the
   right run and the wrong job in its text. Choosing a *plausible* wrong run — same workflow, same
   commit, different criterion — is likewise still open, and is a judgement about relevance rather
   than provenance; see limit 6.
6. **A `discharge` can name a real, ticked, correctly-quoted criterion that is simply not relevant.**
   The checks establish that the discharging criterion *exists*, is *closed*, and is *identified
   unambiguously* — not that it actually covers the criterion being discharged. Relevance is a
   judgement about two sentences' meanings, and no hash makes it. `SUPERSEDED-DISCHARGED` is
   therefore the tick that most needs a human to read both criteria side by side.
7. **The annotation body can still weaken a criterion, and this one is worth reading twice.** The
   pinned wording is frozen against the baseline, but the `— **…**` annotation appended after it is
   prose, and it renders on github.com immediately beside the criterion, in bold. A reviewer
   demonstrated `— **Evidence (2026-08-02), WAIVED for all cases except empty dir; the suite is
   advisory only:** …` passing green. After the shape rules above it **still passes**, and there is
   a test asserting so, deliberately, rather than a claim here that it does not.

   The reason is worth stating, because it is not laziness: **every honest form already in the
   corpus exercises each syntactic position the waiver uses.** `UNMET (2026-08-02), channel absent:`
   puts free text after the date and before the colon — exactly where the waiver sits.
   `Evidence (2026-08-02, and see the lease note above — this became true only at 70d7da7):` puts a
   substantive qualification inside the label's own parentheses. `Left unticked 2026-08-01, defect
   filed:` uses no parentheses at all. So no rule on the head's *shape* separates the waiver from a
   real annotation, and every rule that would have — a strict `<Label> (<date>):`, or pinning the
   date to `pass.date` — fails 7 and 14 honest criteria respectively. Closing this needs the
   annotation to become *derived from the record* rather than free prose, which is a protocol and
   `schemaVersion` change, not a validator change.

   Until then: **a weakening clause in an annotation is visible in exactly one place, the roadmap
   diff, and it is bold text sitting next to the criterion it weakens.** It is one of the easier
   things for a human to catch and one of the impossible things for this validator to.

   Note the division of labour, because it matters for anyone running the check locally: the
   **offline** validator still passes a forged closeout whose fabricated citations merely *look*
   well-formed. Re-running the reviewer's forged `phase-13.json` against this repository confirms
   it — `npm run check:criteria-closeout` reports PASS, and `npm run check:citation-runs` reports
   all seven citations fabricated. Only the second one resolves runs, and it is meaningful only
   where a token exists. **A green local `check:criteria-closeout` is not evidence that a record's
   CI citations are real.**

Limits 1, 2, 3, 6 and 7 surface in exactly one place: the **roadmap diff**, read by a human. That is
the boundary of what this kind of check can do, and it is why the wording protocol and per-phase
review exist. Read the roadmap diff on every closeout PR. Do not let a green `meta-checks` stand in
for it. **Limit 7 is the one to read first** — it is bold text sitting beside the criterion it
weakens, and it is the successor of two bypasses that were closed by narrowing the syntax around it.

Limits 4 and 5 do not surface there at all, and it is worth being exact about what is left after the
provenance fix, because it is a smaller and stranger residue than before. A `ci-run` citation is now
pinned to a run that exists, at the commit it claims, of the workflow it names; a `test`/`artifact`
citation is pinned to a real non-symlink file at a line that exists, by a path that cannot mean two
things. **What is left in both is the quoted text itself.** Nothing reads a workflow log and nothing
reads the cited file's line, so an otherwise perfectly-pinned citation can carry a
`quotedAssertion` that was never written anywhere. For a `test`/`artifact` that is checkable in
principle and blocked only on settling a format (limit 4). For a `ci-run` it is checkable only while
the run's logs are still fetchable, and GitHub deletes them; past retention it is **permanently**
human territory. **The single highest-value thing a reviewer can do on a closeout PR is open one
cited file, or one cited job, and check that the quoted line is really there.** No amount of further
validator work replaces that.

**Not checked, on purpose:** `pass.headSha` is validated as a 40-hex string but never resolved to a
real commit. Doing so needs `git` history. `meta-checks` now checks out with `fetch-depth: 0` —
the baseline re-derivation requires it — but the validator *also* runs inside the unit suite's own
self-test, in a job that checks out shallow, where most object IDs are simply absent. The check
would therefore fail there on honest records while catching nothing. The `headSha` is provenance
for a reader, not a gate.

## Rules for the agent writing a record

- **Never tick from confidence, and never from "the suite is green."** Open the test, confirm its
  assertions assert *this* criterion's claim, and quote the load-bearing lines with `file:line` into
  `quotedAssertion`. A suite-name match is not evidence.
- **Cite anti-vacuity controls too.** If a negative control (the case that would fail if the
  implementation were degenerate) exists, quote it — that is what makes the positive assertion mean
  something.
- **Durability.** Workflow *artifacts* expire; run *metadata* persists. Quote the load-bearing log
  or artifact content into `quotedAssertion` so the citation outlives retention.
- **Line numbers drift; quoted text does not.** `main` moves under you. The pilot rebased once and
  five of its `file:line` citations had slid — the validator caught none of them, because the files
  still existed. So the `quotedAssertion` *text* is the real citation and the `:line` is a
  convenience. **Re-resolve every line citation against the tree you are actually merging into,
  immediately before you push**, and re-capture any transcript whose suites changed. If a rebase
  brings in upstream work that touches your phase's package, re-read the changed tests — it may have
  strengthened or invalidated what you cited. The validator now rejects a line *past the end of the
  file*, which catches the crudest form of this — but a ref that slid from line 41 to line 12 still
  resolves, and only re-reading the file catches that.
- **Never touch `criteria-baseline.json`.** If your record fails against it, the phase file's
  wording has moved since the baseline was frozen, and the right response is to find out why — not
  to regenerate. Regenerating to make your own record pass is the exact laundering this file exists
  to prevent.
- **A criterion you cannot honestly close stays unticked** and gets a defect record. An honest
  partial close is a successful outcome.
- **Never weaken a criterion's wording to make it tickable** — and that includes the annotation.
  Corrections go through the wording protocol: original text preserved verbatim in the phase file,
  dated annotation appended, before/after recorded here. A correction that loses a guarantee is
  `UNMET`, not a wording fix. The annotation is for *evidence*, never for scope: a clause like
  "except…", "advisory only" or "waived for…" belongs in a defect record, and putting it in the
  bold head is the one weakening this validator cannot see (limit 7).
- **Write every criterion with a `-` bullet, and every path as the plain path.** `* [x]` renders as
  a criterion and parses as nothing; `./`, `..`, a leading `/` and a backslash in a ref are all
  refused. Both were live bypasses.
- **Never fix a defect in the same pass.** Filing it is the deliverable; the fix is separate work
  with its own TDD trail.
