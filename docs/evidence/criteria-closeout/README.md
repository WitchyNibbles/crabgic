# Criteria-closeout index

One record per roadmap phase — `phase-NN.json` — written by the closeout pass that walks that
phase's exit criteria against its own recorded evidence, ticking only what the evidence actually
proves.

`roadmap/README.md`'s completion ledger is the reason this directory exists: "each checkbox must
map to a CI run, journal entry, or committed artifact." These records apply that rule to the
closeout itself, so a tick's citation is machine-resolvable rather than a claim in prose.

Validated by `scripts/check-criteria-closeout.mjs`
(`npm run check:criteria-closeout`, a step in `ci.yml`'s `meta-checks` job). The validator's own
rejection paths are unit-tested in `scripts/check-criteria-closeout.test.mjs`.

## Layout

| Path | Owner |
|---|---|
| `phase-NN.json` | the agent that closed phase NN |
| `defects/NN-<slug>.md` | same — one file per criterion left unticked |
| `defects/INDEX.md` | the closeout integrator (last batch), not individual phase agents |

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
2. **The wording pin** — `sha256(text)` must match, *and* `text` must account for the **whole**
   checkbox item in the phase file: it must be that item's prefix, and whatever follows must be
   empty or start with `— **` (the citation annotation, `— **Evidence …**`). Both halves are
   load-bearing. A bare prefix match would let a record pin a harmless opening substring and leave
   a softened tail invisible; a bare *em dash* lead would let a record stop at the criterion's
   **own** internal em dash, against an unmodified checkbox, so the evidence-channel clause after
   it (`— suite \`install.matrix.test\``) escaped the hash — 95 of the roadmap's 211 criteria
   contain an internal em dash, and zero contain `— **`. A criterion reworded to make it tickable
   fails here.
3. **Two-way agreement with the roadmap** — checkbox count equals criteria count, and each box's
   `[x]`/`[ ]` state equals its record's `ticked`. Within a phase that has a record, a box ticked
   without a matching entry fails, and so does a record claiming a tick the file does not have.
   A phase file that *cites* `phase-NN.json` without that file existing is also reported, so
   ticking boxes and forgetting the JSON is not invisible. (Phase 23 predates this pass and
   legitimately has ticks and no record, which is why the check keys on the citation rather than
   on "has ticked boxes".)
4. **Tick discipline** — `ticked` is derived from the classification; every tick carries ≥1 citation;
   every `UNMET` names a defect record that exists on disk; every `WORDING-MISMATCH` carries its
   before/after.
5. **Citations resolve** — `test` and `artifact` refs are repository paths (an optional
   `:line` or `:line-line` suffix is stripped) and must resolve to a **regular file inside the
   repository root** — a directory ref, an absolute path, or a `..` escape all fail. This pass's
   own phase-12 defect exists *because* a cited test file was deleted in a refactor and nothing noticed;
   shipping the index with that same hole would defeat its purpose. `ci-run`, `discharge` and
   `journal-export` name a run, another phase's criterion, or an exported entry — not local
   files — so they are left unresolved.

## What the validator cannot catch

It is a snapshot validator: it checks a record against the roadmap **as both stand in the same
commit**. So it will never catch a dishonest edit that rewrites a criterion *and* its record
together in one PR — the two agree, every hash is self-consistent, and the check is silent. The
only place that shows up is the **roadmap diff**, read by a human.

That is not a gap to be closed by more validation; it is the boundary of what this kind of check can
do, and it is exactly why the wording protocol (original text preserved verbatim, dated annotation,
before/after recorded) and per-phase review exist. Read the roadmap diff on every closeout PR. Do
not let a green `meta-checks` stand in for that.

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
  strengthened or invalidated what you cited.
- **A criterion you cannot honestly close stays unticked** and gets a defect record. An honest
  partial close is a successful outcome.
- **Never weaken a criterion's wording to make it tickable.** Corrections go through the wording
  protocol: original text preserved verbatim in the phase file, dated annotation appended, before/
  after recorded here. A correction that loses a guarantee is `UNMET`, not a wording fix.
- **Never fix a defect in the same pass.** Filing it is the deliverable; the fix is separate work
  with its own TDD trail.
