# The pipeline driver, run against the real gateway

**2026-08-16.** `pipeline.plan` driven through the production `crabgic gateway mcp`
server over stdio — the same MCP surface a manager session talks to, not a test
harness. **Zero engine spend**: the driver is a pure server-side decision, so
walking the whole pipeline costs nothing.

## What ran

An MCP client initialized against the gateway, listed its tools (26, ending in
`pipeline.plan`), then called `pipeline.plan` repeatedly, feeding each answer's
stage back as `completedStages` until the server said the pipeline was finished.

```
 1. research     ownerGated=false budget=20 lenses(3): completeness,source-quality,assumption-audit
 2. clarify      ownerGated=true  budget=1  lenses(0): -
 3. design       ownerGated=false budget=20 lenses(3): contract-fit,security,operability
 4. design-gate  ownerGated=true  budget=1  lenses(0): -
 5. plan         ownerGated=false budget=20 lenses(2): coverage-of-design,sequencing
 6. implement    ownerGated=false budget=20 lenses(4): correctness,security,compliance,clean-code
 7. integrate    ownerGated=false budget=20 lenses(0): -
 8. audit        ownerGated=false budget=20 lenses(4): testing,target-domain,compliance,clean-code
                                                        | skipped: backend,frontend,infrastructure,product-design
 9. document     ownerGated=false budget=20 lenses(2): completeness,readability
FINISHED after 9 stages
```

## What that establishes, and what it does not

**Established, on the production surface:**

- The pipeline is **sequenced by a program**, not by prose in an always-loaded
  `CLAUDE.md` paragraph. That was the audit's central finding
  (`owner-pipeline-conformance.md` §1: "a per-domain panel driven by a program"),
  and the server now issues the order, the lens roster, the obligation checklist
  and the round budget for every stage, and reports `finished` at the end.
- **The owner's four evaluators exist and are issued together** — `implement`
  returns `correctness`, `security`, `compliance`, `clean-code`. Step 13 asked
  for four; the audit found two.
- **Two stages are owner-gated with a round budget of 1** — `clarify` and
  `design-gate`. A budget of one is the machine-readable form of "no review round
  can close this; a human does". Steps 6 and 7 have a real gate to loop on.
- **The audit stage ran its domain roster and STATED ITS SKIPS.** With no stack
  evidence supplied it applied the four unconditional lenses and named the four
  it skipped. "We audited it" cannot quietly mean four of eight.
- **The `document` stage exists** with `completeness` and `readability` — step 17,
  which the audit recorded as ABSENT.

**Not established, and the gap is the same one as everywhere else:** this is the
DECIDING half. `pipeline.plan` says what a round should contain; `stage-round`
and `stage-loop` are what dispatch the reviewers it names, and dispatching costs
engine spend on the owner's account. So every stage above is now known to be
**issued correctly**; none of them has been **answered** by a real reviewer
through the loop.

A plan nobody runs constrains nothing — that caveat is stated in
`pipeline-driver.ts`'s own docblock and it still holds. What changed today is
that the plan is no longer hypothetical: it is served, over the real channel, in
the real order, with the real rosters.

## Reproducing it

The client is ~40 lines of JSON-RPC over `crabgic gateway mcp`'s stdio. It needs
no credentials, no daemon and no approval, because `pipeline.plan` reads only
`PIPELINE_STAGES`, `DOMAIN_LENSES` and the stage's own exit criteria.
