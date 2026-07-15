# Phase 01 evidence

This directory is the local-equivalent evidence trail for
`roadmap/01-repo-bootstrap.md`'s exit criteria. **No GitHub remote is
configured for this repository yet** (see "Deviations" below), so every
exit criterion that the phase file describes as "evidenced by a CI run" is
instead evidenced here by the equivalent command run locally, with both its
raw invocation and its raw output captured verbatim in a `.txt` file.

Each file name is prefixed `wiN-` (work item N) or `exit-criteria-` and
describes what it captures. Where the phase's own choreography calls for
"failing-test-first," there is a `*-failing.txt` file captured **before**
the fix landed, and a corresponding `*-passing.txt` (or `*-passing-*.txt`)
file captured **after**.

## Deviations from a literal CI-evidenced phase

- **No GitHub remote exists.** `git remote -v` is empty; there is nothing
  to push a workflow run to. `.github/workflows/ci.yml` and
  `.github/workflows/engine-live.yml` are authored, and separately
  schema-validated with `@action-validator/cli`
  (`wi4-ci-workflows-schema-valid.txt`), but neither has ever executed as
  an actual GitHub Actions run. Every job they declare (`lint`, `typecheck`,
  `test`, `commitlint`, `engine-pin-lint`, `meta-checks`) has instead been
  run directly on this machine; see `exit-criteria-clean-state-full-gate.txt`
  and the `wiN-*` files for the equivalent local command + output.
- **ARM64 is untested on real hardware.** This development environment is
  `x86_64`/`linux` (`uname -m` → `x86_64`). The CI workflow's `lint`,
  `typecheck`, and `test` jobs each declare a
  `[ubuntu-latest, ubuntu-24.04-arm]` matrix, but the `ubuntu-24.04-arm`
  leg has never actually executed — there is no ARM64 host available here
  to run it on. Per phase 01's own Risks section ("ARM64 CI flakiness"),
  this is recorded here as an explicit deferral rather than silently
  waived: phase 23's own exit criteria are required to close it with
  real-hardware (or documented-substitute) verification before the
  `v1.0.0` tag.
- **Concurrent-worker interaction (spikes/).** Mid-session, the phase-00
  worker (owner of `spikes/**`) added `spikes/04-sandbox.mjs`, which trips
  one ESLint rule (`no-empty`). `spikes/**` is outside this worker's file
  ownership for phase 01 (see the phase-01 task brief's ownership list),
  so rather than editing that file or loosening any ESLint rule, the root
  `lint`/`lint:fix` npm scripts pass `--ignore-pattern 'spikes/**'` on the
  CLI (`package.json`) — `eslint.config.js`'s own rules are unchanged.
  `.prettierignore` similarly excludes `spikes/**`, `roadmap/**`,
  `docs/claude-code-adaptation.md`, `docs/interface-ledger.md`,
  `README.md`, and `CLAUDE.md` — every path this phase does not own — so
  this phase's `lint`/`format` gates never assert requirements on another
  worker's in-flight content.

## Design decisions recorded (not ambiguities — implementation details within this phase's authority)

- **Workspace package naming.** Roadmap phase files reference the 18
  packages only by filesystem path (e.g. `packages/contracts`) — no phase
  specifies an npm package-name scheme. This phase names the 17
  internal-only packages `@eo/<dir-name>` (e.g. `@eo/contracts`), each
  `"private": true` (never published independently). The one package
  meant to become the published product is `packages/cli`, whose
  `package.json` `"name"` is literally `engineering-orchestrator` — the
  exact name whose availability work item 6 checks — with
  `"publishConfig": { "access": "public" }` noted (per the phase's
  "Interfaces produced" bullet) but not yet exercised (`"private": true`
  still blocks any accidental publish before phase 23).
- **NOTICE copyright holder.** No specific person, company, or email is
  named anywhere in this repository. `NOTICE` uses the generic, standard
  OSS convention "Copyright 2026 The Engineering Orchestrator Authors" —
  the same pattern many Apache-2.0 projects use before a formal legal
  entity is designated. Trivially editable by the real owner later.
- **SECURITY.md contact.** Per the task brief's explicit instruction, no
  email address is invented. The private-disclosure route documented is
  GitHub's private vulnerability reporting feature (Security tab → "Report
  a vulnerability"), with a fallback of contacting "the repository owner
  directly through their GitHub profile" — a placeholder route, not a
  specific invented identity, and explicitly flagged in `SECURITY.md`
  itself as not yet live until a remote exists.
- **`.changeset/` left clean.** Work item 5's trial `changeset add --empty`
  and a hand-authored patch-level trial changeset for `@eo/contracts` were
  both run through `changeset version` for real (changesets has no
  `version --dry-run` flag) — see `wi5-changesets-trial.txt` for the full
  transcript, including the generated `CHANGELOG.md` — and then reverted
  (`packages/contracts/package.json` restored to `0.0.0`, the generated
  `CHANGELOG.md` deleted). `.changeset/` now contains only `config.json`
  and `README.md` (the `changeset init` skeleton), no pending changesets.

## Exit-criteria → evidence map

| Exit criterion (roadmap/01-repo-bootstrap.md) | Evidence file(s) |
| --- | --- |
| `npm ci && npm run build && npm test` exits 0 on a clean checkout; `lint`/`typecheck` separately green, Linux x86-64 | `exit-criteria-clean-state-full-gate.txt` |
| Same, green on ARM64, or explicit deferral recorded | This README's "Deviations" section above (no ARM64 host available) |
| All 18 packages compile empty via `tsc -b`, cold and incremental, zero circular references | `wi2-tsc-cycle-failing.txt` (cycle fixture, rejected), `wi2-tsc-cold-build-passing.txt`, `wi2-tsc-incremental-build-passing.txt` |
| Coverage gate fails below 80% line+branch on the work-item-3 fixture, passes once corrected | `wi3-coverage-gate-failing.txt`, `wi3-coverage-gate-passing-restored.txt` |
| Commitlint rejects the work-item-4 malformed-message fixture | `wi4-commitlint-noconfig-failing.txt` (before config), `wi4-commitlint-rejecting-passing.txt` (after config, plus the narrowed type-enum rejecting a default-but-excluded type) |
| `LICENSE`, `NOTICE`, `SECURITY.md`, `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, issue/PR templates exist, non-empty | `wi5-repo-hygiene-failing.txt`, `wi5-repo-hygiene-passing.txt` |
| Changesets skeleton produces a valid CHANGELOG.md entry from a trial `add` + `version` (dry-run-equivalent) | `wi5-changesets-trial.txt` |
| `docs/release-notes-prep.md` records a timestamped npm-name verdict | `wi6-release-notes-failing.txt`, `wi6-release-notes-passing.txt`, and `../release-notes-prep.md` itself |
| `engine-pin-lint` rejects the `^`-ranged fixture, passes on the real workspace | `wi7-engine-pin-lint-noexist-failing.txt` (check doesn't exist yet), `wi7-engine-pin-lint-fixture-and-real.txt` (fixture rejected; real workspace passes) |
| `engine-live` CI job exists, manually-triggered, description names the phase-06 `@live` suite | `.github/workflows/engine-live.yml` itself (committed artifact); schema-validated in `wi4-ci-workflows-schema-valid.txt` |

## Toolchain versions pinned (exact, no `^`/`~`) for this phase

`typescript@6.0.3` (pinned below the `7.x` line specifically because
`typescript-eslint@8.64.0`'s peer range is `>=4.8.4 <6.1.0` — `typescript@7.0.2`
is the npm `latest` tag but is not yet supported by the pinned lint
toolchain), `vitest@4.1.10`, `@vitest/coverage-v8@4.1.10`, `eslint@10.7.0`,
`typescript-eslint@8.64.0`, `eslint-config-prettier@10.1.8`,
`@eslint/js@10.0.1`, `globals@17.7.0`, `prettier@3.9.5`,
`@commitlint/cli@21.2.1`, `@commitlint/config-conventional@21.2.0`,
`@changesets/cli@2.31.0`, `@types/node@24.13.3`. `package-lock.json` is
committed for full reproducibility. No engine-bundling dependency
(`@anthropic-ai/claude-agent-sdk`) exists yet in any workspace package —
06 adds the first real target for `engine-pin-lint` to enforce against.
