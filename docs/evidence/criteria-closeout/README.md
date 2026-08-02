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
re-derives from git history in the same job. The validator's own rejection paths — 99 cases, almost
all rejections — are unit-tested in `scripts/check-criteria-closeout.test.mjs`; the baseline generator
and the run resolver add 21 more, for 120 across the three suites.

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
      "defectRef": "docs/evidence/criteria-closeout/defects/12-….md" // UNMET only
    }
  ]
}
```

Unknown keys are rejected at every level. `url`, `commit` and `quotedAssertion` are optional on a
citation; everything else shown is required.

## Defect record shape (`defects/NN-<slug>.md`)

Checked, not merely required to exist — a reviewer truncated a real one to zero bytes and the old
validator stayed green. A defect record must carry:

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
| `EVIDENCE-NEEDS-CI` | no | The wording demands a CI run of a job with no green record. Costs CI minutes, not the owner's subscription |
| `EVIDENCE-NEEDS-LIVE` | no | Needs the real engine / owner subscription (`@live`, `engine-live`). Owner-gated batch only |
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
4. **Two-way agreement with the roadmap** — checkbox count equals criteria count, and each box's
   `[x]`/`[ ]` state equals its record's `ticked`. Within a phase that has a record, a box ticked
   without a matching entry fails, and so does a record claiming a tick the file does not have.
   A phase file that *cites* `phase-NN.json` without that file existing is reported, so ticking
   boxes and forgetting the JSON is not invisible — **and so is a phase file with ticked criteria
   and no record at all.** That last one was the cheapest attack on this whole directory: every
   other check is anchored on a record existing, so ticking all seven of `roadmap/13`'s boxes and
   writing nothing passed. Phase **23** is the single grandfathered exemption (closed and evidenced
   against `release-e2e` run 30250453824 before this index existed); the list is closed.
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
   and proposing a remedy with S/M/L sizing.
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
   record** (`phase-NN.json`) fails too: a record is the claim, never the evidence for itself.
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
     repository's `actions/runs/` (or `actions/jobs/`) space, plus a `quotedAssertion` — logs
     expire, the quote is the durable part. Making the run actually **exist** is
     `npm run check:citation-runs`, a separate `meta-checks` step that resolves each URL against
     the GitHub API. Its failure semantics are deliberately asymmetric: a **404 fails the build**
     (the run is not there), while "could not ask" — no token, rate limit, 5xx, DNS — warns and
     passes, so an API blip cannot red an honest PR. That asymmetry cannot be turned into a bypass,
     because an attacker cannot make the API return 404-shaped success. It deliberately does
     **not** require `conclusion: success`: a record may legitimately cite a **red** run as evidence
     that a gate really bites, and phase 01's closeout does exactly that.

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

   Enforcing it is not a small change. The three merged records carry **143 citations**, of which
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
5. **A `ci-run` citation can name a real run that has nothing to do with the criterion.** Run
   resolution proves the run exists; it does not read the log, so it cannot tell whether the quoted
   line is really in it, or whether that job exercised this criterion's suite. This is the residue
   of the forged-closeout hole rather than its closure.
6. **A `discharge` can name a real, ticked, correctly-quoted criterion that is simply not relevant.**
   The checks establish that the discharging criterion *exists*, is *closed*, and is *identified
   unambiguously* — not that it actually covers the criterion being discharged. Relevance is a
   judgement about two sentences' meanings, and no hash makes it. `SUPERSEDED-DISCHARGED` is
   therefore the tick that most needs a human to read both criteria side by side.

   Note the division of labour, because it matters for anyone running the check locally: the
   **offline** validator still passes a forged closeout whose fabricated citations merely *look*
   well-formed. Re-running the reviewer's forged `phase-13.json` against this repository confirms
   it — `npm run check:criteria-closeout` reports PASS, and `npm run check:citation-runs` reports
   all seven citations fabricated. Only the second one resolves runs, and it is meaningful only
   where a token exists. **A green local `check:criteria-closeout` is not evidence that a record's
   CI citations are real.**

All of these surface in exactly one place: the **roadmap diff**, read by a human. That is the boundary
of what this kind of check can do, and it is why the wording protocol and per-phase review exist.
Read the roadmap diff on every closeout PR. Do not let a green `meta-checks` stand in for it.

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
- **Never weaken a criterion's wording to make it tickable.** Corrections go through the wording
  protocol: original text preserved verbatim in the phase file, dated annotation appended, before/
  after recorded here. A correction that loses a guarantee is `UNMET`, not a wording fix.
- **Never fix a defect in the same pass.** Filing it is the deliverable; the fix is separate work
  with its own TDD trail.
