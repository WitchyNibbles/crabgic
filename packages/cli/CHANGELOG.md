# crabgic

## 1.4.0

### Minor Changes

- 441fb42: Replace the unbounded adversarial review loop with a staged pipeline that terminates, and harden every hardened-open site in the product.

  **The review loop can now end.** The previous design closed a round only when a reviewer produced no finding that was both novel and falsifiable, with no severity floor and no cap. Twelve rounds against one subsystem measured what that costs: every round produced a genuine, reproducible finding, severity fell the whole way, and it never converged. Novelty and falsifiability exclude _manufactured_ findings, which is what they were for — they do not bound the supply of genuine ones, so the criterion measured reviewer exhaustion rather than artifact quality. The reviewer charter also said "do not approve it", leaving it no way to say _done_.

  Termination is now the artifact against written per-stage exit criteria, carried as data with stable ids. A finding blocks only by naming the criterion it violates; one that violates none is advisory. Every finding at any severity carries a disposition that can never be empty, so a stage cannot advance holding an unanswered finding — `advisory` defers a finding and never disposes of one, and debt deferred that way becomes blocking again the moment a later change set touches the code it concerns. Rounds continue only while each closes a blocking finding, then escalate to the owner rather than looping.

  **Closure is computed, not asserted.** The new `review.submit` gateway tool takes a reviewer's findings and decides whether the stage may close. Planned writes come from the change set's own envelope and prior findings from a durable store, so a reviewer cannot understate what it touches to dodge deferred debt, and a clean round cannot erase somebody else's open blocker. The gate-decidable criterion is derived from journaled evidence and subtracted from whatever the caller claimed — gates that never ran are not gates that passed.

  **The classifier says whether it has ever been checked.** The blocking/advisory split is a judgement, and an uncalibrated judge is decorative. Every review result now reports Cohen's kappa against the owner's own recorded judgements, with a corpus store to record them in and a refusal to call anything calibrated on fewer than twenty samples. A fresh project scores zero, which is honest; what would not be honest is returning verdicts without saying nobody has looked.

  **Security fixes, each proven against the built binary.** `doctor` could be made to overwrite an arbitrary file while reporting the sandbox healthy, and a FIFO at the standing-policy path froze it for thirty-six seconds — ignoring SIGTERM, needing SIGKILL, printing nothing — on the code path the dispatch daemon uses. A symlink one directory above the approval signing key put that key in an attacker's directory. Five separate hardened-open implementations had drifted into two behaviours; there is now one, refusing a symlink, a hardlink, a FIFO and a foreign owner, and verifying every directory component below the state root.

  New agents ship for the pipeline's design and plan stages, and the reviewer takes a lens per round rather than repeating one hostile pass.

- aeeb77c: Replace per-ChangeSet approval with a standing `EnvelopePolicy`, and close the loop between an approved change set and a run.

  `crabgic install` now derives an authorization policy from the repository, renders it in full, and writes it `0600` into the project's XDG state directory — never the repo, since a committed standing grant is one every clone would carry. Every dispatch is then checked for containment in it: inside, the run proceeds with no prompt and no token; outside, it is refused before a run exists, so fixing the policy and dispatching again just works. The policy also narrows the compiled worker sandbox, which is what makes standing approval sound rather than nominal — without it a worker's allow-listed test command could reach the whole worktree through a child process. Nothing reachable from a manager session can write or widen the policy, and `crabgic doctor` fails a policy that grants nothing.

  This also fixes three defects found by auditing the shipped binary. Nothing in the system ever created a run record, so an approved change set had no execution path at all — `run.dispatch` now takes a change set and returns the run id it mints, and `crabgic resume` targets a separate `run.resume`. `crabgic status`, `resume` and `cancel` exited `0` with no output whenever the daemon was not already running, instead of reporting that it was unreachable. And run-lifecycle transitions performed a read-modify-write across an await, so a cancel racing a starting run could write two conflicting states into the journal.

  Fresh worktrees now get their dependencies provisioned, without which `npm run test` and `npm run build` — two of the four commands a worker can ever be granted — failed in every worktree. And the manager session is taught a behaviour it did not have: research and clarify with the owner until the contract's sections are all answerable. The review half of that work is described in its own changeset.

  Also hardens the standing policy against a local attacker: the writer can no longer be tricked into destroying an arbitrary file through a predictable temporary name, the loader validates the file it actually read rather than the path it was given, and a policy that grants nothing is now reported by `crabgic doctor` instead of passing every structural check while refusing every run.

## 1.3.0

### Minor Changes

- a2bd006: Add a presentation policy for owner-facing output.

  Crabgic now formats what it says to its owner under an explicit contract:
  answer first, headings past five lines, bullets and tables over paragraphs, a
  fixed semantic glyph vocabulary (✅ ❌ ⚠️ 🛑 ⏳ 🔄 ⏸️ ❓ 📎 ℹ️) instead of ad-hoc
  markers, and colour by verdict. This is an accessibility requirement, not a
  style change.

  - New `presentation` module in `@crabgic/contracts`: the glyph vocabulary with
    `emoji`/`text`/`ascii` profiles, a 256-colour role palette sharing the status
    line's hues, `HUMAN_REPORT_LIMITS`, and `resolvePresentation()`.
  - New human-mode stdout primitives in the CLI (`renderStatusLine`,
    `renderHeading`, `renderBullets`, `renderKeyValues`, `renderHumanReport`) —
    status lines coloured by verdict, leads and headings bold, scaffolding dimmed.
  - `status --watch` gains an optional presentation context. Its default is
    unchanged: piped and redirected output is byte-identical to before.
  - The manager session's `CLAUDE.md` operating protocol gains reporting rules,
    quoted from the policy rather than restated.

  Selection: `emoji` + colour on a TTY, monochrome `text` when piped, `ascii`
  under `CRABGIC_ASCII=1`. `CRABGIC_PRESENTATION=emoji|text|ascii` forces the
  glyph profile; `CRABGIC_COLOR=1|0` forces colour on (even when piped) or off;
  `NO_COLOR` disables colour without touching structure.

  Colour is additive only — stripping the escapes from any coloured render
  reproduces the monochrome render byte for byte, so nothing is visible in colour
  alone. `--json` output is untouched, and outbound artifacts (PR, commit, Jira,
  Grafana) remain neutral and emoji-free under `CommunicationPolicy`.

  See `docs/presentation-policy.md`.

## 1.2.0

### Minor Changes

- 153e3c6: Give the manager session an operating protocol, and enforce the autonomous half of it.

  Installed projects previously received a managed `CLAUDE.md` block that listed the plugin's
  capabilities and said nothing about how to operate. With no instruction to the contrary a Claude
  Code session uses its conversational default and checks in after every step — the opposite of a
  harness whose own design names seven, and only seven, conditions that may halt a run.

  - **New: the manager operating protocol.** Autonomy by default, roadmap/11's seven stop conditions
    as the only legitimate halts, the approval gates, and `AskUserQuestion` as the way to put a
    decision to the owner — never a plain-text list of numbered options. Written once in
    `manager-protocol.ts`, rendered into the managed `CLAUDE.md` block and into a new
    `/eo:protocol` skill that carries the long-form rationale.
  - **New: the Stop autonomy gate.** A deliberately blocking `Stop` hook that refuses to end a turn
    while a run is in flight, so the autonomy clause is enforced rather than merely requested. It
    allows the stop at `awaiting_approval` (a human gate is legitimately open) and at every terminal
    state, cannot loop (`stop_hook_active`), and fails open on every error path — no supervisor, no
    runs, a timeout or a bad response all end the turn normally.
  - **Fixed: the protocol reached repos with an `AGENTS.md`.** The `@AGENTS.md` bridge collapsed the
    entire managed block to that one import line, so those projects received no Crabgic instructions
    at all. The bridge is now additive.
  - **New: `CRABGIC_NO_SPAWN=1`.** Makes any CLI command observe an already-running supervisor
    instead of starting one on demand — what lets a hook ask "is a run in flight?" without booting a
    daemon as a side effect of a session ending.

  Engine facts behind both features are recorded in `docs/engine-baseline.md` §18 (the question
  tool) and §19 (the `Stop` hook control contract), each with a re-runnable spike.

## 1.1.2

### Patch Changes

- 1eba6b2: Stop publishing `dist/.tsbuildinfo`, which was 15% of the package.

  `files: ["dist"]` swept in `tsc -b`'s incremental build state — 199 kB of the
  1299 kB unpacked package, of no use to a consumer. It is also the only file
  that differs between two builds of identical sources in different
  environments, so shipping it made the published artifact non-reproducible,
  directly undermining the reproducible-build criterion the release gate exists
  to enforce. Shipped in 1.0.0 through 1.1.1.

  The published package is now 1099 kB across 28 files; every other file is
  byte-identical to 1.1.1. `scripts/check-published-tarball.mjs` now fails on
  any `.tsbuildinfo` in the tarball, so it cannot come back silently.

## 1.1.1

### Patch Changes

- 75d204e: Fix the status line rendering nothing when it is invoked through a symlink.

  The script's main-module guard compared `import.meta.url` against
  `process.argv[1]` directly. `argv[1]` is the path as invoked, but
  `import.meta.url` is the real path — Node resolves symlinks for module
  identity — so a symlinked invocation looked like a plain import and the entry
  point silently declined to run: exit 0, empty stdout, no error, and Claude
  Code rendering a blank status row with nothing to debug. Resolving `argv[1]`
  before the comparison makes both invocations agree.

  Direct-path invocation, which is what `crabgic install` writes into
  `.claude/settings.json`, was never affected. This only bit a status line
  pointed at the script through a symlink — for example one at
  `~/.claude/crabgic-statusline.mjs` aimed at a globally installed copy, which
  is how it was found.

  The suite now spawns the script for real, both directly and through a
  symlink, because the regression is invisible to a test that imports it.

## 1.1.0

### Minor Changes

- b70d118: Add a Claude Code status line, installed and registered by `crabgic install`.

  The line shows the model and its reasoning effort, the current git branch and dirty
  flag, session context-window usage as a meter, and the 5-hour and weekly subscription
  usage windows — each value clearly divided from the next, on one shared green → amber →
  red scale. A reset countdown appears on a usage window only once it passes 80%.

  Two engine constraints shape the delivery (recorded in `docs/engine-baseline.md` §17,
  read from the 2.1.220 binary): the plugin manifest has no `statusLine` key, and a
  `settings.json` command referencing `${CLAUDE_PLUGIN_ROOT}` is rejected outright. So the
  installer copies the script to `.claude/crabgic-statusline.mjs` as a wholly-owned
  artifact and registers it via `$CLAUDE_PROJECT_DIR`, keeping a committed
  `.claude/settings.json` portable across machines.

  `statusLine` is add-only like every other key the installer writes: a status line you
  already configured is never replaced.

## 1.0.2

### Patch Changes

- Stop the plugin manifest pinning every install to version `0.0.0`, and give the package a README.

  A plugin's effective version resolves `plugin.json` → marketplace entry → source commit SHA,
  and when both files declare one the manifest wins silently. The manifest carried the `0.0.0`
  workspace placeholder while the marketplace entry carried the real release version, so every
  install of `crabgic@crabgic-marketplace` resolved to `0.0.0` — and no later release would have
  reached an already-installed user. The manifest no longer declares a version at all, leaving
  the marketplace entry, which the release preparer recomputes each release, as the sole
  declared version. The resolution order is now recorded as `docs/engine-baseline.md` §16.

  The published package also had no README — `npm view crabgic readme` returned "No README data
  found" — so the npm listing rendered blank. It now ships one.

  The marketplace listing carries the real owner address in place of a placeholder, plus the
  optional discovery metadata the marketplace reference supports (`displayName`, `author`,
  `homepage`, `repository`, `keywords`).

## 1.0.1

### Patch Changes

- Ship the plugin's distributable assets in the published package.

  `1.0.0` bundled the CLI's JavaScript but not the plugin's DATA — the two
  subagents, the hooks, the five skills, `.mcp.json` and
  `.claude-plugin/marketplace.json`. `@crabgic/plugin` is a private workspace
  package that is never published, so `resolvePluginSourceDir` looked for a
  module that does not exist outside the monorepo. In any consuming repo both
  `crabgic doctor` and `crabgic install` — the command the package exists to be
  installed for — failed with
  `Cannot find module '@crabgic/plugin/package.json'`.

  The assets now ship at `<dist>/plugin`, byte-identical to the source so the
  content digest `marketplace.json` records still validates, and the resolver
  prefers that layout with the workspace path as a fallback.

  `scripts/check-install-smoke.mjs` now runs `crabgic doctor` from the
  installed package rather than only probing the argument parser — the gap that
  let this reach the registry with every other check green.

## 1.0.0

### Major Changes

- Initial public release.

  Crabgic is a harness that makes Claude operate as an autonomous engineering
  orchestrator: it plans work into change sets, runs them through a supervised
  worker runtime against isolated git worktrees, and gates every result behind
  quality, security and performance verification before anything is published.

  - Supervised daemon and UDS control plane, with crash recovery, idempotent
    resume and lease-based concurrency over an append-only event journal.
  - Git control repo and worktrees, with overlap analysis, merge preflight and
    neutral branch/commit rendering that never leaks development-engine
    attribution.
  - Connector gateway with Jira Cloud/Data Center and Grafana adapters,
    exactly-once mutation with read-back verification, and an operation journal.
  - Quality, security and performance gates, including PerformanceContract
    decisioning and a reviewed learning pipeline.
  - `crabgic` CLI and doctor, plus a Claude Code plugin and installer.
