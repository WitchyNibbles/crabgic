# 18 — per-issue write order is not preserved: same-issue writes of different kinds run concurrently

**Phase:** 18 — Jira Cloud adapter + intake/milestone synchronization
(`roadmap/18-jira-cloud-adapter.md`, exit criterion 10)

**Criterion (verbatim):**

> Rate-limit fixture: `Retry-After` honored; per-issue write order preserved.

**Found:** 2026-08-02, criteria-closeout pass, batch 4 (phase 18), at `main` @
`d60398f6b1d3aca2f2efbb8adfbac081d6c16904`.

**Severity:** blocking-guarantee, for the second clause only. The first clause (`Retry-After`)
is fully evidenced and would be ticked on its own. The second is not merely unevidenced — it is
measurably false for writes this connector actually builds.

## Gap

### What the criterion asks for

Two clauses. The second is grounded by §In scope:

> **Rate limits:** quota/burst/per-issue write compliance, `Retry-After` honored, cross-worker
> throttling via 16's gateway-side serialization.

and by §Interfaces consumed, which names the mechanism: 16's "per-tenant+resource write
serialization".

### What exists — clause 1, closed

`packages/connectors-jira/src/testkit/rate-limit-and-write-order.test.ts:22-57` scripts a 429
carrying `retry-after: 2` (`:30`), calls `await client.projects.list();` (`:52`) through the
**real** `JiraResourceClient`, and asserts `expect(sleepCalls).toEqual([2000]);` and
`expect(attempt).toBe(2);` (`:54-55`). Exactly one sleep, of exactly the header's duration, then
a successful retry. Nothing to add.

### What exists — clause 2, and what it actually proves

The same file's `:60-106` and `:108-146` are the write-order cases. Neither constructs a
`JiraResourceClient`, a `RemoteMutationPlan`, or an `executeMutationPlan` call. They call
`httpClient.request({ … resource: "issue:PROJ-1", … })` directly, with the `resource` key written
as a string literal by the test (`:87`, `:95`). What they establish is that 16's
`GatewayHttpClient` serializes two requests that share a resource key and does not serialize two
that do not — which is phase 16's guarantee, already closed there. They say nothing about which
key this connector passes.

The file's own doc comment claims otherwise (`:14-18`):

> these tests prove THIS connector's own wiring (the `resource`/`isWrite` values its resource
> clients pass to `httpClient.request`) actually engages that stack's Retry-After honoring and
> per-tenant+resource write serialization, rather than accidentally bypassing it.

That is true of the `Retry-After` case and false of the two write-order cases.

### What is missing — and what measuring it showed

Asking the question the tests do not ask produced a negative answer. The serialization key is
`RemoteMutationPlan.canonicalTarget` — `packages/gateway/src/mutation-pipeline/mutation-pipeline.ts:213-217`:

```
    response = await deps.httpClient.request({
      …
      resource: plan.canonicalTarget,
      isWrite: true,
```

and this connector deliberately mints a **different** canonical target per resource kind on the
same issue — `packages/connectors-jira/src/resource-client/canonical-target.ts`:

```
export function issueTarget(issueKey: string): string {
  return `issue:${issueKey}`;
}
…
export function commentTarget(issueKey: string, commentId?: string): string {
  return commentId !== undefined
    ? `issue:${issueKey}:comment:${commentId}`
    : `issue:${issueKey}:comment`;
}
```

with the same pattern for `worklogTarget` and `attachmentTarget`. Two writes to the same issue of
different kinds therefore take different mutex keys and do not serialize.

Measured, not inferred. A probe built two plans with the real resource client and applied both
concurrently through the real `executeMutationPlan`; its verbatim transcript, including the
probe's own source, is committed as
`docs/evidence/phase-18/closeout-c10-write-order-probe.txt`:

```
PROBE canonicalTarget issue.update  = issue:PROJ-1
PROBE canonicalTarget comment.create = issue:PROJ-1:comment
PROBE maxInFlight = 2
PROBE events = ["start:PUT:/rest/api/3/issue/PROJ-1","start:POST:/rest/api/3/issue/PROJ-1/comment","end:PUT:/rest/api/3/issue/PROJ-1","end:POST:/rest/api/3/issue/PROJ-1/comment"]
PROBE control maxInFlight = 1
```

Both requests are in flight simultaneously and both starts precede either end. The control — two
`issue.update` plans on the same issue, hence an identical canonical target — serializes
correctly (`maxInFlight = 1`), which is what rules out "the probe simply does not serialize
anything".

The probe is deliberately RED (`expect(maxInFlight).toBe(1)`) and was **not** committed to
`packages/`: a closeout pass files findings, it does not add production tests. Its source is
reproduced verbatim in the transcript so anyone can re-run it.

### Honest statement of impact

This is not a correctness bug in exactly-once, which is keyed on `plan.idempotencyKey` and is
unaffected (criterion 3). The practical consequences are narrower but real: (a) Jira enforces
per-issue write rate limits, and concurrent writes to one issue are exactly what those limits
target, so this raises the 429 rate the connector generates against a busy issue; (b) a milestone
comment and a field update issued together have no defined arrival order. Whether per-kind
concurrency is _desirable_ is a design question worth asking — but the box as written asserts it
does not happen, and it does.

### Search trail

1. Read `rate-limit-and-write-order.test.ts` in full; confirmed cases 2 and 3 construct no
   resource client (no `createJiraResourceClient` import is used in them).
2. `git grep -n "resource:\|isWrite" -- packages/gateway/src/mutation-pipeline/mutation-pipeline.ts`
   → the single `httpClient.request` call site at `:213`, keyed on `plan.canonicalTarget`.
3. Read `canonical-target.ts` in full — five helpers, four distinct key shapes per issue.
4. Wrote and ran the probe above; captured the transcript with its command line, HEAD sha and
   exit status.
5. `git grep -n canonicalTarget -- packages/connectors-jira/src` to confirm the plan builders use
   these helpers rather than a flat issue key: `issue-plans.ts:94`/`:141` use `issueTarget`,
   `comment-worklog-attachment-plans.ts` uses `commentTarget`/`worklogTarget`/`attachmentTarget`.

## Proposed remedy

1. **Decide the intended granularity, and write it down.** Either per-issue writes are meant to
   serialize (in which case the canonical target used for serialization must be the issue, not
   the sub-resource) or they are not (in which case the criterion is wrong and needs the wording
   protocol in its own reviewed roadmap commit). This is a design call, not a test fix, and it
   should be made jointly with phase 16, which owns the serialization key.
2. **If serialization is intended** — the smallest honest change is to give
   `RemoteMutationPlan` a serialization key distinct from its identity key, or to have this
   connector's sub-resource targets share the issue's key for serialization purposes. Do not
   simply collapse `canonicalTarget`: it is also the marker-reconciliation and audit identifier,
   and `jira-mutation-apply-client.ts` parses it back into an issue key and a comment id
   (`:199`, `const [, issueKey, , commentId] = plan.canonicalTarget.split(":");`).
3. **Either way, replace the two write-order tests with connector-level ones.** The probe in
   `docs/evidence/phase-18/closeout-c10-write-order-probe.txt` is directly reusable: it already
   builds real plans, applies them through the real pipeline, and instruments the transport. Keep
   its control case, which is what distinguishes "the key is wrong" from "nothing serializes".

**Effort sizing: M** for remedy 3 alone (~80 lines, one existing test file, no production
change). **L** if remedy 2 is adopted, because it touches a P02 contract field's meaning and
therefore phases 16, 18, 19 and 20 together. No CI job, no live engine. Owner or reconciler input
is needed for step 1.

**Ticket-ready:** yes for step 1 as a decision ticket, with step 3 as its follow-on.

## Remedied by PR #84, 2026-08-04 — for single-issue writes

Step 1 of the proposed remedy was decided in favour of serialization, unqualified across kinds: field
update, comment, worklog and attachment on one issue take one mutex, matching the criterion's wording
and §In scope's "per-issue write compliance".

Step 2 was taken in its "distinct serialization key" form. `canonicalTarget` is **not** collapsed — it
is parsed as identity downstream in both Jira clients and remains the identity/audit key. Instead an
optional `serializationTarget` hook on `MutationApplyClient`/`MutationPipelineHandlers` defaults to
`canonicalTarget` and is consumed at `mutation-pipeline.ts`'s single `httpClient.request` call site.
No P02 contract change was needed; Grafana omits the hook and is byte-identical, now pinned by its own
assertion (a reverse probe adds the hook and watches that assertion fail).

Step 3 is done: `write-order.integration.test.ts` keeps the original probe's control case and adds a
Data Center arm — DC shared the defect, reusing the same plan builders and the same
`canonical-target.ts`, and previously had no write-order coverage at all.

The effort estimate of **L** for step 2 proved wrong. The optional-hook form touched no contract, so
phases 16/18/19/20 did not need coordinating and phase 20 needed no change at all.

### Residual, deliberately not closed — why this criterion stays unticked

`bulk:<keys>` targets (`issue.bulkUpdate` / `issue.bulkTransition`, `issue-plans.ts:189` and `:210`)
name **multiple existing issues** in one target string. A mutex key is a single string, so no single
key can mean "PROJ-1 and PROJ-2 at once", and folding a bulk plan onto any one member would be wrong.
They therefore pass through unserialized against their own member issues:

- a `bulk:` write touching PROJ-1 still races a single-issue write to PROJ-1;
- two `bulk:` plans whose key lists overlap still race each other;
- and because both builders mint `` `bulk:${issueKeys.join(",")}` `` with no sort, two plans over the
  **same key set in different order** mint different strings and fail to serialize.

Closing this needs multi-key lock acquisition in phase 16's `WriteSerializer` — a design change, out
of scope for this fix. The residual is **asserted** in `canonical-target.test.ts` rather than only
described, so it cannot change silently.

An earlier draft of this fix justified the `bulk:` passthrough on the grounds that it "names no
existing issue". That was false — the target literally contains the issue keys — and is corrected
here rather than rewritten away. The behaviour was right; the stated reason was not.
