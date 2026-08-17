# 25 — the review round answers obligations in a form the server cannot count, so no stage can close

**Phase:** 25 — owner-pipeline conformance. Surface: `packages/plugin/workflows/stage-round.mjs`
and `packages/plugin/workflows/stage-loop.mjs`.

**Found:** 2026-08-17, driving owner ruling **R7**'s staged run, on the first round whose
verdicts actually reached the server.

**Severity: blocking.** Every stage that closes on review is unclosable through the
shipped loop, no matter how many rounds run or how clean the artifact is.

**Effort: S.** A schema member, a prompt paragraph, and a field mapping.

## What happened

Three real reviewers reviewed a real artifact and all three reported every obligation
answered. The server refused closure:

```
lensesSubmitted: 3
stageClosable: false
closureReason: "an obligation went unanswered: research-questions-answered,
                research-no-silent-assumptions, research-prior-art-checked"
```

Those are the three obligations the reviewers had just answered. The server was right and
the loop was wrong.

## Root cause

`review-submit-handler.ts:677` derives `obligationsAnswered` from `metCriteria`, and
`metCriteria` is itself filtered to the criteria that carry an ATTESTATION — the tool's own
descriptor says so: "a bare string in `metCriteria` does not count and is reported back in
`unattestedCriteria`". An attestation is a `CriterionAttestation`: `criterion`, `asserter`,
`rationale`, `artifactAnchor`, `assertedAt`, `round`.

`stage-round.mjs`'s `VERDICT_SCHEMA` asked reviewers for `answeredObligations` and nothing
else. No reviewer was ever asked for an attestation, so none existed, so nothing could be
counted as met, so no stage could close.

⚠️ **The two halves were individually correct.** The server is right to require an
attestation — that rule exists so "nobody reported anything" cannot read as "nothing is
wrong". The reviewers were right to report what they answered. What was missing was the
shape that carries one to the other.

## Why nothing caught it

The loop had **no test at all** before 2026-08-17 (defect
`25-stage-loop-cannot-dispatch-a-round.md`), and `stage-round-workflow.test.ts` asserts the
script's own structure — it cannot know what the server counts. The handler's suite passes
attestations explicitly, so it never exercises a submission without them.

This is the third defect in one chain, and all three shared a property: each surface's own
tests passed, and the composition had never been run. The same shape as
`14-gate-registry-never-composed.md`.

## Remedy

- `stage-round.mjs`: `attestations` becomes a REQUIRED member of the verdict schema, and
  the reviewer prompt asks for one per obligation found met — with an explicit instruction
  NOT to attest an obligation found unmet, so an attestation cannot become a way to wave a
  finding through.
- `stage-loop.mjs`: the submit step maps `answeredObligations` -> `metCriteria` and passes
  `attestations` through, stamping `assertedAt` and `round`, which only the loop knows.

**Ticket-ready:** yes.

## Not claimed

- **Not claimed** that the server's attestation rule is wrong. It is the control that stops
  a silent lens reading as a satisfied one, and it stays exactly as it is.
- **Not claimed** that any stage had previously closed incorrectly. No stage had ever
  closed through this loop at all — this was the first round whose verdicts reached the
  server.
