# 25 — R1's web grant is proven not to reach other AGENTS, and never proven not to reach the WORKER profile

**Criterion (verbatim):**

<!-- prettier-ignore -->
> *(R1)* The research agent holds `WebSearch`/`WebFetch`, `ResearchRecord` carries source
> provenance, and the compiled **worker** profile is unchanged by the grant (profile golden
> test + `docs/threat-model.md` amendment committed).

**Phase:** 25 — owner-pipeline conformance. Surface: `packages/plugin/src/agent-roster.test.ts`,
and the absence of a counterpart over the compiled worker profile.

**Found:** 2026-08-18, assembling phase 25's closeout record. Not raised by any review round:
the two clauses that ARE tested pass, and the third has no test to fail.

**Severity: medium, and it is a containment claim.** Owner ruling R1 granted `WebSearch`
and `WebFetch` to the research agent, manager-side only. `docs/threat-model.md` was amended
on the strength of that boundary. What is asserted nowhere is the half of the boundary that
faces the workers.

**Effort: S.** One golden assertion over the compiled profile.

## The criterion has three clauses; two are covered

roadmap/25's exit criterion reads:

> _(R1)_ The research agent holds `WebSearch`/`WebFetch`, `ResearchRecord` carries source
> provenance, and the compiled **worker** profile is unchanged by the grant (profile golden
> test + `docs/threat-model.md` amendment committed).

| clause                                       | evidence                                                                                                                                                                      |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| the research agent holds both tools          | `packages/plugin/src/agent-roster.test.ts` — `it("gives eo-researcher WebSearch and WebFetch")`, with `it("gives NO other agent either tool")` as its negative arm            |
| `ResearchRecord` carries source provenance   | `packages/contracts/src/contracts/research-record.ts` requires `retrievedAt` on a web citation; `research-record.test.ts` refuses one without it and accepts it once supplied |
| **the compiled worker profile is unchanged** | **none found**                                                                                                                                                                |

## The measurement

| search                                                                                     | result                                                                                                                         |
| ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| `golden` across `packages/plugin/src/*.test.ts` and `packages/cli/src/installer/*.test.ts` | `enabled-plugin-key.test.ts`, `mcp-entry.golden.test.ts` — neither is a profile                                                |
| `CompiledProfile` in any `*.test.ts`                                                       | engine-claude live tests, `final-candidate.e2e`, learning pipeline — none asserts the worker's tool set against a pinned value |
| `WebSearch` / `WebFetch` outside the agent roster                                          | no assertion that the compiled worker profile lacks them                                                                       |

⚠️ **Why "no other agent has it" is not the same claim.** `agent-roster.test.ts` reads the
shipped `.md` agent files. The worker profile is COMPILED — it is assembled from the
envelope and the standing policy at dispatch time, by different code, from different inputs.
A grant that leaked into it would leave every agent-roster assertion green. This is the same
distinction the `14-gate-registry-never-composed` shape is about: a roster that is right and
a composition that was never checked.

## Remedy

A golden assertion over the compiled worker profile's tool set, in the shape
`mcp-entry.golden.test.ts` already establishes: pin the exact set, so any addition — the two
web tools included — fails with a diff rather than passing silently. Pair it with a negative
control that the pin is not vacuous.

**Ticket-ready:** yes.

## Not claimed

- **Not claimed** that the worker profile DOES carry the web tools. It very likely does not;
  what is missing is anything that would notice if it did.
- **Not claimed** that the threat-model amendment is wrong or absent. It is committed, and
  it is the reason this gap matters rather than a reason to discount it.
- **Not claimed** that the other two clauses are weakly covered. Both carry a negative arm.
