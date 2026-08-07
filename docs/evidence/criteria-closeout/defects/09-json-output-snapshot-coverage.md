# 09 — `cli.snapshots.test` does not snapshot every `--json` output schema

**Phase:** 09 — `roadmap/09-cli-and-doctor.md`, exit criterion 7.

**Criterion (verbatim):**

> Help text and every `--json` output schema are snapshot-stable — suite `cli.snapshots.test`.

**Found:** 2026-08-02, criteria-closeout pass (batch 2, phase 09), at `af46e007c1363d4838d74e2eea0d531e4d6bb4f3`.

## Gap

The help half of the criterion is fully met. The `--json` half is not.

`packages/cli/src/commands/cli.snapshots.test.ts` contains exactly six `toMatchSnapshot()` calls,
and the committed `packages/cli/src/commands/__snapshots__/cli.snapshots.test.ts.snap` holds exactly
19 entries:

| Snapshot entry                                                                                                                                                        | Covers                |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------- |
| `help text snapshots > top-level help (human)`                                                                                                                        | help                  |
| `help text snapshots > top-level help (--json)`                                                                                                                       | help                  |
| `help text snapshots > topic help … > topic-{approve,cancel,connection,doctor,evidence,gateway,install,learn,resume,run,status,trust,uninstall,upgrade}` (14 entries) | help                  |
| `--json output schema snapshots > NOT_IMPLEMENTED shape`                                                                                                              | the shared stub shape |
| `--json output schema snapshots > gateway mcp's tool-listing shape (empty registry)`                                                                                  | tool listing          |
| `--json output schema snapshots > gateway mcp's tool-listing shape (one registered tool)`                                                                             | tool listing          |

No snapshot exists for the `--json` output of `doctor`, `evidence`, `status` (either shape),
`cancel`, `run`, `approve`, `install`/`upgrade`/`uninstall`, `trust *`, `connection *`, or
`learn *`. `grep -rn "toMatchSnapshot\|toMatchInlineSnapshot" packages/cli/src` returns hits in that
one file only, and `git ls-files packages/cli | grep -i snap` returns that one `.snap`, so there is
no second snapshot surface elsewhere in the package.

This is **original, not drift**: `git show d0f29c8:packages/cli/src/commands/__snapshots__/cli.snapshots.test.ts.snap`
(this phase's own landing commit) contains the same three non-help entries and no others.

`docs/evidence/phase-09/README.md`'s mapping row for this criterion, and
`packages/cli/src/commands/cli.commands.schema.test.ts`'s own header comment, both state that
"`evidence`/`doctor`/`NOT_IMPLEMENTED` have no published schema anywhere … so snapshot stability
remains the correct mechanism for those three". Only one of those three is actually snapshotted.
That sentence is the repo asserting a coverage that does not exist.

### Why this is not a wording correction

Deleting "every" from the criterion would remove a guarantee rather than make the claim more
precise, which the closeout wording protocol explicitly forbids
(`docs/evidence/criteria-closeout/README.md`, "A correction that loses a guarantee is `UNMET`, not a
wording fix"). Hence the box stays unticked.

### Blast radius — what _is_ pinned, so the severity is read correctly

- `status --json` / `cancel --json`: validated against 05's real published zod schemas —
  `packages/cli/src/commands/cli.commands.schema.test.ts:98`, `:107`. Stronger than a snapshot.
- `status` (no run-id) `--json`: `cli.commands.schema.test.ts:134` — `expect(JSON.parse(result.stdout!)).toEqual({ runs: [] })`.
- `evidence --json`: `cli.commands.schema.test.ts:175-178` — exact `toEqual` for the empty report.
  Nothing pins a populated report's rendered shape.
- `doctor --json`: `cli.commands.schema.test.ts:190-191` — `expect(parsed.findings).toHaveLength(10)`
  and `typeof parsed.allPassed === "boolean"`. A count and a type, not a shape.
- The later-wired families (`trust *`, `connection *`, `learn *`, installer, `run`, `approve`) have
  per-command dispatch suites, but none asserts a stable serialized `--json` shape.

So a `--json` field rename in `doctor` or in any later-wired command's result would land with the
whole suite green. That is exactly the conformance drift this criterion exists to prevent.

### Search trail

- `roadmap/09-cli-and-doctor.md` §Test plan, Conformance — "snapshot tests for help text and every
  `--json` output schema, including `gateway mcp`'s tool-listing shape" (the criterion's source).
- `docs/evidence/phase-09/README.md` §Exit criterion → evidence mapping, last row — names
  `src/commands/cli.snapshots.test.ts` and nothing else.
- `packages/cli/src/commands/cli.snapshots.test.ts` (read in full), its `__snapshots__/*.snap`
  (19 entries enumerated above).
- Repo-wide: `grep -rn "toMatchSnapshot" packages/cli/src` → 6 hits, all in that file.
- `git show d0f29c8:…/cli.snapshots.test.ts.snap` → same three non-help entries at phase-landing time.
- `docs/interface-ledger.md` — no ruling governs the CLI's `--json` output shapes; nothing here
  contradicts the ledger.

## Severity

**evidence-channel-only, leaning blocking-guarantee for `doctor --json`.** No user-visible defect is
claimed. What is missing is the conformance pin the criterion names: the shapes this phase _owns_
(`doctor`, `evidence`, and every later-wired command's result) can change unnoticed. `doctor --json`
is the sharpest case because its only pin is a finding **count**, which two of the last three
merges already moved (`journal.head-anchor`, `journal.writer-separation` took the default set from
8 to 10, and `run-doctor.ts:50`'s doc comment still says "8-check default set").

## Proposed remedy

Extend `packages/cli/src/commands/cli.snapshots.test.ts` with a `--json` snapshot per command result
shape, built from the same fixtures `cli.commands.schema.test.ts` already constructs (a real
supervisor in a tmp dir is already stood up there, so the fixtures exist):

1. `doctor --json` against a fully-injected, deterministic check set — snapshot the finding _shape_
   (`id`/`severity`/`passed`/`evidence`/`repairStep` keys), not the host-dependent verdicts, so the
   snapshot is stable on any host.
2. `evidence --json` for both the empty and a two-record ChangeSet.
3. One snapshot per later-wired family's `--json` result (`install`, `trust review`,
   `connection list`, `learn list`, `run`, `approve`), each against its already-existing dispatch
   fixture.
4. While there: `run-doctor.ts:50`'s "8-check default set" comment is stale (the default set is 10)
   and `cli.commands.schema.test.ts:190`'s bare `toHaveLength(10)` should assert the check **ids**,
   so the next doctor check to land cannot silently displace one.
5. Also while there — an adjacent unpinned-string gap this closeout disclosed under criterion 3, and
   the same failure mode one level down. `doctor.fault-matrix.test.ts` pins the `repairStep` string
   exactly for the bwrap case and both journal variants, and via `:256-259` for the check that owns
   the socket case. It does **not** pin two that exist in source and nothing asserts:
   `hermeticity-selftest.ts:124-126` ("investigate why filesystem settings sources are being loaded
   despite `settingSources: []`") — the rogue-settings case at `:80-91` asserts only the evidence
   string — and `engine-version.ts:86`/`:95` ("install a Claude Code version within …") — the
   wrong-version case at `:63-65` asserts only `expect(finding.repairStep).toBeDefined()`. Assert
   both as complete strings, in the style rounds 17-18 already settled on for the xdg-permissions
   step, so the evidence cannot drift from the remedy it must agree with. Criterion 3 is ticked on
   detection, which is fully evidenced; this closes the "with a correct repair plan" half for the
   last two fixtures where only the check's source, not a test, says what the plan is.

Effort **S** (one test file plus its `.snap`, and two assertions added to an existing one; every
fixture already exists). Needs no CI job, no live engine, and no owner input.

**Ticket-ready:** yes.

## Remedied 2026-08-07 — 19 snapshot entries to 51, with the narrowings disclosed

PR #115 took this record's own S-sized remedy. The committed `.snap` went from 19 entries to 51,
covering all 22 `ParsedCommand` members that extend `JsonFlag`; the twenty-third declares no
user-facing flags and its stdio shapes were already snapshotted. The 16 help entries are unchanged,
so the criterion's already-met help half does not regress. Evidence:
`docs/evidence/phase-09/probe-09-383-batchA.txt`.

The measurements that make those entries evidence rather than decoration are the four vacuity probes
(V1–V4): an extra key on every doctor finding, a reversed finding order on the `--json` render path
only, two reworded `repairStep` strings, and an added key on `learn list --json` each left the whole
`packages/cli` suite **completely green** beforehand, and each reddens afterwards (P1a–P1d). The
named expected-green control is `learn-command-backend.test.ts`, whose `toMatchObject` passes for an
extra-keyed payload where a snapshot cannot — and that difference is exactly the value the snapshot
adds, measured rather than asserted.

**The three narrowings are restated here verbatim from transcript §7**, because they are what a
reader has to be able to disagree with: (i) `run --json` is one payload shape whose two unsnapshotted
content arms produce the identical field set to the snapshotted escalate arm; (ii)
`status --watch --json` is byte-produced by the same `formatJson(result)` expression as the
snapshotted non-watch branch; (iii) `status <run-id> --json` for an unknown run serializes to `{}`,
so that entry pins an empty object rather than the populated `RunStatusResult` shape, which is pinned
instead by the router's own result-schema wrap — strictly stronger than a snapshot, but in a
different package from the one the criterion names.

> **Corrected 2026-08-07 after review, and measured rather than re-reasoned.** This sentence previously attributed the populated-shape pin to `cli.commands.schema.test.ts`'s `RunStatusResultSchema.parse`. That attribution was FALSE and the review was right: that case dispatches `status` for a UUID against an empty `createRunsRegistry()`, so the payload it parses is `{}` — the very thin payload narrowing (iii) discloses — and `z.object({ run: RunRecordSchema.optional() }).strict()` accepts `{}` whatever its members are called. Probe, with a COMPILING mutation so nothing measured stale `dist/` (`npm run build` exit 0): tightening `RunRecordSchema.updatedAt` so a populated record fails its parse reddens 4 of 1574 — `build-router.test.ts`'s populated `run.status` case, both `compose-supervisor.test.ts` recovery cases and the concurrent `uds-server` case — while `cli.commands.schema.test.ts` stays GREEN. That asymmetry is what proves the old attribution vacuous and the new one load-bearing, and it also shows the wrap fires on the production dispatch path rather than only in a test. Restored by explicit source and path; md5 back to baseline, 1574 tests back, `git status` clean.

**Residual, named so it cannot drift:** no case in `cli.snapshots.test` snapshots a **populated**
`RunStatusResult`, and `status (no run-id) --json` snapshots a `runs` key holding an empty array,
which pins no element shape either. Closing that is one S-sized case in the named suite. The box was
ticked anyway, on this repository's own roadmap/06 precedent — a criterion whose guarantee is met
while its named suite does not carry it stays ticked and the pointer gap is recorded — and this
paragraph is that record.

**Two corrections to this record's own earlier text, both measured rather than argued.** The id-set
rider's stated justification, that the next doctor check to land must not silently displace one, is
already discharged **at the builder** by `packages/cli/src/doctor/run-doctor.test.ts:17-31`, which
asserts the exact ordered id list against `buildDefaultDoctorChecks`; reordering it reddens that test
today. What was genuinely unpinned is the ids as rendered through the `doctor --json` **dispatch**
path, which is what this criterion governs and what the shipped assertion pins. And the "8-check
default set" comment listed under remedy item 4 was already corrected on `main` by PR #66, so it is
no work item and the credit is not this wave's. §8 of the transcript records the line drift this
change caused in `cli.snapshots.test.ts`, and §9 is a dated correction to that transcript's own
units — a `<uuid>` count reported as occurrences was a line count.
