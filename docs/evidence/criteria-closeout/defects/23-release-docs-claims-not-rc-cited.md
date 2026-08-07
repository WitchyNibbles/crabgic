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

## Remedied 2026-08-06 — steps 1-4 landed, the box stays UNTICKED

Landed by the closeout wave's docs batch (branch `closeout/batch-f`). Everything above is left
verbatim; this is the dated addendum. **The remedy is done and the criterion is still UNMET** —
those are two different statements, and conflating them is what this addendum exists to prevent.

### The remedy's five steps, as landed

| Step | Asked for                                                                                              | Landed at                                                                                                                                                                                                                                                                                                  |
| ---- | ------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | refresh the snapshot section to the archived final reports and retire the "owed before v1.0.0" list    | `docs/compatibility-matrix.md:189` (§1, the snapshot superseded against both committed `final` reports — 15 PASS / 0 FAIL, **158** linked entries in the `2435cb9` report and **160** in the `6b9dd7b` one, never crossed) and `docs/compatibility-matrix.md:211` (§2, the owed list retired item by item) |
| 2    | rewrite the ARM64 close-out to cite runs 30249293110 and 30581597639                                   | `docs/compatibility-matrix.md:123` — a dated block naming jobs 89923390404 and 91002998165, each quoting the **pair** `  "arch": "$(uname -m)",` / `  "arch": "aarch64",`                                                                                                                                  |
| 3    | add run/record citations to each substantive claim                                                     | landed where an RC-scoped citation exists; **measured, and it does not reach every claim** — see the census below                                                                                                                                                                                          |
| 4    | re-scope `docs/security-posture.md`, and tick `docs/release-notes-prep.md:54`                          | `docs/security-posture.md:319` (release-line re-scope + the manifest-count correction) and `docs/release-notes-prep.md:54`, ticked, with a dated registry-checked note beneath it                                                                                                                          |
| 5    | _(optional)_ strengthen `e2e/attestation/src/releaseDocsCommitted.ts` to require a run-shaped citation | **DELIBERATELY NOT DONE** — see below                                                                                                                                                                                                                                                                      |

**Step 5, not done, with the reason rather than silently.** `npm run check:e2e-types` is **red on
`origin/main`** (25 pre-existing `DispatchAttemptOptions` errors in `e2e/matrix/orchestration`,
and the script is `&&`-chained fourth so it short-circuits before most projects). The step is
explicitly optional in the record above, and a docs-only batch does not buy an `e2e/` source edit
plus an individual per-project typecheck for an optional hardening. It stays available.

### Why the box is still unticked — the census, with numbers

The criterion's second conjunct is a universal quantifier: _every_ claim cites a passing CI run or
`EvidenceRecord` **from the release candidate**. A mechanical claim census (status-verb extraction
over the four documents, every extracted item listed with its bucket in
`docs/evidence/phase-23/closeout/c14-release-docs-citations.txt` — no hand-check bucket that
nobody hand-checks):

|                   | status-bearing lines | RC CI run | archived RC report | non-candidate artifact | disclosure |
| ----------------- | -------------------- | --------- | ------------------ | ---------------------- | ---------- |
| at `origin/main`  | **108**              | 0         | 0                  | 97                     | 11         |
| after this remedy | **134**              | 3         | 5                  | **112**                | 14         |

Eight of 134. The remaining 112 are not a bookkeeping gap that more citing would close:

- the **Grafana OSS/Enterprise 12.4 and Enterprise 13.1 "live-smoke-tested, PASS" rows** and the
  **Jira DC container-recipe rows** rest on _local docker transcripts dated 2026-07-24_, three days
  before the v1.0.0 candidate. No CI run at either candidate ever executed them, and docker is
  outside this wave's authorization;
- the **Claude Code engine range** and the **30-of-32 sub-probe tally** rest on
  `docs/engine-baseline.md` — live, owner-gated, pre-candidate;
- the **x86-64 / WSL2 "Verified, hardware-tested" rows** are about the developer host, not about
  any CI run at all;
- `docs/security-posture.md`'s per-surface review is dated 2026-07-24 and scopes itself to the
  1.3.0-era model, with its own 1.5.0 re-review recorded as **owed** in the document.

Reclassifying those as "disclosures" would be a reading trick — they are present-tense
verified-status claims, not gap statements. So the remedy lands, and the box does not move.

### Two shifts this remedy causes, disclosed

1. Inserting the ARM64 correction after `docs/compatibility-matrix.md:121` moves what this record
   cites as `:125-131` and `:140-145`. Those spans are now `:159-165` and `:174-179`. **The line
   numbers in the body above are left as written**: they are pinned to `3dec9bf`, this record says
   so, and a merged record's own capture is not retro-edited. The only other inbound references
   into that range were the phase-23 criterion-14 item and the `roadmap/23:175` annotation, both of
   which this same change rewrites.
2. `docs/release-notes-prep.md:54` changes, because ticking that box **is** step 4 of this remedy.

Everything else was placed under a notation-aware inbound-citation census: the highest surviving
merged citation into `docs/compatibility-matrix.md` is `:118` and into `docs/security-posture.md`
is `:311`, so the two insertions go below both. Verified mechanically afterwards — of
`docs/security-posture.md`'s 73 inbound-cited lines, 73 are byte-identical to `origin/main`.

### One sha-scoped drift in the table above, noted rather than corrected

The Gap table records `docs/security-posture.md` at **519** lines and two standalone
`EVIDENCE-PENDING` markers in `docs/operator-guide.md`. At `c0b3873` that file was **525** lines,
and the operator guide's two occurrences of the marker are vocabulary references inside prose
rather than pending claims. Both are consequences of the sha this record pins, not errors in it.

### Two findings this remedy turned up that were not in the record above

- **`docs/upgrade-guide.md` pointed at a section that does not exist.** Its
  "Marketplace / plugin trust" paragraph sent readers to "`docs/compatibility-matrix.md`'s
  reproducible-build section". That document has nine headings and none of them is about
  reproducible builds. Corrected, from below, in the upgrade guide's new anchor section; the
  original sentence is left verbatim.
- **`docs/security-posture.md` claims "7 blocking entries" twice** (`:178` and, before this
  change, `:506`). The manifest has **six**: `packages/gates/src/security-fixture-manifest.ts`
  declares entry ids at `:237`, `:249`, `:285`, `:292`, `:313` and `:327`. The two tautological
  tenant entries were replaced by one real Grafana tenant-boundary entry in PRs #94/#100 — seven
  minus two plus one. Both copies of the number were found before the correction was written, and
  both are named in it.

## Correction 2026-08-07 — the step-5 sentence is stale

Dated correction beside the addendum's step-5 paragraph, which stays verbatim. That paragraph reads
`npm run check:e2e-types` is **red on `origin/main`** (25 pre-existing `DispatchAttemptOptions`
errors in `e2e/matrix/orchestration`, and the script is `&&`-chained fourth so it short-circuits
before most projects). Both halves have since stopped being true.

The chaining was replaced: the script now runs every project independently and reports a per-project
verdict, so it no longer short-circuits. And the errors were fixed by PR #109 — re-verified at
`ed999b9`, `PASS — 8 project(s) typechecked clean`, and independently in three separate batch
transcripts this wave. One precision so the next reader does not re-open this: the check typechecks
`e2e/` against the workspace's built `dist/`, so on a stale build it reports failures that are a
build-state artifact rather than a regression. `release-e2e.yml` runs `npm run build` in the step
immediately before it, which is the channel this claim is about.

**Everything else about this record stands, and the box stays unticked.** The criterion's second
conjunct is a universal quantifier over claims cited to the release candidate, and the census behind
it is unchanged: the large majority of the audited lines rest on docker, live or host channels that
no free run can produce. Status stays **owner-gated**, and the disposition — permanent untick versus a
reword that loses a guarantee and therefore needs owner sight — is an owner question, not a
maintenance task.

## Addendum 2026-08-07 — the owner question is answered

This record's preceding correction closes by saying the disposition "— permanent untick versus a
reword that loses a guarantee and therefore needs owner sight — is an owner question, not a
maintenance task." It was answered on 2026-08-07.

**The ruling: permanent untick. The reword is REFUSED as guarantee-losing.** The criterion's second
conjunct is a universal quantifier over claims cited to the release candidate, and narrowing it to
what happens to exist would delete a guarantee rather than reconcile a drift. The census is unchanged
and stands at **8 of 134**.

Status stays **owner-gated**, now on a single channel rather than a disjunction: docker or live
release-candidate evidence. The "or an owner re-scope ruling" disjunct is **closed** — the re-scope
was considered and refused, so no ruling can discharge this box; only evidence can. The annotation at
`roadmap/23-release-hardening.md:175` records the same ruling in place.
