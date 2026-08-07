# Defect 23-support-window-confirmation-is-probe-stamped

**Phase:** 23 — Release hardening (`roadmap/23-release-hardening.md`, the Jira DC / Grafana
version-support-windows exit criterion)

**Found:** 2026-08-07, post-v1.6.0 pass, at `cb450e3ef11610e2cd5d18ccf7da6cb7a3a65442`.

**Severity:** two separate defects with one root. Neither is a false PASS today; both are ways the
gate could have become one without anything saying so.

- **D1 — misattributed provenance (documentation/wording).** `confirmedOn` is the automated probe's
  run date, while the gate reported it as a human "re-confirmation". **Effort: S, and it is done.**
- **D2 — a merged citation quoted a self-refreshing value (evidence hygiene).** The collision was
  measured, the baseline regenerated under owner ruling, and the real remedy sized below but **not
  taken**. **Effort of the real remedy: S. Deliberately deferred; see "Why the real remedy was not
  taken now".**

Also fixed alongside, and arguably the most useful thing here: the release gate had **no per-push
warning lane at all**, so an expired freshness bound would first have surfaced inside a
tag-triggered publish.

## D1 — `confirmedOn` was a probe date wearing an attestation's name

The design is an honest two-half split, documented at `e2e/provisioning/src/supportWindows.ts`:

- **MECHANICAL** — "is the pinned container tag published?" A real HTTP fact, probed every run.
- **ATTESTED** — "when does vendor support end?" Read from the committed, human-maintained
  `docs/vendor-support-policy.json`, which must cite its source. The module's own comment says
  scraping the prose "and calling the result a verified fact would be exactly the kind of
  aspirational evidence this phase forbids."

The stamp did not respect that split. `buildSupportWindowRecords` sets `confirmedOn:
options.probedOn` — the date the **probe** ran — and every consumer read it as an attestation:

- the gate's failure message said a "re-confirmation is N days stale … not 'current at release
  time'";
- each record's `source` string ended "Confirmed 2026-07-25";
- nothing anywhere recorded when the attested half was last human-verified.

So a probe run on a day when a vendor window had silently moved would have re-stamped `confirmedOn`
over a stale date, and the gate would have reported it as a fresh confirmation.

**Owner ruling, 2026-08-07 — probe-based confirmation is ACCEPTED.** The probe _is_ the
confirmation and may legitimately re-stamp `confirmedOn`; no human-attestation field was added. What
changed is the wording, at all three sites a reader can arrive from:

| site                                                        | what it now says                                                                                                                                                          |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `e2e/provisioning/src/supportWindows.ts`, at the assignment | this is the probe date; what it does and does not attest                                                                                                                  |
| `e2e/attestation/src/versionSupportWindows.ts`              | reworded staleness reason, reworded `confirmedOn` doc, and a new `CONFIRMED_ON_PROVENANCE` block carrying the ruling and its limitation                                   |
| `docs/vendor-support-policy.json`                           | each `source` now says the date is transcribed by a human, that the probe does not re-read it, and carries the transcription date plus a verbatim quote of the vendor row |
| `scripts/check-support-window-freshness.mjs`                | the same limitation in its header, since this is now the lane a reader meets first                                                                                        |

**The limitation, stated unsoftened because an oversold control is how a check ends up trusted and
inert:** a fresh `confirmedOn` proves the probe ran and the pinned artifact still resolves at the
vendor registry. It does **not** prove the support-end dates are unchanged.

**The gate is NOT renamed**, and that is a considered call. `release-gate:jira-grafana-version-
support-windows` describes its subject accurately, and the roadmap criterion it evidences uses the
same words. What overclaimed was the message's implication of a human read, and that is what
changed.

⚠️ **Correction to this record's own first draft**, left visible rather than deleted: it also said
renaming would "re-derive the tag's requirement id". **That is false.**
`releaseRequirements.ts`'s `deriveRequirementId` hashes the criterion bullet text and nothing else;
a gate tag is only a lookup key in `CRITERION_TAG_RULES`, and this tag is not among the nine frozen
id literals at all. The subject-accuracy reason stands on its own.

## The auto-renewal hazard — what actually kept D1 from mattering

`.github/workflows/drift-ci.yml` runs `npm run probe:support-windows` weekly and uploads the
rewritten record as an **artifact**. The release gate reads the **committed** file. That distinction
is the only reason the 30-day bound meant anything — and **nothing pinned it**. One `git commit` step
in that workflow would have made the bound renew itself, silently and forever, and the gate would
have been green by construction.

The owner accepted probe-based confirmation and explicitly did **not** accept auto-renewal. That
line is now drawn mechanically: `scripts/check-support-window-freshness.mjs` fails if any workflow
both runs the probe (by npm script name **or** by its CLI module path) and can commit or push its
output (`git commit`, `git push`, `contents: write`, the common auto-commit actions, `gh pr create`).
RED-first: the real `drift-ci.yml` text with one commit step appended is flagged; the real one is
not; a workflow that commits but never runs the probe is not. **A refresh must land through a
deliberate, reviewable change.**

## The missing lane — measured, and the reason this was urgent at all

`checkVersionSupportWindows` has **no production caller**. Its only invocation anywhere is inside
`e2e/attestation`'s own suite, which runs solely under `npm run test:e2e:release-evidence` — the step
`.github/workflows/publish.yml` blocks on at a `v*` tag. `e2e/attestation` is not a
`vitest.config.ts` project, so nothing per-push ran it.

With every record at `confirmedOn: 2026-07-25` and a 30-day bound, the first failing cut date was
**2026-08-25**. Nothing would have said a word beforehand.

`scripts/check-support-window-freshness.mjs` now runs in `meta-checks`, warns from T-21 naming the
exact date each target turns the gate red, warns 90 days before a vendor window closes, and fails on
**the gate's own conditions and no stricter ones** — so it can never block a push for something no
release would have refused. Its limit and target set are read out of `versionSupportWindows.ts` by
the suite, so a warning lane calibrated against a different bound than its gate is impossible.

## D2 — a merged record quoted a value designed to expire

`docs/evidence/criteria-closeout/phase-23.json` c13 cites the record file and quotes
`"confirmedOn": "2026-07-25"` — a value the probe is **designed** to rewrite every 30 days — out of a
path the citation ratchet freezes (`docs/evidence/**`). So the citation was guaranteed to stop
resolving on a schedule. Measured before anything was changed:

```
BASELINE   md5 9d0f41ab853d827f5817a1f6831ea439   check:citation-content PASS  EXIT=0
RE-STAMP   6 × confirmedOn 2026-07-25 -> 2026-08-07
           check:citation-content FAIL  EXIT=1
             COMMITTED EVIDENCE UNDER docs/evidence/** HAS CHANGED — 1
             phase-23.json#c13#docs/evidence/phase-23/vendor-support-windows.json
                 OK-file/collapsed@6,15,24,32,41,50~repeat  ->  ABSENT@-
```

**Owner ruling 2 (2026-08-07): regenerate the baseline and file this record.** Done, and the diff is
disclosed rather than summarised — **7 lines total**: `generatedAtSha`, four count fields, and three
pin entries (one for the re-stamp, two for D1's reworded gate message). Nothing else moved. The
merged record itself was **not** edited: hard rule 4 forbids editing another pass's
`phase-*.json`, and the annotate-never-rewrite discipline forbids silently correcting it.

**Cost, stated plainly and counted:** **three fragments across two citations** stopped resolving, not
one — the earlier "only that one pointer is dead" understated it, and the 7-line baseline disclosure
two paragraphs above is the accurate account. Specifically: `phase-23.json` c13's quotation of
`"confirmedOn": "2026-07-25"` (one fragment, collapsed across six line positions), and its two
quoted lines of the staleness message at `versionSupportWindows.ts:164-165`, which this pass
deliberately reworded. The first will never resolve again — the quoted value is gone by design. The
second two are a reword, so they could in principle be re-quoted.

The record's _claims_ (six targets freshly confirmed at the cut; freshness enforced numerically as a
30-day bound) both remain TRUE and are both still evidenced by the same files. What died is where
they point.

### Why the real remedy was not taken now

**The real remedy is to re-quote c13 to a STRUCTURAL line rather than to the date** — e.g. the
`"target"` or `"lifecycle"` lines, or `versionSupportWindows.ts`'s `DEFAULT_MAX_RECORD_AGE_DAYS = 30`
— so the citation survives every scheduled refresh instead of expiring with each one. **Effort: S**
(one `quotedAssertion` edit plus a baseline regeneration).

It was not taken here for one reason: c13 is a **merged** record, and editing another pass's
closeout record is hard rule 4. The correct discharge is a coordinated edit by a pass that owns
phase-23's record, or an owner ruling that a merged closeout record may carry an appended dated
correction block. Filed rather than done, deliberately.

**The generalisable lesson, which is bigger than this record:** a citation whose quoted text is a
value some job is designed to rewrite is a citation with an expiry date. When a record cites a
generated or refreshed artifact, it should quote the artifact's **structure**, not its **contents**.
Nothing currently checks for that shape.

## ⚖️ The arm split — owner ruling 2026-08-07, correcting this record's own first remedy

The lane as first shipped **failed per-push** on a stale probe stamp, in a required `meta-checks`
step. From the 31st day after each probe run that would have turned **every pull request in the
repository** red until a human ran the probe — an escalation from "cannot cut a release" to "cannot
merge anything", for work unrelated to releasing. The condition was disclosed; the consequence was
not.

| arm                                      | risk it names                                          | per-push | at a release cut                                   |
| ---------------------------------------- | ------------------------------------------------------ | -------- | -------------------------------------------------- |
| stale probe stamp                        | we would be **shipping** on evidence nobody re-checked | **WARN** | **FAIL** (`checkVersionSupportWindows`, unchanged) |
| expired vendor window                    | this repo **pins** an out-of-support version, today    | **FAIL** | **FAIL**                                           |
| malformed record / auto-renewal offender | integrity error, not a clock                           | **FAIL** | **FAIL**                                           |

The release-time half is not a promise in a comment: the suite **imports the real gate** and drives
records through it, including a control that it does _not_ refuse one day earlier, and a sweep
proving this lane and the gate cross at the same day.

## ⚠️ A defect this PR introduced into itself, and the mechanism is this record's own subject

The reword changed the staleness message, and two assertions in
`e2e/attestation/src/versionSupportWindows.test.ts` matched the old phrase — **2 failed / 17 passed
(19)**. The full local gate was green and CI was green on both arches, 15/15, the entire time,
because `e2e/attestation` is not a `vitest.config.ts` project and `npm test` never runs it. That is
precisely the gap this record exists to describe, biting the change that describes it.

Fixed: both assertions now match the new wording and name the arithmetic rather than a phrase.
**The residual is unchanged and not claimed away** — nothing per-push runs that project, and the
next reword can break it the same way. What is new is that the per-push lane imports the real gate,
so at least the threshold agreement is checked on every push.

## Not claimed

- **No window has moved.** Re-derived in this pass rather than inherited: Docker Hub
  `grafana/grafana-oss:13.1.0` → 404 (record says `tagPublished: false`), `grafana-oss:12.4.0`,
  `jira-software:10.3` and `jira-software:11.3` → 200; and both vendor pages re-read, giving 10.3 →
  5 December 2026, 11.3 → 3 December 2027, 12.4 → 24 May 2027, 13.1 → 20 March 2027. All six match
  the record. **No fixture needed refreshing.**
- **Not claimed:** that the new lane makes the attested half verified. It does not, and the reword
  exists precisely to stop anyone believing it does.
- **Not claimed:** that `jira-cloud`/`grafana-cloud` publishing no per-version EOL was re-verified as
  a negative. It is transcribed from the cited pages and marked as such.

**Evidence:** `docs/evidence/phase-23/support-window-freshness-lane.txt`.
