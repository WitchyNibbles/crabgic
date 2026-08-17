# 25 — `review.submit` demands a design and a plan for every stage, including the stages that have neither

**Phase:** 25 — owner-pipeline conformance. Surface: `packages/cli/src/gateway-mcp/build-tool-registry.ts`.

**Found:** 2026-08-17, driving owner ruling **R7**'s full staged run, at the moment three
real reviewer verdicts for the `research` stage were ready to be recorded.

**Severity: blocking.** No verdict can be recorded for any stage that has no design
record and no plan record — which is `research`, and every other pre-design stage. The
staged review pipeline's write surface is unreachable for the stage the pipeline starts
with.

**Effort: S.** Two `.optional()` calls, plus a rebuild of the shipped `dist`.

## Two schemas for one tool, and they disagree

| declaration                                                                                     | says                                            |
| ----------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| `packages/cli/src/review/tool-definitions.ts:115` — the tool's PUBLISHED descriptor             | `required: ["stage", "changeSetId", "verdict"]` |
| `packages/cli/src/gateway-mcp/build-tool-registry.ts` — the zod shape the SDK validates against | `design: z.unknown()`, `plan: z.unknown()`      |

Under zod 4, `z.unknown()` is **not** optional. Reproduced directly:

```
$ node -e '…z.object({ design: z.unknown() }).safeParse({})…'
zod 4.4.3
omitting z.unknown() parses? false
[{"code":"invalid_type","expected":"nonoptional","path":["design"],
  "message":"Invalid input: expected nonoptional, received undefined"}]
```

So the MCP SDK derives `design` and `plan` as REQUIRED and rejects any call that omits
them — while the descriptor the caller reads says they are optional. A caller that obeys
the published contract exactly is refused.

⚠️ **This is the same defect class as the one `WorkerAuthoredResultSchema`'s docblock
records**, one surface over: "the daemon published a hand-written two-property JSON
Schema … while `validateWorkerResult` enforced the full seven-field `WorkerResultSchema`.
Two schemas that had to agree, and did not: every worker obeyed the published contract
exactly and every result was then rejected as malformed." Found there by a real run, and
found here by a real run.

## Why the obvious workaround is worse than the bug

Passing `design: null` does not help — `build-tool-registry.ts` forwards a member on
`!== undefined`, so the handler runs `DesignRecordSchema.safeParse(null)` and returns
`invalid design record: expected object, received null`.

So the only accepted value is a REAL `DesignRecord`. The research stage does not have
one — it runs four stages before the design exists. And a fabricated one would not merely
pass validation: the handler PERSISTS the supplied design as the design of record, so a
placeholder invented to get past a schema check would become the artifact the `design`
and `plan` stages are later judged against.

**The reviewer agent refused to fabricate one**, and named that consequence as its
reason. That refusal is the correct behaviour and is why this was found as a defect
rather than absorbed as a corrupt design record.

## Why nothing caught it

- The handler's own suite passes `design`/`plan` explicitly, so it never exercises the
  omission the descriptor advertises.
- `first-staged-round-live.md` reports the previous attempt failing earlier, at
  `unknown ChangeSet` — intake had never created the change set, so that round never
  reached input validation. The earlier defect MASKED this one.
- Nothing asserts that the published descriptor's `required` list and the zod shape's
  required set are the same set. That is the assertion this fix adds.

## Remedy

`.optional()` on `design` and `plan`, so the validated shape matches the published
descriptor, and a conformance test that derives both required sets and compares them —
so the two cannot drift apart again without something going red.

**Ticket-ready:** yes.

## Not claimed

- **Not claimed** that the handler's own validation is wrong. `DesignRecordSchema` and
  `PlanRecordSchema` are correct and stay where they are; only the wire-boundary
  optionality is wrong.
- **Not claimed** that any state was corrupted. No verdict was recorded and no
  `review-findings.json` exists under the project's state root — the refusals happened at
  input validation, before the handler ran.
