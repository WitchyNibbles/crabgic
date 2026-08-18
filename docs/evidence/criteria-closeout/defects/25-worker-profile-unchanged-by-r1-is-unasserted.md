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

## ⚠️ RETRACTED IN PART, 2026-08-18 — the worker-profile clause IS covered, and this record said it was not

**The claim in this record's title is wrong.** The compiled worker profile is asserted not to
carry the web tools, by a stronger mechanism than the criterion asks for.

`packages/engine-core/src/compiler/permission-profile.ts` puts `WebFetch` and `WebSearch` in
`MANDATORY_FIXED_DENY`, and `packages/engine-core/src/footguns/property.test.ts` runs
`compileEnvelope` — the production compiler, not a fixture — over **≥10k generated envelopes**
under `describe("compileEnvelope — property: mandatory denies survive any envelope (≥10k cases)")`,
asserting every mandatory deny is present for each one. `permission-profile.test.ts` carries the
unit-level counterpart.

A property over every envelope the generator can produce is strictly stronger than the golden
pin the criterion names: a golden file pins ONE profile, and this pins the invariant.

### How the search went wrong, because the method is the reusable part

Two errors, both mine, both in the same direction — looking for the shape of the answer instead
of the answer:

1. **Searched for `CompiledProfile`.** The type is `CompiledWorkerProfile`. The substring match
   found live tests and e2e files and none of the compiler suite.
2. **Searched for the word `golden`**, in two directories, because the criterion says "profile
   golden test". The evidence is a property test and does not contain that word anywhere.

⚠️ **A defect record asserting an ABSENCE is only as good as the search behind it**, and this one
was published with a search that had a typo in the type name. The remedy stated here — "a golden
assertion over the compiled worker profile's tool set" — would have added a weaker duplicate of a
control that already exists.

### What IS missing, measured again and with the right query

`docs/threat-model.md` contains **zero** occurrences of "web" outside the `WebFetch`/`WebSearch`
literals in the mandatory-deny list, and `git log -- docs/threat-model.md` shows its most recent
commit is `24f2ca8` (2026-08-07), which predates owner ruling R1 (2026-08-15) entirely.

The criterion's third clause is "`docs/threat-model.md` amendment committed", and
`roadmap/25-owner-pipeline-conformance.md:162` states what the amendment must say: fetched
content named as untrusted input. `docs/design/owner-pipeline-conformance.md` §7 records the
threat model as "**amended, by ruling R1**". It was not amended. That is the real gap, it is a
documentation gap rather than a control gap, and it is what this record now tracks.

**Effort: S.** One STRIDE row on the surface that holds the grant, plus the residual-theme note.

**Ticket-ready:** yes, for the threat-model amendment only. The golden test this record originally
asked for should NOT be built.

## Remediated 2026-08-18 — the amendment R1 obliged is written

`docs/threat-model.md` gains `### AMENDED 2026-08-15 (owner ruling R1) — manager-side web
research`, dated to the ruling rather than to today, in the same annotate-rather-than-rewrite
shape the four roadmap phases use for Gap 19's amendment.

⚠️ **Appended at END OF FILE, and that placement was itself measured.** The first attempt inserted
it into §2, where it belongs by subject. That shifted every section below by 28 lines and broke
**six fragments** across three merged phase-02 citations — `check:citation-content` caught it, the
insertion was reverted, and the amendment moved to the end with a note saying why. The general
point is worth more than this one edit: a document whose body cannot be added to without
invalidating pointers into it gets amended less often than it should, so amendments to this file
go at the end.

It records the boundary in three parts:

- **what is unchanged** — `WebFetch`/`WebSearch` stay in `MANDATORY_FIXED_DENY`, property-tested
  over ≥10k envelopes, so the grant did not widen the worker profile and no envelope can;
- **what is new** — fetched content as UNTRUSTED INPUT reaching a manager-side proposal, which is
  an input rather than a capability, with three STRIDE rows (tampering by prompt injection,
  spoofing by impersonated documentation, disclosure through the query itself);
- **what is NOT claimed** — that prompt injection is closed. It is bounded by a read-only agent,
  human gates, and `expanded_authority` never taking an autonomous default. The residual column
  says where it still bites: an injected conclusion that is merely PLAUSIBLE is caught, if at
  all, by the human reading the record at the gate.

⚠️ The golden test this record originally asked for was NOT built, and should not be. See the
retraction above: the control it would have duplicated already exists and is stronger.
