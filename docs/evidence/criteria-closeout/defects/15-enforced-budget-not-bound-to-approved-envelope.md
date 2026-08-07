# 15 — an enforced budget is bound to the intake journal, never to the approved envelope

**Phase:** 15 — PerformanceContract & benchmarking harness
(`roadmap/15-performance-contracts.md`, exit criterion 3)

**Criterion (verbatim):**

> Enforced budgets are hash-linked to the approved envelope; a tampered post-approval edit fails closed (integration test + journal entry).

**Found:** 2026-08-02, criteria-closeout pass batch 3 (phase 15), against `main` @ `eabb65a`.

**Severity:** blocking-guarantee. The clause that fails is the one that says _whose_ figure the
gate is holding the candidate to. What is enforced today is the figure intake wrote down, not the
figure a human signed.

## Gap

The criterion makes two claims. The second is fully met. The first is not, and the mechanism that
stands in for it is weaker on exactly the axis the words name.

### What exists (the second clause — met)

`EnforcedPerformanceContractSchema` carries `provisionalBudgetHash`, and
`packages/perf/src/contract/hash-link.ts:71-90`'s `verifyProvisionalBudgetIntegrity` runs three
ordered checks against 04's append-only, hash-chained journal, first failure winning:

1. `self_consistency_mismatch` — `canonicalHash(provisional.budgets)` does not match the record's
   own `budgetHash`. Proven by `packages/perf/src/contract/contract-builder.test.ts:67-91`.
2. `no_journal_anchor` — no `remote_operation_record` entry ever committed this provisional
   contract id. **Fail-closed**, never "no anchor means trust the live record"
   (`contract-builder.test.ts:134-147`, `BudgetJournalAnchorMissingError`).
3. `journal_anchor_mismatch` — the real vector: a post-approval widening (200ms → 2000ms) that
   ALSO recomputes its own `budgetHash` consistently. `contract-builder.test.ts:93-132`, whose
   `:113-115` inline sanity assertion
   (`expect(canonicalHash(deliberatelyTampered.budgets.map((b) => ({ ...b })))).toBe(deliberatelyTampered.budgetHash)`)
   proves the self-consistency check alone would have passed the same fixture — i.e. the test
   exercises the gap the fix closed, not a strawman.

It holds end-to-end through 14's real registry with the block itself journaled as evidence:
`packages/perf/src/gate/performance-gate.e2e.test.ts:105-157` —
`expect(results[0]?.verdict.detail).toMatch(/hash-link check failed \(journal_anchor_mismatch\)/)`
and `expect(EvidenceRecordSchema.safeParse(results[0]?.evidence).success).toBe(true)`. The anchor
shape is not a test invention either: `packages/supervisor/src/intake/intake-pipeline.test.ts:407-422`
("anchors the DERIVED provisional contract in the intake idempotency record") confirms 11's real
pipeline writes the `remote_operation_record` entry that
`packages/perf/src/contract/journal-anchor.ts` reads.

### What does not exist (the first clause — the gap)

**Nothing links an enforced budget to the approved `AuthorizationEnvelope`.**

- `packages/contracts/src/contracts/authorization-envelope.ts:73-104` —
  `AuthorizationEnvelopeSchema` is `.strict()` and carries `ownedPaths`, `commands`,
  `networkDestinations`, `credentialReferences`, `dependencies`,
  `remoteResourceAuthorizations`, `temporaryServices`, `prohibitedActions`,
  `maxTurnsPerAttempt`, and its own `canonicalHash`. No budget. No budget hash.
- `packages/contracts/src/contracts/performance-contract.ts:157-167` —
  `EnforcedPerformanceContractSchema` carries `budgetHash` and `provisionalBudgetHash`. No
  envelope id, no envelope hash. Nothing in `packages/perf` reads
  `ChangeSet.authorizationEnvelopeId`.
- The human approval token is minted over the envelope hash and nothing else —
  `packages/contracts/src/approval/token.ts:45`,
  `export type ApprovalTokenSubjectKind = "envelope_hash" | "capability_digest" | "learning_review"`,
  with no member covering a performance budget.
  `packages/contracts/src/contracts/criteria-seal.ts:6-22` states the same fact from roadmap/24's
  side, in its own words: _"the `AuthorizationEnvelope` content hash covers authority fields only
  (never criteria), the approval token signs that envelope hash"_.

So the substituted anchor proves **"this is the budget intake committed at approval-flow time"**,
not **"this is the budget a human approved"**. Concretely, a budget that was already wrong at the
moment 11 built and journaled the provisional contract — a compromised or buggy intake, or one fed
a request the approver never saw the budget consequences of — passes all three checks and is
enforced. This phase's own evidence README already names this, and names it as unclosed:

> the HUMAN APPROVAL TOKEN itself … is minted over the `AuthorizationEnvelope`'s content hash ONLY
> — the performance budget sits entirely OUTSIDE what the human approver's own signature covers …
> the journal anchor proves "this is what got committed at intake time," not "this is what a human
> actually approved."
> (`docs/evidence/phase-15/README.md`, §Carry-forwards, "HIGH PRIORITY")

### Why this is UNMET and not a wording correction

The wording protocol exists for a criterion that is _factually wrong about the system_ and whose
corrected form is **more precise, not weaker**. A correction here — "hash-linked to the provisional
contract 11 committed at approval time, anchored in 04's journal" — drops the binding to what the
approver signed. That is a lost guarantee, and the pass's own rule says a weaker guarantee is
`UNMET`, not a wording fix. It is recorded as a defect against the criterion, not against the
implementation: the journal anchor is a real improvement over the self-checksum it replaced, and
the second clause is genuinely evidenced.

### Search trail

- Read `packages/perf/src/contract/{hash-link,journal-anchor,contract-builder}.ts` and their tests,
  and `packages/perf/src/gate/performance-gate.{ts,test.ts,e2e.test.ts}`.
- Grepped `packages/contracts/src` for `provisionalPerformanceContract|performanceContract` — the
  only hits outside `performance-contract.ts` are `change-set.ts:67`'s
  `provisionalPerformanceContractId` and `:77`'s optional `enforcedPerformanceContractId`, both
  bare id references.
- Grepped `packages/contracts/src/contracts/*.ts` for `envelope` + `hash|content`: no schema joins
  the two contracts.
- Read `docs/interface-ledger.md` Gap 16 (:780-900) and Gap 21 (:1501-1600). Gap 21 records that
  budgets sourced from criteria are "transitively bound by [roadmap/24]'s criteria seal" — but
  `criteria-seal.ts`'s own header (quoted above) shows that seal is likewise journal-anchored, not
  envelope-bound, so it does not supply the missing binding.
- Read `docs/evidence/phase-15/README.md` §"Adversarial-validation repair pass" and
  §Carry-forwards, which reach the same conclusion independently and route it to
  "the reconciler / phase 23's security review / the repo owner".

## Proposed remedy

The smallest honest fix is the one the phase's own carry-forward already specifies, and it is a
coordinated 02/11 change — not something `packages/perf` can do alone, which is why it is filed
rather than fixed.

1. **02** — add the provisional budget's `budgetHash` (the hash, not the budgets) to whatever
   content the `AuthorizationEnvelope`'s `canonicalHash` covers, or to a sibling field folded into
   the same signed digest. This is an `AuthorizationEnvelopeContent` shape change, so it is exactly
   the "schema member" ruling `docs/interface-ledger.md`'s own coordinated-edit requirement
   governs — the ledger edit lands with it, not after it.
2. **11** — populate that field when it builds the provisional contract, and have
   `contract.approve`'s verification path check the binding at approval time (the same posture as
   CRITICAL C1's server-side digest derivation).
3. **15** — extend `verifyProvisionalBudgetIntegrity` with a fourth ordered check,
   `envelope_hash_mismatch`, comparing the provisional `budgetHash` against the approved envelope's
   covered value; keep the existing three, which stay useful for the post-approval window.
4. Re-run this criterion's walk. Failing-first fixture: an approval envelope signed over budget A,
   a provisional contract carrying budget B, and no post-approval edit at all — today that passes
   all three checks; it must block.

**Effort sizing: M.** Small in lines, medium in blast radius: one `.strict()` schema field crosses
02, 11, 15 and 24's seal, requires a ledger coordinated edit, and moves the supervisor goldens and
every envelope-hash fixture in the repo. No CI job, no live engine, no owner input beyond
ratifying the ledger amendment.

**Ticket-ready:** yes.

## Remedied 2026-08-07 — the binding exists, and one thing is still owed

PR #116 landed the binding this record measured as absent, as interface-ledger Gap 22.
`AuthorizationEnvelopeSchema` now carries `provisionalBudgetHash`; `hashEnvelopeContent` takes the
canonical hash **over** it, so the approval token — which signs the envelope hash — covers the budget
set; and `EnforcedPerformanceContractSchema` carries the matching `approvedEnvelopeHash`. The binding
is **derived at intake and cannot be declared by a caller**: `IntakeRequest`'s envelope content is
typed as the envelope content minus that member. Two new fail-closed reasons,
`no_envelope_budget_binding` and `envelope_hash_mismatch`, are checks 4 and 5 of `hash-link.ts`.
Evidence: `docs/evidence/phase-15/envelope-binding-probe-batchE.txt`.

Why the two new checks are ordered **last** is a measurement rather than a style choice (probe P2b):
first failure wins, so moving them above check 1 reddens the three **pre-existing** tests this
criterion's already-merged evidence cites — including the fixture the merged record quotes for
`journal_anchor_mismatch`. The last-position order is the only one that both catches the new vector
and leaves the existing evidence reporting the reason it was merged reporting.

The compile-time claim was **falsified rather than asserted** (probe P4), which is the part of this
remedy most worth reading. TypeScript's excess-property check binds object literals only, so a
widened intermediate assigns straight through at `tsc` exit 0 — "unrepresentable" is true of the
shape a caller writes, not of every value that can reach the field. The runtime override that closes
the other half is pinned by its own reverse-probed test.

**Kept open: ledger Gap 22 awaits owner ratification**, on two points — its deliberate omission from
the ledger's intro sentence and origin table (an inserted line moves every protected anchor below it;
Gap 21 sets the same precedent) and the OPTIONAL-in-schema posture. That gates the **ledger entry's**
ratification, not the enforcement. Remedy step 2's disclosed deviation is recorded at `hash-link.ts`:
the approval-time check is discharged by signature coverage rather than by a separate check. And
legacy envelopes without the member still parse but cannot pass enforcement, so in-flight runs must
be drained before upgrading.

## Addendum 2026-08-07 — ledger Gap 22 is ratified as written

This record says "**Kept open: ledger Gap 22 awaits owner ratification**, on two points — its
deliberate omission from the ledger's intro sentence and origin table … and the OPTIONAL-in-schema
posture. That gates the **ledger entry's** ratification, not the enforcement."

That is discharged. On 2026-08-07 the owner ratified Gap 22 **as written**, both flagged points
included: the intro-sentence / origin-table / Index omission stands on the Gap 21 precedent — line
stability over self-consistency — and the OPTIONAL-in-schema posture is accepted as ruled, with no
global version bump, no migrations and no default, because a default there forges what the human
signed. The ratification is appended at the end of `docs/interface-ledger.md`; the entry's own
"Awaiting owner ratification" marker stays verbatim per that file's annotate-never-rewrite
convention.

No ruling content changed, so no phase-file edit follows. Status stays **fixed**, unchanged.
