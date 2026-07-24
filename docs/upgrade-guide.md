# Upgrade guide

**Status:** Phase 23 (release hardening) work item 9. Every mechanism described below is
cited from the shipped installer implementation (`packages/cli/src/installer/`,
`packages/plugin/`) and its evidence trail (`docs/evidence/phase-10/README.md`), plus the
engine-version-drift/re-baseline procedure this repository's own ground rules establish
(`CLAUDE.md`; `docs/engine-baseline.md`).

## Install

```
engineering-orchestrator install [--dry-run] [--json]
```

See `docs/operator-guide.md` §1 for the full description. The remainder of this document
covers upgrade, uninstall, and version-drift handling.

## Upgrade

```
engineering-orchestrator upgrade [--dry-run]
```

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
engineering-orchestrator uninstall [--keep-state]
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
`docs/engine-baseline.md` (currently **2.1.207–2.1.218** / SDK **0.3.207–0.3.218**). `doctor`
enforces a **version gate**: it refuses to proceed against a `claude --version` outside the
currently accepted range on the release host, rather than silently trusting an untested engine
(`docs/threat-model.md` §2, "Repudiation"; `roadmap/23-release-hardening.md`'s test-matrix
mapping, "Version drift" row: "Doctor refuses an untested `claude --version` on the release
host").

### Re-baseline procedure

When Claude Code ships a new version and the operator wants to move the accepted range
forward, the procedure this repository's own re-baseline already followed (2026-07-15 →
2026-07-24, extending 2.1.207–2.1.210 to 2.1.207–2.1.218) is:

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

This is not a hypothetical procedure — it is exactly what produced the current
2.1.207–2.1.218 range recorded in `docs/engine-baseline.md`, including one real behavioral
resolution along the way (the `CLAUDE_CODE_OAUTH_TOKEN` handoff-file auth path flipped from
UNRESOLVED to PASS once the owner populated the token file out-of-band — an environmental
resolution, not an engine-behavior change) and one deliberate retention decision (four
transcript fixtures were restored to their richer original captures rather than left at a
narrower incidental re-capture, since the underlying facts were confirmed unchanged either
way — see `docs/engine-baseline.md` §8's "Fixture-retention decision").

## `enabledPlugins` settings-key format

The real `claude` binary's `enabledPlugins` settings key is keyed by
**`<plugin-name>@<marketplace-name>`**, not the bare plugin name — verified live against
`claude` 2.1.218 (not assumed from documentation), per `docs/engine-baseline.md` §12:

```json
{ "enabledPlugins": { "engineering-orchestrator@engineering-orchestrator-marketplace": true } }
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
