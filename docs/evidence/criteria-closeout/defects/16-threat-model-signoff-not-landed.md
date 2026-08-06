# Defect 16-threat-model-signoff-not-landed

**Phase:** 16 — Connector gateway core (`roadmap/16-gateway-core.md`, exit criterion 12)

**Criterion (verbatim):**

> Security review sign-off recorded against `docs/threat-model.md`.

**Found:** 2026-08-02, criteria-closeout pass (batch 4, phase 16), at
`30f931eab97b8360102498d4b766513be67241d0`.

**Severity:** evidence-channel-only, with a live documentation-staleness edge. The review itself was
performed twice and both records survive; what never landed is any trace of it in the document the
criterion names — and that document is currently wrong about this surface in two specific,
checkable ways.

## Gap

`docs/threat-model.md` carries **no security-review sign-off for phase 16**, and no implementation
review of any kind for its section 5 (Gateway).

| Check                                                  | Result at `30f931e`                                                                                                               |
| ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| `git grep -i -F -e "sign-off" -e "signoff"` in the doc | **no match** (`exit=1`)                                                                                                           |
| the doc's only review record                           | `## Review note` (`:280` at `30f931e`, `:290` as of main `2ea3689`), `- **Date:** 2026-07-15.` — phase 02's own design-stage pass |
| what that note says about phase 16                     | `:27` "Phases 03, 05, 06, 10, 12, 16, 17, and 22 are unimplemented as of this writing"                                            |
| §5 Gateway (`:152-170`) citing any implementation      | **no match** for `packages/gateway`, `security-posture` or `phase-16` anywhere in that range                                      |
| §2 Worker runtime (`:105`) citing implementation       | **it does** — `docs/security-posture.md` plus dated 2026-08-01 measurements                                                       |
| commits touching the doc                               | `6dd211b`, `8ae9007`, `933a0a4`, `3e74cc7`, `c0f6762` — none is a phase-16 commit                                                 |

The last two rows are the point: the document **is** maintained post-implementation for other
surfaces. §2 was refreshed with real measured behaviour. §5 was not. So this is a specific omission,
not a general property of a frozen design document.

Full transcript: `docs/evidence/phase-16/closeout-c12-threat-model-signoff-search.txt`
(UTC-stamped, HEAD-pinned, every command echoed verbatim with its own exit status).

### What exists — the review was genuinely performed, twice

This defect is about the RECORD, not the review. Two real sign-offs exist:

1. **`docs/evidence/phase-16/README.md` §"Security review (against `docs/threat-model.md` §5
   'Gateway')"** — a per-STRIDE-category walk of the implementation against §5's mitigation text
   (Spoofing / Tampering / Repudiation / Information disclosure / Denial of service / Elevation of
   privilege), each naming the actual module and the test that proves it, ending in an explicit
   `**Sign-off:**` paragraph. It also states its own limitation in the same breath (`:122`):

   > **Not done in this session:** editing `docs/threat-model.md` itself

   naming the doc edit as a carry-forward for the orchestrator, because the build session's
   permitted file scope was `packages/gateway/` and `docs/evidence/phase-16/` only. **That
   carry-forward was never picked up.**

2. **`docs/security-posture.md`** ("Security posture — threat model vs. implementation", `**Date:**
2026-07-24`), which is phase 23 work item 8's artifact. It carries `:33 ## Sign-off` and
   `:145 ### 5. Gateway` — "Implementation: `packages/gateway` (16), the design's other explicit
   'security keystone.'" — and its CRITICAL/HIGH findings table carries three gateway rows (HIGH #1
   DNS-rebind TOCTOU, HIGH #2 the mutate-path SSRF/exactly-once bypass, MEDIUM/HIGH #3 the
   exactly-once identity mismatch), each with its fix and its regression test.

### Why this was NOT closed as `SUPERSEDED-DISCHARGED`

`roadmap/23-release-hardening.md:138` is ticked and reads:

> No unresolved CRITICAL/HIGH security finding; threat-model review sign-off recorded with
> implementation cross-references (03/16 keystones + 17's lint surface).

That is a real, closed, plainly relevant box, and treating it as a discharge was considered
seriously. It was rejected for two reasons, both structural:

1. **This criterion carries no deferral clause.** `SUPERSEDED-DISCHARGED` is defined
   (`docs/evidence/criteria-closeout/README.md`) as "the criterion's **own deferral clause** is
   discharged by a later closed phase's ticked box". Criterion 12 is a flat, unconditional sentence.
   Phase 16's §Risks does resolve the keystone-review _phrasing_ to 23's ("23's text now
   consistently phrases the security-keystone set as '03/16 security keystones + 17's blocking-lint
   surface'"), but that is a wording reconciliation inside a Risks bullet, not a deferral inside
   the checkbox.
2. **It would be a channel substitution.** The criterion names one file. 23's sign-off lives in a
   different one. Accepting "recorded in a different document that reviews the named document" is
   exactly the move the pass rules forbid ("MUST NOT reinterpret a named evidence channel"), and it
   is the move that would let the two concrete stalenesses below stay invisible.

### What is missing, concretely

1. **No dated implementation-review note in the document.** A reader who opens
   `docs/threat-model.md` — the canonical security artifact, and the one `roadmap/02` names as
   consumed by 16 and 23 — is told at `:27` that phase 16 is unimplemented and that "Re-review is
   required once each phase lands". Nothing tells them the re-review happened or where to find it.
   §5 has no back-reference to `docs/security-posture.md`, though §2 does.
2. **§5's residual text is stale in a way that matters.** Its Spoofing cell (`:163`) still says the
   upstream-MCP-client wrap "is flag-gated and, per 16's own text, it remains an open question". The
   word "flag-gated" is precisely the phrasing `bddac4c` (PR #47) retired as understating the
   containment: the wrap is **structurally unenableable** (no MCP client in shipped source, `.strict()`
   schema with no field, no env var, no production `setEnabled` caller, zero-arity worker-config
   builder), pinned by
   `packages/gateway/src/mcp/upstream-mcp-client-unenableable.test.ts`. `git grep -c unenableable`
   returns `docs/security-posture.md:2` and `roadmap/16-gateway-core.md:1` — and **zero** for
   `docs/threat-model.md`. The most security-relevant correction of the last week reached every
   document except the threat model.
3. **The doc's own Open item 3** ("The gateway's optional upstream-MCP-client wrap's quarantine
   status is unresolved… phase 16's own text states this is 'addressed by neither file'") is still
   phrased as an unmanaged open question, whereas `roadmap/16` §Risks now records it as a **recorded
   precondition** on any enabling work, enforced by a CI tripwire. Still open — but managed, and the
   doc does not say so.

### Search trail

1. `git grep -n -i -F -e "sign-off" -e "signoff" -- docs/threat-model.md` → `exit=1`, no match.
2. `sed -n '280,287p' docs/threat-model.md` → `## Review note`, Reviewer = "this orchestrated
   documentation pass (phase 02, work item 9)", Date = 2026-07-15. (That span is as of `30f931e`;
   main `2ea3689` shifted the heading to `:290`. The section, its reviewer and its date are
   byte-unchanged — only its offset moved.)
3. `sed -n '152,170p' docs/threat-model.md | grep -F -e 'packages/gateway' -e 'security-posture' -e
'phase-16'` → `exit=1`. Every §5 mitigation cell cites roadmap prose ("16 §Transport security",
   "16 exit criteria"), i.e. the specification, never the shipped code.
4. `sed -n '105p' docs/threat-model.md | grep -c -F 'security-posture'` → `1`. Contrast case: §2 was
   updated post-implementation.
5. `git grep -c -F -e "unenableable" -- docs/threat-model.md docs/security-posture.md
roadmap/16-gateway-core.md` → `docs/security-posture.md:2`, `roadmap/16-gateway-core.md:1`, nothing
   for the threat model.
6. `git log --oneline -5 -- docs/threat-model.md` → five commits, none of them phase 16's.
7. `git grep -n -F -e "Not done in this session" -- docs/evidence/phase-16/README.md` → `:122`, the
   phase's own honest record that the doc edit was left undone.
8. `roadmap/16-gateway-core.md` §Out of scope: "`docs/threat-model.md` authorship — 02; this phase's
   transport/secret/pipeline surface is one of the document's required review passes, not the
   document itself." So phase 16 could not have landed this edit unilaterally — which is why it is a
   coordinated carry-forward rather than a phase-16 omission of work.

**This is an unpicked-up carry-forward, not drift.** The criterion's wording is unchanged since the
roadmap was first committed, the build session recorded the gap accurately at the time, and nothing
since has closed it.

### Re-checked against the merge target, not only the base

Main moved during this pass. `2ea3689` ("docs: correct six disclosures that stopped being true",
2026-08-02) edits **this very document**: it closes the Review note's **Open item 2** (the
capability-quarantine journal gap) and rewrites cross-surface residual theme 3, per interface-ledger
Gap 5's Resolution. It does **not** touch **Open item 3** — the gateway's own surface, this
criterion's subject — does not touch §5 at all, and does not touch the `:27` unimplemented list. So
a maintainer pass over the threat model happened within a day of this closeout and left the
gateway's half exactly as it was. That is why the box is filed rather than held open as imminent:
the mechanism for updating this document plainly works, and this surface was simply not in scope for
that pass. The one consequence for the record is a ten-line offset shift below `:262`; every line
number cited above is as of `30f931e`, with the merge-target number given alongside where it moved.
The transcript is a verbatim capture at `30f931e` and is deliberately not retouched.

## Proposed remedy

One coordinated edit to `docs/threat-model.md` — authorship is 02's, so it belongs in a reviewed
commit of its own rather than in a closeout pass:

1. Append a dated implementation-review entry beside the existing `## Review note`, e.g.
   `### Implementation re-review — gateway (§5), 2026-XX-XX`, stating the verdict and
   cross-referencing the two records that already exist: `docs/security-posture.md` §"Sign-off" and
   `### 5. Gateway`, and `docs/evidence/phase-16/README.md` §"Security review". Mirror the shape §2
   already uses at `:105` (dated measurement + `docs/security-posture.md` pointer), so the document
   stays internally consistent.
2. Refresh `:27`'s "unimplemented as of this writing" list — 16 has landed, and so have most of the
   others named there. Minimum honest fix: 16.
3. Correct §5's Spoofing and Information-disclosure residual cells from "flag-gated" to the
   structurally-unenableable finding, citing
   `packages/gateway/src/mcp/upstream-mcp-client-unenableable.test.ts` and `roadmap/16` §Risks'
   PRECONDITION RECORDED bullet. Restate Open item 3 as "open, but a recorded precondition on any
   enabling work, tripwire-enforced" rather than as an unmanaged question.
4. Then re-run this closeout for criterion 12 only and cite the edited document.

No code changes, no new tests, no CI run required — the evidence being cross-referenced already
exists and is already green. Because the doc is 02-owned and 23 consumes it, the edit should be
reviewed jointly with whoever holds those two phases.

**Effort:** S. **Needs CI:** no. **Needs live engine:** no. **Needs owner input:** no, but it is a
coordinated edit across an 02-owned document, so it needs the orchestrator to route it rather than a
phase agent to take it unilaterally.

**Ticket-ready:** yes.

## Remedied 2026-08-06

Landed by the closeout wave's docs batch (branch `closeout/batch-f`). The record above is left
verbatim; this is the dated addendum, per the convention.

**The remedy's four steps, as landed** — line numbers at the tree this branch merges as:

| Step | Asked for                                                                                       | Landed at                                                                                                                                                                                                                     |
| ---- | ----------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | a dated implementation-review entry beside the `## Review note`                                 | `docs/threat-model.md:356` — `### Implementation re-review — gateway (§5), recorded 2026-08-06`, spanning `:356-395`, cross-referencing `docs/security-posture.md:33`/`:151` and `docs/evidence/phase-16/README.md:87`/`:134` |
| 2    | refresh `:27`'s "unimplemented as of this writing" list, minimum honest fix 16                  | `docs/threat-model.md:34` — a dated correction appended to the end of the same paragraph. It stamps **only 16**, and says so: "Only 16 is stamped here, because only 16 was counted for this correction"                      |
| 3    | correct §5's Spoofing and Information-disclosure residual cells; restate Open item 3 as managed | `docs/threat-model.md:163` and `:166` (in-cell, original sentences byte-identical); Open item 3 at `:338`                                                                                                                     |
| 4    | re-run the closeout for criterion 12 and cite the edited document                               | `docs/evidence/criteria-closeout/phase-16.json` criterion 12, now `EVIDENCE-EXISTS` / ticked, `defectRef` removed; `roadmap/16-gateway-core.md:133` ticked with an `Evidence (2026-08-06)` annotation                         |

**One deviation, disclosed rather than smuggled.** Open item 7 — "No re-verification has occurred
against running code for any surface besides phase 02's own contracts" — was **not** in the four
steps. It gained a dated partial-discharge note at `docs/threat-model.md:352` anyway: it was already
stale against §2's 2026-08-01 refresh, and step 1 made it stale a second time. Correcting three
neighbouring staleness claims and leaving a fourth standing beside them would have been the worse
choice. The note discharges it _partially_ and says so — §2 and §5 only; every other surface in that
list remains design-level, exactly as the item states.

**The no-shift constraint, and why every edit above is in-line.** Merged
`docs/evidence/criteria-closeout/phase-02.json` criterion 11 — and the same numbers in
`roadmap/02-contracts-and-schemas.md:182`'s annotation — pin this document's nine section headings
**by line number** (written in full rather than as bare markers, so a sweep can see them):
`docs/threat-model.md:70`, `docs/threat-model.md:91`, `docs/threat-model.md:113`,
`docs/threat-model.md:133`, `docs/threat-model.md:153`, `docs/threat-model.md:172`,
`docs/threat-model.md:191`, `docs/threat-model.md:211` and `docs/threat-model.md:230`. All nine
still resolved exactly at `c0b3873`. An insertion anywhere above `docs/threat-model.md:230` would
have moved every one of them. So steps 2, 3 and 4 are **line-count-neutral in-line appends** rather than new paragraphs,
and step 1 is an EOF append: the diff's expanded hunks are `34→34`, `161-168→161-168`, `338→338`
and the `352` EOF append — **zero net lines above EOF**. The transcript
`docs/evidence/phase-16/closeout-c12-signoff-landed.txt` prints all nine headings at the final tree
and at `origin/main` side by side, and both lists are identical.

**Two line numbers in the record above are stale at `c0b3873`, through no fault of this remedy, and
are deliberately left as written** (annotate, never rewrite — and never retro-edit a merged record's
own capture):

- the Gap table's `docs/security-posture.md` `:145 ### 5. Gateway` is now `:151`;
- §"What exists" item 1's `:122` for the "Not done in this session" sentence in
  `docs/evidence/phase-16/README.md` is now `:136`.

Both were captured at `30f931e`, which the record states, and both were re-resolved for this remedy
rather than trusted.

**What is now recorded, stated so it is not over-read.** The threat model carries a pointer to two
sign-offs that already existed, plus two dated corrections that post-date them. It is **not** a fresh
security review, and it says so in its own scope paragraph. Deploy certification is untouched and
lives solely in `docs/deploy-posture.md`, where it is conditional rather than clear.
