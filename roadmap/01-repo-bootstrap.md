# Phase 01 — Monorepo bootstrap, toolchain & CI

| | |
|---|---|
| **Depends on** | — (none; runs in parallel with phase 00 — no shared artifact either direction) |
| **Unlocks** | 02 (direct — README's dependency graph draws only `P01 --> P02`); transitively, every phase through 23 via 02. 23's own header additionally lists 01 among its direct "Depends on" set (all phases) even though the simplified mermaid graph only draws 23's inbound edges from 15/19/21/22 — 23 re-verifies this phase's CI/workspace/licensing artifacts directly (see Interfaces produced). |
| **Sources** | original plan (monorepo layout, strict TS, Node 24 LTS, Apache-2.0 licensing, npm package name `engineering-orchestrator`); adaptation §0 (confirmed decision row 1: published OSS product from v1 — Apache-2.0 npm package + plugin marketplace, full installer/doctor/upgrade/uninstall polish); §1 Verdict (this phase sits entirely within the ~70–75% engine-agnostic carryover — no Claude Code engine fact is asserted here; see Risks) |
| **Primary package** | none — this phase scaffolds the workspace root and all 18 packages (Gap 3) as empty stubs; no phase-01 business logic lives inside any single package |

## Goal

Before this phase, the repository has no git history and no code — only `docs/` and `roadmap/`. When this phase is done, a git repository exists with a green CI pipeline enforcing lint, typecheck, an 80%-line+branch coverage gate, and conventional-commit hygiene, over an 18-package (Gap 3) strict-TypeScript npm workspace in which every package compiles empty; the Apache-2.0 licensing, contribution, and Changesets scaffolding a public npm package requires is in place; and the `engineering-orchestrator` npm name's availability is recorded. Every later phase adds real code inside an already-disciplined, already-enforced repository instead of retrofitting toolchain rigor after the fact.

## In scope

- npm workspaces layout — empty packages (`package.json` + `tsconfig.json` only, no source logic) for all **18** workspace members (Gap 3): `packages/contracts`, `packages/testkit`, `packages/engine-core`, `packages/journal`, `packages/supervisor`, `packages/engine-claude`, `packages/git-engine`, `packages/gateway`, `packages/renderer`, `packages/connectors-jira`, `packages/connectors-grafana`, `packages/detect`, `packages/scheduler`, `packages/gates`, `packages/perf`, `packages/learning`, `packages/cli`, `packages/plugin`. `packages/engine-core` is scaffolded empty here exactly like every other package; phase 03 implements it, it does not originate it (Gap 3).
- Root `tsconfig.base.json` (strict, `NodeNext`, `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`), per-package `tsconfig.json` with project references, root + per-package `engines: { node: ">=24" }`.
- Vitest workspace config + `@vitest/coverage-v8`; **80% line+branch coverage gate enforced in CI** (greenfield rule, README ground rules).
- ESLint + Prettier configs; commitlint with conventional-commit types `feat|fix|refactor|docs|test|chore|perf|ci`; lint-staged optional pre-commit wiring.
- Apache-2.0 `LICENSE`, `NOTICE`, `SECURITY.md` (private disclosure route), `CONTRIBUTING.md` (states the phase workflow: failing tests first, review, exit-criteria evidence), `CODE_OF_CONDUCT.md`, issue/PR templates.
- Changesets skeleton (config + version/publish scripts, empty `.changeset/`) for versioning and `CHANGELOG.md` generation; npm publish config (`access: public`; provenance flag noted, exercised at phase 23).
- CI (GitHub Actions): `lint`, `typecheck`, unit-test+coverage-gate jobs on Linux x86-64 + ARM64; a manually-triggered `engine-live` job placeholder that phase 06 wires to run the `@live`-tagged conformance suite (needs a host with `claude`) (Gap 15).
- **Engine-version pinning policy** (adaptation §0, Worker transport decision: "also pins a reproducible bundled engine version per release"): `@anthropic-ai/claude-agent-sdk` — and any future engine-bundling dependency — is declared with an exact version, never a `^`/`~` range; `package-lock.json` is committed; an `engine-pin-lint` CI check fails on any range specifier for the engine dependency. Policy and check are active from bootstrap; the first real target lands when 06 adds the SDK dependency. This build-time exact pin (which SDK version is bundled) is complementary to, not competing with, 06's runtime version-range gate (which host engine versions may run, per `docs/engine-baseline.md`'s accepted range).
- `docs/release-notes-prep.md` recording the `npm view engineering-orchestrator` package-name availability result (re-checked verbatim at phase 23's publication step).

## Out of scope

- Domain logic inside any of the 18 scaffolded packages — each owning phase implements its own (e.g., phase 02 implements `packages/contracts`; phase 03 implements `packages/engine-core`).
- `renderer-core` — a module living inside `packages/contracts`, not a 19th workspace package (Gap 3); its logic (length/line counters, attribution-token scanner) is phase 02 work item 6's job, not this phase's.
- Engine verification spikes, permission-rule probes, and `docs/engine-baseline.md` — owned by phase 00, which runs in parallel with no shared artifact either direction; this phase asserts zero Claude Code engine facts (see Risks).
- Plugin/marketplace packaging format, `.mcp.json`, `.claude/*` scaffolding, `CLAUDE.md` — owned by phase 10.
- Progressive coverage-ratchet logic and seeded-fault quality/security gate matrices — owned by phase 14 (`packages/gates`), built on top of the flat 80% CI threshold this phase establishes.
- Release automation beyond the Changesets skeleton, npm provenance execution, and the real `v1.0.0` publish — owned by phase 23, which also re-checks the npm name recorded here and closes any ARM64 deferral from this phase.
- Threat modeling and the first enforced security review gate — owned by phases 02 and 14/23 respectively.

## Interfaces produced

The workspace root and toolchain every later phase (starting with 02) builds inside. Every name below is the literal, stable identifier downstream phases reference by name.

- **18-package npm workspace** (Gap 3), each an empty compiling stub (`package.json` + `tsconfig.json`, project references, no source logic): `packages/contracts`, `packages/testkit`, `packages/engine-core`, `packages/journal`, `packages/supervisor`, `packages/engine-claude`, `packages/git-engine`, `packages/gateway`, `packages/renderer`, `packages/connectors-jira`, `packages/connectors-grafana`, `packages/detect`, `packages/scheduler`, `packages/gates`, `packages/perf`, `packages/learning`, `packages/cli`, `packages/plugin`. Every later phase's own "Primary package" header field names one of these paths byte-for-byte — none may be renamed without a coordinated cross-phase edit.
- **`tsconfig.base.json`** (root strict config: `NodeNext`, `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`) — every package's `tsconfig.json` extends it; structurally consumed by every phase that writes TypeScript (all of them).
- **Vitest workspace config + `@vitest/coverage-v8`**, 80%-line+branch CI gate — the test/coverage harness every phase's own test suite runs inside.
- **ESLint/Prettier/commitlint configs** (conventional-commit types `feat|fix|refactor|docs|test|chore|perf|ci`) — enforced on every later phase's commits.
- **CI skeleton** (GitHub Actions): `lint`, `typecheck`, unit-test+coverage-gate jobs on Linux x86-64 + ARM64, plus a manually-triggered **`engine-live`** job placeholder — the exact job phase 06 wires to run the `@live`-tagged conformance suite (Gap 15); inert here, no engine invoked.
- **`LICENSE`** (Apache-2.0) and **`NOTICE`** — consumed by phase 23's reproducible-build/provenance/publish step. **`SECURITY.md`**, **`CONTRIBUTING.md`**, **`CODE_OF_CONDUCT.md`**, issue/PR templates — repo-hygiene artifacts for human contributors; no phase consumes these programmatically.
- **Changesets skeleton** (`.changeset/config.json` + version/publish scripts) — the tool phase 23 executes to produce the real `v1.0.0` `CHANGELOG.md` entry.
- **`docs/release-notes-prep.md`** — the recorded `npm view engineering-orchestrator` name-availability verdict; phase 23 re-checks the same name against this record at publication.
- The initialized git repository itself (first commit) — the substrate every subsequent phase commits into. Not a schema/API-style interface; stated for completeness.

## Interfaces consumed

None. This phase's own header states **Depends on: —**. Per the README's dependency graph, `P01 --> P02` is the only edge touching phase 01, and it is outbound: phase 01 is the repository's origin point. It reads only the adaptation doc and the original plan — no other phase's schema, contract, tool name, or artifact. Phase 00's engine spikes run in parallel and produce no artifact this phase needs, and this phase produces no artifact phase 00 needs — the two are mutually independent.

## Work items

1. Initialize the git repository; author root `package.json` (npm `workspaces` glob spanning all 18 package paths, Gap 3's `packages/engine-core` included; `engines.node: ">=24"`), `.gitignore`, `.npmrc` (`access=public`) — failing-test-first: a smoke script asserting the workspace enumeration (`npm ls --workspaces --json` or equivalent) returns exactly 18 entries is written first and fails (zero workspaces declared) before the manifests exist.
2. Author `tsconfig.base.json` (strict, `NodeNext`, `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`) and, per package, a stub `package.json` + `tsconfig.json` (project references) + empty `src/index.ts`, for all 18 packages — failing-test-first: a deliberately circular two-package reference fixture is committed first and fails `tsc -b` with a cycle error; the real, acyclic reference graph replaces it and builds clean, both cold and incremental.
3. Wire Vitest workspaces + `@vitest/coverage-v8`, with an 80% line+branch threshold that fails the run below it — failing-test-first: a temporary fixture package exercised at 60% coverage is committed and the coverage step fails in CI; removing the fixture (or raising coverage) restores green.
4. Author ESLint/Prettier configs and commitlint (types `feat|fix|refactor|docs|test|chore|perf|ci`) + GitHub Actions workflows (`lint`, `typecheck`, unit-test+coverage-gate jobs on Linux x86-64 and ARM64; a manually-triggered `engine-live` placeholder job that phase 06 wires to run the `@live`-tagged conformance suite, Gap 15) — failing-test-first: a fixture commit message with no type prefix is asserted rejected by commitlint; the assertion itself fails (nothing rejects it yet) until the commitlint config lands.
5. Author `LICENSE` (Apache-2.0), `NOTICE`, `SECURITY.md`, `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, issue/PR templates, and the Changesets skeleton (`.changeset/config.json` + version/publish scripts) — failing-test-first: a repo-hygiene check asserting all required top-level files exist and are non-empty is written first and fails against the empty repo, then passes.
6. Run `npm view engineering-orchestrator` and record the availability verdict, timestamped, in `docs/release-notes-prep.md` — failing-test-first: a check asserting the doc exists with a recorded verdict fails before the doc is written.
7. `engine-pin-lint` CI check (adaptation §0's reproducible-bundled-engine decision): fails on any `^`/`~`/range specifier for `@anthropic-ai/claude-agent-sdk` (or any declared engine-bundling dependency) in any workspace `package.json` — failing-test-first: a fixture manifest declaring `"@anthropic-ai/claude-agent-sdk": "^2.1.0"` is asserted rejected, and the assertion fails (no check exists yet) until the check lands; the check then passes green on the real workspace, which declares no engine dependency at this phase (06 adds the first real target).

## Test plan

- **Unit** (meta-tests — this phase has no runtime business logic, so its "units" are the toolchain's own enforcement points): coverage-gate failure fixture (temporary 60%-covered package must fail CI; work item 3); commitlint fixture (a commit message with no type prefix must be rejected; work item 4); `tsc -b` reference-cycle canary (a deliberately circular two-package reference must fail cold build; work item 2); repo-hygiene check (required top-level files present and non-empty; work item 5); release-notes-prep presence check (work item 6); `engine-pin-lint` fixture (a range-specified `@anthropic-ai/claude-agent-sdk` manifest must be rejected; work item 7).
- **Property:** not applicable — this phase contains no algorithmic logic to fuzz. The first property-tested surfaces are phase 02's config-precedence resolver and canonical-error redaction.
- **Integration:** `npm ci && npm run build && npm test` against a clean checkout, executed in CI on both Linux x86-64 and ARM64 runners.
- **Conformance:** all 18 packages (Gap 3) independently pass `tsc -b`, cold and incremental, with zero circular project references; workspace enumeration returns exactly 18 entries.
- **Security:** not applicable at this phase — no runtime code, network access, or credential handling exists yet to attack; `SECURITY.md`'s disclosure route and `LICENSE`/`NOTICE` correctness are covered by the Unit repo-hygiene check above, not a separate security test. `docs/threat-model.md` is authored in phase 02; the first enforced security gate is phase 14, re-verified live at phase 23.

## Exit criteria

- [ ] `npm ci && npm run build && npm test` exits 0 on a clean checkout, and the CI `lint` and `typecheck` jobs are separately green — evidenced by a passing required CI run, on Linux x86-64.
- [ ] The same (build/test/lint/typecheck) is green on ARM64, or an explicit deferral is recorded in this file's Risks section and closed by phase 23's real-hardware (or documented-substitute) verification.
- [ ] All 18 packages (Gap 3) — the 17 originally enumerated plus `packages/engine-core` — compile empty via `tsc -b`, cold and incremental, zero circular project references — evidenced by the CI typecheck job log.
- [ ] Coverage gate fails CI against the work-item-3 fixture below 80% line+branch, and passes once corrected — evidenced by the recorded before/after CI run.
- [ ] Commitlint rejects the work-item-4 malformed-message fixture in CI — evidenced by the recorded failing CI run.
- [ ] `LICENSE` (Apache-2.0), `NOTICE`, `SECURITY.md`, `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, and issue/PR templates exist at repo root, non-empty — evidenced by the work-item-5 repo-hygiene check passing in CI.
- [ ] Changesets skeleton produces a valid (if empty) `CHANGELOG.md` entry from a trial `changeset add` + `changeset version` dry run — evidenced by the committed dry-run output.
- [ ] `docs/release-notes-prep.md` records a timestamped `npm view engineering-orchestrator` name-availability verdict — evidenced by the committed doc.
- [ ] `engine-pin-lint` CI check rejects the work-item-7 fixture manifest declaring a `^`-ranged `@anthropic-ai/claude-agent-sdk` and passes on the real workspace (which declares no engine dependency at this phase) — evidenced by the recorded failing/passing CI runs; 06's SDK dependency is the first real enforcement target.
- [ ] `engine-live` CI job exists, manually-triggered, and its description names the `@live`-tagged suite phase 06 will wire it to (Gap 15) — evidenced by the committed workflow YAML; the job itself remains inert (no engine invoked) at this phase.

## Risks & open questions

- **ARM64 CI flakiness.** ARM64 GitHub-hosted runners are newer and can be unreliable. Mitigation: if unavailable/flaky here, record the gap explicitly (this file's Exit criteria) rather than block; phase 23's own exit criteria require closing it with real-hardware (or documented-substitute) verification before the `v1.0.0` tag — not a silent waiver.
- **This phase asserts zero Claude Code engine facts.** The `engine-live` job is an inert placeholder; nothing in this file should be read as a claim about `claude` CLI flags, settings keys, hook events, or version behavior. Adaptation §10 risk 1 (weekly release velocity) is why real engine-version pinning and the conformance suite live in phases 00/06, not here. No verify-at-build-time engine items apply to this phase.
- **npm package-name collision.** If work item 6's `npm view engineering-orchestrator` shows the name already taken, this phase only records that verdict — a rename is a product decision escalated to the owner before phase 23's real publish, not resolved here. This is not one of resolutions.md's 15 adjudicated gaps; its "OWNER DECISIONS REQUIRED: None" refers to those 15, not to this distinct, forward-looking operational risk.
- **Package-list stability.** All 18 workspace paths are fixed here and referenced by literal path in every downstream phase's own "Primary package" header field; a later rename would require a coordinated edit across every phase file. Names are taken directly from the cross-phase ledger's own verified cross-check of actual phase-file usage (ledger §1), not guessed, to minimize this risk.
- **Dependency weight compounds downstream.** Phase 05's supervisor daemon owns an idle-budget perf harness (idle <100 MiB RSS, <1% of one core, 5 s heartbeat — its own exit criterion, re-measured at 23). This phase's 18 packages are empty stubs with no runtime dependencies, so no exit criterion here is affected; the note is a bias for later phases choosing dependencies (avoid heavyweight frameworks) that this phase's own toolchain choices (bundler-free TS project references, lean lint/test stack) are already consistent with.
