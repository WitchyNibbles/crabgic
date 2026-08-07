# 23 — `releaseGateSummary.test.ts` asserts a release-candidate moment as a repository invariant

**Phase:** 23 — Release hardening (`roadmap/23-release-hardening.md`). No exit criterion: the
production code is correct and every criterion it bears is unaffected. The defect is in the test.

**Found:** 2026-08-07, post-v1.6.0 review, at `5b10f1e257a5ae835fb5edbba1cf3b8e87ca6744`
(`origin/main`). crabgic@1.6.0 was published earlier the same day.

**Severity:** low, and **self-correcting** — the arm goes green again at the next version bump
without anyone touching it. That is also the reason it is worth filing: a test that reds on the day
of a release and un-reds at the next one, in a project no per-push channel runs, can be red for a
whole release cycle with nothing to say so.

**Effort: S.** Sized in full below. **Deliberately not implemented in this pass** —
`docs/evidence/criteria-closeout/README.md` hard rule: "Never fix a defect in the same pass."

## The red, reproduced at HEAD with nothing mutated

```
$ cd e2e/release && npx vitest run src/releaseGateSummary.test.ts
 FAIL  src/releaseGateSummary.test.ts > runAndEmitReleaseGateSummaryEvidence — genuine
   integration (real git/npm, this repo's own HEAD, NEVER a real publish/tag/marketplace
   mutation) > runs every real constituent check, reports today's real overall verdict,
   and journals matching evidence
 AssertionError: expected true to be false // Object.is equality
  ❯ src/releaseGateSummary.test.ts:334:44

 Test Files  1 failed (1)
       Tests  1 failed | 16 passed (17)
```

## The production check is right, and this record proposes no change to it

`e2e/release/src/releaseGateSummary.ts:225` passes `expectation: … ?? "publishable"`, and
`e2e/release/src/publicationCheck.ts:214` branches on it:

```ts
} else if (expectation === "publishable" && published) {
```

emitting _"the npm registry already serves crabgic@1.6.0 …; npm refuses to republish an existing
version, so this candidate cannot be cut — the tag or the version bump is stale."_ That is exactly
right: a pre-publish gate handed an already-served version is looking at a candidate that genuinely
cannot be cut, and the only fixes are a version bump or a re-cut tag. The comment above it
(`publicationCheck.ts:215`) already states the design.

**What is wrong is the assertion.** The test pins "the version about to be cut is not yet on the
registry" as though it held at every commit — while **nine lines below** (`:336` to `:345`), the same
test reasons the other way about a structurally identical clause:

> `releaseGateSummary.test.ts:345` — "asserted here: this harness runs against whatever HEAD happens
> to be, and HEAD moves with every commit after a cut while the tag stays put. Pinning
> `tag === HEAD` would make an ordinary commit fail the suite."

The publication clause has the identical shape and did not get the identical treatment.

## How many assertions actually break — six, measured, not read

Serial neutralisation: comment out the assertion the run stopped on, re-run, record where it stops
next. The count is what the fix has to cover, and guessing it was the point of measuring.

| step | assertion neutralised                                       | next failure                                  |
| ---- | ----------------------------------------------------------- | --------------------------------------------- |
| 0    | —                                                           | `:334` `published).toBe(false)`               |
| 1    | `:334`                                                      | `:335` `reasons).toEqual([])`                 |
| 2    | `:335`                                                      | `:336` `joined).not.toContain(…)`             |
| 3    | `:336`                                                      | `:382` `published).toBe(false)` (second case) |
| 4    | `:382`, `:383`                                              | `:423` — the `EXPECTED_REASON_PATTERNS` sweep |
| 5    | added `/npm registry already serves/` to the list at `:413` | **17 passed (17)**                            |

Step 4 is the one a reader would not predict. `EXPECTED_REASON_PATTERNS` at
`releaseGateSummary.test.ts:413` is the harness's allowlist of reasons it tolerates on an ordinary
commit; its npm entry is `/npm registry reports/`, the phrasing of the **never-published** direction
only. The already-served direction has no entry, so every reason-category assertion rejects it as
unexpected. A fix that changes only the assertion the failure message names leaves five more reds
behind it, each surfacing only after the one before is cleared.

## Why nothing said so

`e2e/release` is not a `vitest.config.ts` project, so `npm test` never runs it, and
`npm run test:e2e` appears in no workflow. Its only CI channel is `test:e2e:release-evidence` at
`.github/workflows/release-e2e.yml:389` — dispatch, or a `v*` tag. That channel is the subject of the
sibling record `23-release-evidence-lanes-run-in-no-per-push-channel.md`, filed alongside this one.

## Proposed remedy

Assert the **conditional** that is actually invariant, in the shape the tag clause nine lines below
already uses:

- if the release version is **absent** from `publishedVersions`:
  `publication.published === false` and `publication.reasons === []`;
- if it is **present**: `publication.published === true`, and `reasons` is exactly one entry that
  matches `/already serves/` **and** names the version being scored — so the arm cannot be satisfied
  by some unrelated publication reason;
- add `/npm registry already serves/` to `EXPECTED_REASON_PATTERNS`;
- move the `joined).not.toContain("package published")` assertion inside the absent-arm, where it is
  the meaningful statement.

Both arms stay reachable — the present-arm is what runs today, the absent-arm runs from the next
version bump — so neither is dead code. Apply the same treatment to the second case's `:382`/`:383`
pair.

**Effort: S.** One test file, no production change, no new fixture, no CI change.

**Ticket-ready:** yes.

## Not claimed

- **Not claimed:** that the release gate is broken. It is reporting a true fact. The composed verdict
  on this commit is a genuine FAIL for four independent reasons, three of which the test already
  tolerates by design (the rebuild leg, the tag pointing at the cut commit, the marketplace pin).
- **Not claimed:** that this red blocked anything. It ran in no channel, so it blocked nothing — and
  that is the finding, not a mitigation.
- **Not claimed:** that the second case at `:382` is a separate defect. It is the same assertion in a
  second `it`, and the remedy covers both.

**Evidence:** `docs/evidence/phase-23/release-gate-summary-post-publish-probe.txt`.
