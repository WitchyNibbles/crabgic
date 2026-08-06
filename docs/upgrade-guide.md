# Upgrade guide

**Status:** Phase 23 (release hardening) work item 9. Every mechanism described below is
cited from the shipped installer implementation (`packages/cli/src/installer/`,
`packages/plugin/`) and its evidence trail (`docs/evidence/phase-10/README.md`), plus the
engine-version-drift/re-baseline procedure this repository's own ground rules establish
(`CLAUDE.md`; `docs/engine-baseline.md`).

## Install

```
crabgic install [--dry-run] [--json]
```

See `docs/operator-guide.md` §1 for the full description. The remainder of this document
covers upgrade, uninstall, and version-drift handling.

## Upgrade

```
crabgic upgrade [--dry-run]
```

### Before upgrading

Two rulings that were previously recorded only in design documents
(`roadmap/24-*.md` §Risks & open questions, "Upgrade migration";
`docs/interface-ledger.md` Gap 21) and never reached this guide. Both matter at the
upgrade boundary and nowhere else.

**1. Finish or cancel in-flight runs first.** Pre-phase-24 `ChangeSet`s carry no
`criteriaHash` and no approval seal, and the new verification fails them closed. The
ruling is to drain rather than grandfather: runs are short-lived, and restart-resume of a
parked run is already unsupported (`CHANGELOG.md`, v1.5.0). No enforcement epoch is
implemented deliberately — an epoch constant is a standing foot-gun, and this project has
no years of live state to justify one.

Today that drain is manual. For each run you started:

```
crabgic status <run-id>       # wait for published_local, failed, blocked, or cancelled
crabgic cancel <run-id>       # or stop it outright
```

`published_local` is the successful end state; `failed`/`blocked`/`cancelled` are the
three named terminals (`packages/contracts/src/state-machines/run-lifecycle.ts`). A run
sitting in `running`, `verifying`, `integrating` or `final_verifying` is still in flight.
Upgrade only once every run is in one of those four absorbing states.

The wait above is only worth making for a run that can still reach one. Since 2026-08-02 a
run whose DAG ends in failure settles itself (`failed`/`blocked`/`cancelled`, operator-guide
§3.1), so the first command genuinely terminates; a run that sits in `running` while
`crabgic resume` refuses it has nothing left to dispatch, and the second command is the
one to use.

> A supervisor-side `drain` — one call that stops accepting new work, waits for the
> detached drives to settle, and only then releases the journal lease — is landing
> separately. Until it does, the sequence above is the whole mechanism; this section will
> name the command once it exists.

**2. A replayed `requestKey` across the upgrade reports `conflict`, by design.** Intake is
idempotent on `(requestKey, requestContentHash)`, and the content hash covers the fields
the request actually carries. Version 1.5.0's `IntakeRequest` carried
`performanceBudgetSource` and `performanceBudgets`; the next version derives both and
removed the fields (ledger Gap 21). The same intake document therefore hashes differently
before and after the upgrade, and re-running it under its old `requestKey` is a _content
conflict_ — intake refusing to mint a second `ChangeSet` under an identity that already
has one, which is exactly what that check is for. It is not data loss and nothing is
overwritten.

The remedy is a fresh `requestKey` for the re-run, or the amendment flow
(`packages/supervisor/src/intake/amendment.ts`) if you are changing an
already-approved envelope. Runs completed before the upgrade are unaffected — their
`ChangeSet`s already exist.

### Add-only merge (10's mechanism)

Every artifact the installer manages (`CLAUDE.md`'s managed block, `.claude/settings.json`,
`.mcp.json`, `.claude/agents/eo-*.md`) is merged, never overwritten wholesale. The merge
writer is **add-only and idempotent**: install → upgrade → uninstall preserves every
user-added key across the whole cycle, and a security-relevant key already present at a
stricter-than-default value is never loosened. This is proven by a fast-check property test
fuzzing key presence/absence/value combinations against the real merge functions
(`docs/evidence/phase-10/README.md`, exit criterion 2:
`packages/cli/src/installer/merge.monotonic.property.test.ts`, 200–500 runs per property).

An adversarial-review pass found and fixed a real monotonicity violation here: the
`enabledPlugins`/`mcpServers` "is this key absent?" check used to test for a plain-object
shape rather than mere key presence, so a present-but-non-object value (e.g. a user who had
manually set `enabledPlugins` to a string) was wrongly treated as absent and silently
overwritten. Fixed — presence is now checked by key existence, at any value/type, before any
write is attempted (`docs/security-posture.md`, "4. Installer"; regression coverage in
`settings-merge.test.ts`/`mcp-entry.golden.test.ts`).

### Drift detection

`doctor` (and `upgrade` internally) compares each managed artifact's on-disk checksum against
the installer's own recorded state. A seeded single-byte mutation in any of `CLAUDE.md`,
`settings.json`, `.mcp.json`, or any `eo-*.md` agent file is flagged as drift
(`docs/evidence/phase-10/README.md`, exit criterion 4:
`packages/cli/src/installer/drift.fixtures.test.ts`). Drift detection is **whole-file**, not
per-managed-region — a hand-edit anywhere else in one of these files (an unrelated key added
to `settings.json`, or prose written elsewhere in `CLAUDE.md`) is currently indistinguishable
from drift in this installer's own content. This is a disclosed, accepted imprecision, not a
silent gap: it only ever causes **over-preservation** (a stale managed block can outlive an
uninstall), never destruction of a user edit (`docs/evidence/phase-10/README.md`, "Explicit
carry-forward (a)").

A CRLF/LF line-ending normalization is explicitly **not** treated as drift.

### Rollback and interrupted-upgrade recovery

`upgrade` takes a backup before mutating any managed artifact. If the process is interrupted
mid-upgrade (killed, crashed), a subsequent invocation recovers via
`recoverInterruptedUpgrade`, restoring the pre-upgrade backup. This path is proven against a
real kill-mid-write fixture as part of the installation matrix
(`docs/evidence/phase-10/README.md`, exit criterion 1: "empty dir, invalid `.git`, unborn
HEAD, dirty repo, monorepo, config drift, interrupted upgrade, rollback, uninstall preserving
user edits" — all run end-to-end against real tmp git repos).

An adversarial-review pass found and fixed a "double interruption" edge case: if the recovery
process **itself** was killed after deleting its own backup but before clearing the upgrade
marker, a subsequent recovery attempt threw an unhandled `ENOENT` trying to read the
already-deleted backup. Fixed — a missing backup on restore is now treated as "already
restored/cleaned by a prior partial recovery attempt," a documented no-op, never a throw;
`recoverInterruptedUpgrade` is now safe to call any number of times
(`docs/evidence/phase-10/README.md`, "Adversarial-review fixes", finding 3).

## Uninstall

```
crabgic uninstall [--keep-state]
```

Restores every managed artifact's recorded pre-install snapshot verbatim (or deletes the file
entirely if it never existed before install), rather than attempting to surgically strip only
the installer's own additions from a merged file — a deliberate design choice favoring
robustness over precision (`docs/evidence/phase-10/README.md`, "Explicit carry-forward (c)").
An artifact whose checksum shows drift relative to the recorded snapshot is reported and
**preserved**, drifted content and all, rather than silently discarded — `uninstall` never
destroys content it cannot confidently attribute to its own prior install.

**Never sweeps ignored files or secret-pattern content into a first commit.** For a non-Git
target project, `install` only runs `git init` after explicit approval, and the installer
never sweeps ignored/secret-shaped files into that first commit
(`docs/threat-model.md` §4, "Information disclosure").

## Engine-version-drift handling

This system pins its accepted Claude Code / Agent SDK version range in
`docs/engine-baseline.md` (currently **2.1.207–2.1.220** for the `claude` CLI / SDK
**0.3.207–0.3.218**). `doctor` enforces a **version gate**: it refuses to proceed against a
`claude --version` outside the currently accepted range on the release host, rather than
silently trusting an untested engine (`docs/threat-model.md` §2, "Repudiation";
`roadmap/23-release-hardening.md`'s test-matrix mapping, "Version drift" row: "Doctor refuses
an untested `claude --version` on the release host").

**The two ranges are deliberately asymmetric — do not "sync" them.** Only the CLI transport
(`claude` resolved from `PATH`) is accepted up to 2.1.220. The SDK transport runs the engine
binary bundled with `@anthropic-ai/claude-agent-sdk` **0.3.218**, which reports
`2.1.218 (Claude Code)`, so the SDK range stops at 0.3.218 and `EXPECTED_SDK_PIN`
(`e2e/release/src/enginePinCheck.ts`) stays `0.3.218`. The 1:1 release correspondence between
the two version lines (`0.3.218`↔`2.1.218`) describes how the vendor ships them, not an
obligation to move both ranges together: bumping the SDK dependency is a separate act with its
own evidence requirement (`docs/engine-baseline.md` §10, final bullet). Note also that the
**accepted range and the tested version are different things** — `TESTED_ENGINE_VERSION`
(`packages/engine-claude/src/version-gate.ts`) remains `2.1.218`, because that is the version
the recorded probe verdicts were actually produced at.

### Re-baseline procedure

When Claude Code ships a new version and the operator wants to move the accepted range
forward, the procedure this repository's own **full** re-baseline already followed
(2026-07-15 → 2026-07-24, extending 2.1.207–2.1.210 to 2.1.207–2.1.218) is:

1. Bump the SDK dependency in `spikes/package.json` to the matching `0.3.x` release (the SDK
   bundles its own pinned native `claude` binary per-platform — this is independent of
   whatever `claude` is on `PATH`; re-baselining requires bumping this dependency, not just
   upgrading the system binary) and reinstall.
2. Re-run the full probe suite (`spikes/README.md`'s documented procedure) against the new
   version.
3. Compare every sub-probe's verdict against the prior baseline. If **every** PASS verdict
   reproduces with **zero** FAILs and **zero** observed behavioral deltas (permission
   semantics, hermeticity, sandbox shapes, structured-output shape, session semantics, tool
   catalog), the accepted range is **extended** rather than re-pinned to a fresh point.
4. If any probe surfaces a genuine behavioral delta, the range must be **narrowed** at the
   version where the delta first appears — a spanning range must never silently cross a
   changed fact (`docs/engine-baseline.md` header, this repository's own ground rule).
5. Update `docs/engine-baseline.md` itself with the new range, the re-run date, and every
   changed/reconfirmed fact, citing the exact fixture files regenerated.

This is not a hypothetical procedure — it is exactly what produced the 2.1.207–2.1.218 span of
the accepted range recorded in `docs/engine-baseline.md`, including one real behavioral
resolution along the way (the `CLAUDE_CODE_OAUTH_TOKEN` handoff-file auth path flipped from
UNRESOLVED to PASS once the owner populated the token file out-of-band — an environmental
resolution, not an engine-behavior change) and one deliberate retention decision (four
transcript fixtures were restored to their richer original captures rather than left at a
narrower incidental re-capture, since the underlying facts were confirmed unchanged either
way — see `docs/engine-baseline.md` §8's "Fixture-retention decision").

**The range's current 2.1.220 upper end did NOT come from this procedure**, and an operator
reading the range should not assume it did. On 2026-07-25 the host's `PATH` `claude` moved to
2.1.220 — outside the then-accepted range, i.e. a re-baseline trigger — and the owner chose to
extend the accepted range to 2.1.220 rather than pin the host back. That round was
deliberately narrow: **no spike was re-run, no fixture was regenerated, the verdict tally is
unchanged (and remains a set of 2.1.218 figures), and the invalidation list was not re-checked
item-by-item.** Nothing therefore passed "at 2.1.220" in the spike-suite sense; the two facts
that round did record were gathered outside the eight-script suite
(`docs/engine-baseline.md` §14, §15). A full-suite re-run at 2.1.220 — which requires bumping
`spikes/package.json` to the SDK release matching 2.1.220 and reinstalling, per step 1 above,
since upgrading the system binary alone does not change what the SDK transport runs — is
recorded as **owed** (`docs/engine-baseline.md` §11). Treat the range's upper end as resting
on a weaker evidentiary base than its 2.1.218 point until that re-run lands.

## `enabledPlugins` settings-key format

The real `claude` binary's `enabledPlugins` settings key is keyed by
**`<plugin-name>@<marketplace-name>`**, not the bare plugin name — verified live against
`claude` 2.1.218 (not assumed from documentation), per `docs/engine-baseline.md` §12:

```json
{ "enabledPlugins": { "crabgic@crabgic-marketplace": true } }
```

The installer composes this key from the committed `marketplace.json`'s own `name` field via
`packages/plugin/src/enabled-plugin-key.ts`'s `ENABLED_PLUGIN_KEY` export — never a
hand-typed literal — with a citation test that fails if the two ever drift
(`docs/evidence/phase-10/README.md`, "Engine-fact verified live"). If a future engine version
changes this key's composition (e.g. drops the `@marketplace` suffix, or uses a different
separator), that is a baseline-invalidating event per `docs/engine-baseline.md` §10 — re-verify
against `docs/evidence/phase-10/README.md`'s exact procedure (`plugin marketplace add` →
`plugin install <name>@<marketplace>` → `plugin enable <name>@<marketplace>`, against a
scratch `HOME`) and update both `docs/engine-baseline.md` §12 and
`packages/plugin/src/enabled-plugin-key.ts`'s own citation test.

## Marketplace / plugin trust

The marketplace listing (`marketplace.json`) is **SHA-pinned**; a vendored
`--plugin-dir`/`--plugin-url` install is **digest-pinned**; `doctor` reports drift on an
unpinned source or a stale digest with a non-destructive repair plan
(`docs/evidence/phase-10/README.md`, exit criterion 5). The plugin bundle itself passes
12's capability-quarantine pipeline before release publication — see
`docs/security-posture.md` and `docs/compatibility-matrix.md`'s reproducible-build section for
the release-cut specifics.

---

## Release-candidate evidence anchor (2026-08-06)

Appended by the closeout pass for roadmap/23's release-docs criterion. Everything above is left
byte-identical.

**The release candidate** is `6b9dd7b` (`crabgic@1.5.0`, current `latest`). Its CI is run
[30581597639](https://github.com/WitchyNibbles/crabgic/actions/runs/30581597639); its blocking
gate is job 91004033370 of the `publish` run
[30581930006](https://github.com/WitchyNibbles/crabgic/actions/runs/30581930006), which scored
the checklist `final`, 15 PASS / 0 FAIL. The same anchor rule as the operator guide applies to
the `packages/**` test files cited above, checked file by file rather than in bulk: this guide
names two, and **both** ran green at the candidate in `CI / unit-test+coverage (ubuntu-latest)`
job **91002998119** — job-log line 923
` ✓  crabgic  src/installer/merge.monotonic.property.test.ts (5 tests) 189ms` and line 965
` ✓  crabgic  src/installer/drift.fixtures.test.ts (7 tests) 44ms`. Byte-compared under the
one-space rule in `docs/evidence/phase-23/closeout/c14-release-docs-citations.txt`.

### Correction — a dangling cross-reference in "Marketplace / plugin trust"

That section points a reader at "`docs/compatibility-matrix.md`'s reproducible-build section".
**There is no such section.** `docs/compatibility-matrix.md` has nine headings and none of them
is about reproducible builds; its only two occurrences of "reproducible" are unrelated. The
sentence is left verbatim; this is where it is corrected.

The release-cut reproducible-build record is, instead:

- the archived final report's own item —
  `docs/evidence/phase-23/closeout/release-gate-report-final-6b9dd7b.json:1553` is
  `      "id": "reproducible-build",` and `:1556` is `      "verdict": "PASS",`, over three
  linked records tagged `release-gate:reproducible-build`;
- the checklist that defines the item, `e2e/report/src/checklist.ts`;
- and, at the candidate itself, job-log lines 863-865 of job 91004033370 —
  ` ✓ src/reproducibleBuildCheck.test.ts (8 tests) 2035ms`, with its two named cases: the
  byte-identical-tarball case and its fail-first proof that perturbing one checkout by a single
  byte fails the real comparator.

**One disclosure a reader should carry away with it.** The SHA-pinned marketplace clause passed at
the `2435cb9` candidate only because that run's checkout was two commits ahead of the commit it
attested; at `6b9dd7b` checkout and candidate are the same commit, which is why the `6b9dd7b`
report is the one to cite.
