# 25 — `review.submit`'s structured members are untyped on the wire, so clients send them as text

**Phase:** 25. Surface: `packages/cli/src/gateway-mcp/build-tool-registry.ts`.

**Found:** 2026-08-17/18, owner ruling **R7**'s staged run — reported INDEPENDENTLY by two
different submitting agents in two different loop invocations.

**Severity: blocking.** Every caller that uses the MCP tool as published is refused. Both
agents that met it abandoned the tool and hand-built JSON-RPC frames against
`crabgic gateway mcp` instead. **A tool every caller must bypass is not a tool.**

**Effort: XS.** Four member declarations.

## What happens

```
review.submit -> {"ok":false,"error":"invalid review verdict: expected object,
                  received string"}
```

Verbatim, from two separate runs:

> the MCP tool declares `verdict` as `z.unknown()` so the client serialized it as a string
> and the server refused it ("expected object, received string"); submitted instead over
> stdio JSON-RPC to `crabgic gateway mcp` …

> calling the tool from this session passes `verdict` as a JSON STRING (untyped `{}` schema
> member), yielding "invalid review verdict: expected object, received string" — verified
> against the same server over raw JSON-RPC, where an object is accepted.

## Root cause

`z.unknown()` emits `{}` as its JSON Schema — a member with **no `type`**. Reproduced:

```
$ node -e "…z.toJSONSchema(z.object({v: z.unknown()}), {io:'input'})…"
unknown -> {}
object  -> {"type":"object","properties":{},"additionalProperties":{}}
```

A client reading the published schema has no signal that the member must be an object, so
a harness that renders untyped arguments as text sends a string, and the handler correctly
refuses it. The refusal is right; the advertisement was wrong.

⚠️ **This is the same root as `25-review-submit-requires-a-design-it-cannot-have.md`, and
was NOT fixed by it.** That defect fixed the OPTIONALITY of `design`/`plan`; this is the
TYPE of the same members plus `verdict` and `attestations`. The earlier record even names
the remedy — "(and give `verdict` a typed object schema)" — and the fix stopped at the half
that was blocking at that moment. Recorded plainly because a partial fix that reads as a
whole one is how a defect returns.

## Remedy

`z.looseObject({})` for `verdict`, `design`, `plan`, and for the items of `attestations`.
That declares `type: "object"` on the wire and constrains nothing else, so the
one-schema-per-document rule the original comment defends is kept intact: content stays
validated by `ReviewVerdictSchema` / `DesignRecordSchema` / `PlanRecordSchema` /
`CriterionAttestationSchema` inside the handler, where a rejection carries its reason.

`./review-submit-shape.test.ts` now asserts the EMITTED JSON Schema types, not just the
required set — verified to report `UNTYPED` for all three against the pre-fix shape.

**Ticket-ready:** yes.

## Not claimed

- **Not claimed** that the handler's refusal was wrong. It was right every time.
- **Not claimed** that the agents' workaround was wrong. Hand-building the JSON-RPC frame
  against the same server, copying the envelope `live-round-submit.ts:88-100` builds, and
  passing reviewer content through verbatim, is a correct workaround — and both agents said
  so explicitly rather than quietly editing a verdict to make it fit.

## Remediated 2026-08-17 — PR #148

`verdict`, `design`, `plan` and the `attestations` items are declared `z.looseObject({})`
in `packages/cli/src/gateway-mcp/build-tool-registry.ts`, so each emits `"type": "object"`
in the JSON Schema a client reads instead of a bare `{}`.

**Pinned by** `packages/cli/src/gateway-mcp/review-submit-shape.test.ts`,
`it("advertises every structured member as type object, never as an untyped {}")` — it
calls `z.toJSONSchema` on the real shape and asserts the emitted type per member, plus the
array/items split for `attestations`. Asserting the emitted schema rather than the zod
declaration is deliberate: the wire is what the two agents that hit this were reading.

⚠️ **This is the SAME declaration as `25-review-submit-requires-a-design-it-cannot-have.md`,
two PRs earlier.** That fix corrected optionality and stopped there, although the record's
own remedy section named the wire shape. The lesson is the one the record carries: a fix
that addresses half of a shared root leaves the other half looking untouched rather than
looking open.
