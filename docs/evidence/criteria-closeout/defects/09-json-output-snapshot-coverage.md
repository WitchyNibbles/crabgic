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

Effort **S** (one test file plus its `.snap`; every fixture already exists). Needs no CI job, no live
engine, and no owner input.

**Ticket-ready:** yes.
