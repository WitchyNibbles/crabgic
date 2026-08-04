# Defect 23-release-docs-claims-not-rc-cited

**Phase:** 23 — Release hardening & publication (`roadmap/23-release-hardening.md`, exit criterion 14)

**Criterion (verbatim):**

> `docs/compatibility-matrix.md`, `operator-guide.md`, `security-posture.md`, and `upgrade-guide.md` are committed, and every claim in them cites a passing CI run or `EvidenceRecord` from the release candidate — no aspirational text.

**Found:** 2026-08-04, criteria-closeout pass (phase 23), at
`3dec9bf2caa6b94bd817aee414f9458c37750fd9`.

**Severity:** MEDIUM. The documents are stale in the **conservative** direction — they under-claim
rather than over-claim, which is the safe way to be wrong — so no reader is misled into trusting
something unverified. But one section does more than under-claim: `docs/compatibility-matrix.md`
tells a reader that every release-gate checklist item is `EVIDENCE-PENDING`, which both archived
final reports contradict, and its ARM64 section instructs readers not to cite as verified a fact two
real `aarch64` CI jobs establish.

## Gap

Three conjuncts. One is met, one is met on a reasonable reading, one is not.

| Conjunct                                                                              | Status at `3dec9bf`                                                             |
| ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| the four docs are committed                                                           | **met**, uncontested                                                            |
| no aspirational text                                                                  | **met on the honest reading** — the pending markers are disclosures, not claims |
| every claim cites a passing CI run or `EvidenceRecord` **from the release candidate** | **not met** — zero such citations exist in any of the four                      |

### Measurement trail

Measured across all four documents at this pass's HEAD:

| Document                       | Lines | `EVIDENCE-PENDING` | CI-run URL/id citations | `EvidenceRecord` id citations | mentions `2435cb9` / `6b9dd7b` |
| ------------------------------ | ----- | ------------------ | ----------------------- | ----------------------------- | ------------------------------ |
| `docs/compatibility-matrix.md` | 145   | 13                 | **0**                   | **0**                         | no                             |
| `docs/operator-guide.md`       | 489   | 2                  | **0**                   | **0**                         | no                             |
| `docs/security-posture.md`     | 519   | 0                  | **0**                   | **0**                         | no                             |
| `docs/upgrade-guide.md`        | 244   | 0                  | **0**                   | **0**                         | no                             |

The only 40-hex object id in the set is a stale one. `docs/compatibility-matrix.md:125-131` pins its
own authority to `releaseCandidateObjectId: 008ae4b2848d3d3c84a5b2d19100f12e073235e3`, a 2026-07-24
engine-re-baseline commit three days before the v1.0.0 candidate, in `scoringMode: "interim"`, with
"every one of its 15 checklist items … `EVIDENCE-PENDING`". Both archived final reports — committed
verbatim at `docs/evidence/phase-23/closeout/release-gate-report-final-2435cb9.json` and
`…-6b9dd7b.json` — say `final`, 15 PASS, 0 FAIL.

Three further concrete instances:

1. **`:140-145`** still lists as "owed before `v1.0.0` tag" the vendor support-window
   re-confirmation, the ARM64 hardware verification and "every release-gate-report checklist item
   currently marked `EVIDENCE-PENDING`" — all of which the gate scored, and the tag shipped
   2026-07-27.
2. **`:95` and `:117-118`** say "**Honest status: ARM64 has not been hardware-verified.**" and "do
   not cite it as hardware-verified in any release announcement", while CI jobs 89923390404 and
   91002998165 ran the full coverage-gated suite on `ubuntu-24.04-arm` at both candidates and
   recorded the observed `"arch": "aarch64"`.
3. **`docs/security-posture.md:220-226`** scopes itself to "as shipped in `crabgic@1.3.0`" and
   states the sign-off "does not cover" the amended approval model; the shipped line is 1.5.0.

Separately, `docs/release-notes-prep.md:54` still carries its "Real `v1.0.0` publish" box unchecked,
after `crabgic@1.0.0` shipped with provenance.

### Why the gate did not catch it

`e2e/attestation/src/releaseDocsCommitted.ts` is honest in its own doc comment about narrowing the
criterion to three mechanically checkable obligations: the files exist and are git-tracked; each doc
cites at least **one** repo-rooted path that resolves; and no `TODO|TBD|FIXME|XXX` marker appears.
A GitHub Actions run URL, a run id and an `EvidenceRecord` object id are not recognised as citations
at all, and the floor is one citation **per document**, not per claim. The check therefore cannot
see a claim that cites nothing, a snapshot pinned to the wrong object id, or a document scoped to a
superseded version.

Its one deliberate carve-out — not failing a doc for carrying an `EVIDENCE-PENDING` marker, because
"an honest disclosure of a gap is the opposite of an aspirational claim" — is correct reasoning and
is **not** what this defect is about.

### Why this is `UNMET` and not a wording correction

`roadmap/23` §In scope's docs bullet simply names the four files; the citation demand exists only in
the criterion. "Correcting" the criterion to match §In scope would therefore delete a guarantee
rather than reconcile a drift, which the closeout protocol classifies as `UNMET`.

## Proposed remedy

A documentation pass, not a check change:

1. **Refresh `docs/compatibility-matrix.md`'s snapshot section** to the archived final reports —
   `final`, 15 PASS, at `2435cb9` and `6b9dd7b` — and retire the `:140-145` "owed before v1.0.0"
   list against what actually shipped.
2. **Rewrite the ARM64 close-out** to cite CI runs 30249293110 and 30581597639 and their
   `ubuntu-24.04-arm` jobs, replacing the "do not cite as hardware-verified" instruction.
3. **Add run/record citations to each substantive claim** in the four documents, anchored on a
   release candidate. The lightest durable form is the one this record uses: a run URL plus the
   quoted job-log line.
4. **Re-scope `docs/security-posture.md`** (or annotate it) so a reader can tell which release line
   the sign-off covers, and tick `docs/release-notes-prep.md:54`.
5. Optionally, once the docs carry real citations, strengthen `releaseDocsCommitted.ts` to require
   at least one **run-shaped** citation per document — a bounded, falsifiable rule, unlike judging
   prose.

**Effort: M.** No new infrastructure; the runs, records and archived reports all exist and are now
committed under `docs/evidence/phase-23/closeout/`. The work is reading four documents against them.

**Needs:** nothing live, no Docker, no credentials, no engine.

**Ticket-ready:** yes.
