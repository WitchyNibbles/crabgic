# Changelog

Release notes for the published `crabgic` package.

This root file is the one `roadmap/23-release-hardening.md`'s reproducible-build
exit criterion (`:136`, "`CHANGELOG.md` entry present") reads, and it mirrors the
per-package notes changesets generates at `packages/cli/CHANGELOG.md`. Both are
derived from the same reviewed `.changeset/*.md` entries — neither is written by
hand at release time, so the two cannot disagree about what shipped.

## 1.5.0

A run that stops for a reason outside its control should not stop for good.

**A rate-limit park now ends by itself.** When a worker hit an account or rate limit it was parked
with its session retained — and then nothing continued it: the unit sat `parked` forever, and it
could not even be re-dispatched fresh, because its original dispatch counted against the repair
budget. A parked unit whose reset window has passed is now actively resumed, on the *same* adapter
that spawned its session, so the continuation keeps full write authority instead of silently falling
back to a read-only stranger. The retained adapters are keyed per run and survive across the
daemon's re-drives, so `crabgic resume <run-id>` finds the session waiting. Honestly scoped:
same-daemon only — a restart loses the in-memory session context (restart-safe resume remains a
separate carry-forward), and the seam declines rather than resume read-only. A live probe proves the
resumed session writes for real; adapters pinned by runs that ended out-of-band are swept so
retention cannot leak.

> **Correction (added after 1.5.0 shipped).** That scoping was true and incomplete, and the
> incomplete half was the part an operator would actually meet. After a restart with a parked run,
> `crabgic resume` reported success while doing nothing at all: the seam declined, the unit re-parked,
> the run stayed `running`, and a `running` run blocks every fresh dispatch of its change set — so
> the change set was wedged until someone thought to `crabgic cancel` a run that was reporting
> success. Startup recovery also mis-read the park as a crash and journaled a `failed` attempt over
> it, without the run's id, so run-scoped and unscoped readers of the same journal disagreed about
> what had happened. Both are fixed in the next release; this note stays so the 1.5.0 disclosure is
> not read as having covered them.

**Authority became reachable where it was stranded.** Approval is completable without couriering a
token by hand; routine approval is decided by the standing policy rather than by asking; the
calibration gate is reachable and certifies on a number that transfers; exit criteria are decided
from evidence and from the artifact; the worker turn budget is an authority dimension rather than a
hard-coded constant; and a run says so when it holds more authority than its plan needs.

**Tool calls that ran unrecorded now go through adjudication.** Gateway MCP calls, and `Bash`,
`Edit` and `Write`, were executing without an adjudication record; each is now gated and journaled.
A run records what it costs, and `crabgic status <run-id>` answers "how far has it got?", not just
"is it going?".

**Correctness and release hygiene.** The repair-evidence budget and `recordAttempt`'s
`previousStatus` are run-scoped, so a retry cut as a new run is no longer refused by a prior run's
exhaustion; `resume` seeds finished work from the journal (and the now-redundant attempt cache was
removed); a run transitions out of `running` when its drive ends in failure, so the change set stays
retryable; `crabgic install` keeps an existing standing policy instead of clobbering it; `crabgic
approve` is no longer offered as the remedy for an authority escalation, because it cannot be one;
the release gate gates something; and several load-sensitive tests were fixed at their causes.

## 1.4.0

Two things a review loop needs before it can run itself: an end, and permission to start.

**The review loop can now end.** The previous design closed a round only when a reviewer produced no
finding that was both novel and falsifiable, with no severity floor and no cap on rounds. Twelve
rounds against one subsystem measured what that costs: every round produced a genuine, reproducible
finding, severity fell the whole way, and it never converged. Novelty and falsifiability exclude
*manufactured* findings, which is what they were for — they do not bound the supply of genuine ones,
so the criterion measured reviewer exhaustion rather than artifact quality.

Termination is now the artifact against written per-stage exit criteria, carried as data with stable
ids. A finding blocks only by naming the criterion it violates; one that violates none is advisory.
Every finding at any severity carries a disposition that can never be empty, so a stage cannot
advance holding an unanswered finding — `advisory` defers a finding and never disposes of one, and
debt deferred that way becomes blocking again the moment a later change set touches the code it
concerns. Rounds continue only while each closes a blocking finding, then escalate to the owner
rather than looping.

**Closure is computed, not asserted.** The new `review.submit` gateway tool takes a reviewer's
findings and decides whether the stage may close. Planned writes come from the change set's own
envelope and prior findings from a durable store, so a reviewer cannot understate what it touches to
dodge deferred debt, and a clean round cannot erase somebody else's open blocker.

**The classifier says whether it has ever been checked.** The blocking/advisory split is a
judgement, and an uncalibrated judge is decorative. Every review result reports Cohen's kappa
against the owner's own recorded judgements, and refuses to call anything calibrated on too small a
sample. A fresh project scores zero, which is honest; returning verdicts without saying nobody has
looked would not be.

**Standing approval replaces per-change-set prompting.** `crabgic install` derives an authorization
policy from the repository, renders it in full, and writes it `0600` into the project's XDG state
directory — never the repo, since a committed standing grant is one every clone would carry. Every
dispatch is checked for containment: inside, the run proceeds with no prompt and no token; outside,
it is refused before a run exists, so fixing the policy and dispatching again just works. The policy
also narrows the compiled worker sandbox, which is what makes standing approval sound rather than
nominal — without it a worker's allow-listed test command could reach the whole worktree through a
child process. Nothing reachable from a manager session can write or widen it, and `crabgic doctor`
fails a policy that grants nothing.

**Three defects found by auditing the shipped binary.** Nothing in the system ever created a run
record, so an approved change set had no execution path at all — `run.dispatch` now takes a change
set and returns the run id it mints, and `crabgic resume` targets a separate `run.resume`. `crabgic
status`, `resume` and `cancel` exited `0` with no output whenever the daemon was not running,
instead of reporting it unreachable. And run-lifecycle transitions performed a read-modify-write
across an await, so a cancel racing a starting run could write two conflicting states into the
journal.

**Security fixes, each proven against the built binary.** `doctor` could be made to overwrite an
arbitrary file while reporting the sandbox healthy, and a FIFO at the standing-policy path froze it
for thirty-six seconds — ignoring SIGTERM, needing SIGKILL, printing nothing — on the code path the
dispatch daemon uses. A symlink one directory above the approval signing key put that key in an
attacker's directory. Five separate hardened-open implementations had drifted into two behaviours;
there is now one, refusing a symlink, a hardlink, a FIFO and a foreign owner, and verifying every
directory component below the state root.

Fresh worktrees also get their dependencies provisioned, without which `npm run test` and `npm run
build` — two of the four commands a worker can ever be granted — failed in every worktree. New
agents ship for the pipeline's design and plan stages, and the reviewer takes a lens per round
rather than repeating one hostile pass.

## 1.3.0

Say it so it can be read: a presentation policy for everything Crabgic tells its owner.

Crabgic already had a policy for what it says to *third parties* — `CommunicationPolicy`, enforced
by a blocking lint: neutral voice, no first person, no decoration, no emoji. Nothing governed what
it says to the person running it, so every surface improvised. For an owner who reads structured,
signposted text far faster than prose, and who loses a flat monochrome wall of text entirely, that
is an accessibility defect rather than a matter of taste.

**`PresentationPolicy`** is new, and is the counterpart rather than an edit to the existing one:
answer first in two lines, headings past five, no more than three unbroken prose lines, bullets
under fifteen words, a table once three or more items each carry two or more attributes. The limits
live in one place and every surface quotes them, so they cannot drift apart.

**A closed glyph vocabulary** replaces ad-hoc markers: ✅ ok, ❌ fail, ⚠️ warn, 🛑 blocked, ⏳ pending,
🔄 running, ⏸️ parked, ❓ question, 📎 evidence, ℹ️ info. Roles are chosen by meaning — a glyph is a
navigation aid only if the same shape always means the same thing, so there are no decorative ones.
Three profiles ship: emoji for a terminal, plain symbols for a pipe, and 7-bit ASCII for a terminal
without Unicode coverage.

**Colour by verdict**, reusing the status line's existing 256-colour hues so the two surfaces read
as one product. Leads and headings are bold, scaffolding is dimmed, and each status line takes its
role's colour. Colour is additive only: stripping the escapes from any coloured render reproduces
the monochrome render byte for byte, so nothing is ever visible in colour alone and the whole
surface survives `NO_COLOR`, a monochrome terminal, colour-vision deficiency, and a paste into a
plain-text ticket.

**The manager session reports under the same rules.** Its half ships in the managed `CLAUDE.md`
block, quoting the limits and the vocabulary rather than restating them; `/eo:protocol` carries the
long form. It cannot emit terminal colour, so its contrast channel is markdown weight.

Selection is automatic — emoji and colour on a terminal, monochrome plain text when piped — and
overridable: `CRABGIC_PRESENTATION=emoji|text|ascii`, `CRABGIC_ASCII=1`, `CRABGIC_COLOR=1|0`, and
`NO_COLOR` (which drops colour without touching structure).

Nothing here reaches shared artifacts, and `--json` is untouched: PR, commit, Jira and Grafana text
stays neutral and emoji-free, and `status --watch`'s piped output is byte-identical to 1.2.0. The
full rationale and resolution rules are in `docs/presentation-policy.md`.

## 1.2.0

Give the manager session an operating protocol, and enforce the autonomous half of it.

Installed projects received a managed `CLAUDE.md` block that listed the plugin's capabilities and
said nothing about how to operate. With no instruction to the contrary a Claude Code session uses
its conversational default and checks in after every step — the opposite of a harness whose own
design names seven, and only seven, conditions that may halt a run. Reported from real use: the
manager asked the owner to type "continue" after every step, and asked genuine questions as
plain-text "option 1 / 2 / 3 / 4" lists.

**The manager operating protocol** is new. Autonomy by default, the seven stop conditions as the
only legitimate halts, the approval gates, and `AskUserQuestion` as the way to put a decision to
the owner. It ships in the managed `CLAUDE.md` block, and `/eo:protocol` carries the long form.

**The Stop autonomy gate** is new, and is the first manager hook permitted to block. It refuses to
end a turn while a run is in flight, so the autonomy clause is enforced rather than requested. It
allows the stop at `awaiting_approval` — blocking there would trap you in a session whose only
exit is the approval the block prevents you reaching — and at every terminal state. It cannot
loop, and it fails open on every error path: no supervisor, no runs, a timeout or a bad response
all end the turn normally, so it does nothing at all in a project that has never run Crabgic.

**Repos with an `AGENTS.md` now get the protocol too.** The `@AGENTS.md` bridge collapsed the
entire managed block to that one import line, so such projects received no Crabgic instructions of
any kind. The bridge is now additive.

**`CRABGIC_NO_SPAWN=1`** is new: it makes a CLI command observe an already-running supervisor
rather than start one on demand.

Engine facts behind both features are recorded in `docs/engine-baseline.md` §18 and §19, each with
a re-runnable spike. §18's interactive half is deliberately left UNRESOLVED, so the protocol
degrades to a single consolidated prose question if the tool is ever absent.

## 1.1.2

Stop publishing `dist/.tsbuildinfo`, which was 15% of the package.

`files: ["dist"]` swept in `tsc -b`'s incremental build state — 199 kB of the 1299 kB
unpacked package, of no use to a consumer. It is also the only file that differs between
two builds of identical sources in different environments, so shipping it made the
published artifact non-reproducible, directly undermining the reproducible-build criterion
the release gate exists to enforce. Shipped in 1.0.0 through 1.1.1.

The published package is now 1099 kB across 28 files; every other file is byte-identical
to 1.1.1. `scripts/check-published-tarball.mjs` now fails on any `.tsbuildinfo` in the
tarball, so it cannot come back silently.

## 1.1.1

Fix the status line rendering nothing when it is invoked through a symlink.

The script's main-module guard compared `import.meta.url` against `process.argv[1]`
directly. `argv[1]` is the path as invoked, but `import.meta.url` is the real path — Node
resolves symlinks for module identity — so a symlinked invocation looked like a plain
import and the entry point silently declined to run: exit 0, empty stdout, no error, and
Claude Code rendering a blank status row with nothing to debug. Resolving `argv[1]` before
the comparison makes both invocations agree.

Direct-path invocation, which is what `crabgic install` writes into
`.claude/settings.json`, was never affected. This only bit a status line pointed at the
script through a symlink — for example one at `~/.claude/crabgic-statusline.mjs` aimed at
a globally installed copy, which is how it was found.

The suite now spawns the script for real, both directly and through a symlink, because the
regression is invisible to a test that imports it.

## 1.1.0

Add a Claude Code status line, installed and registered by `crabgic install`.

The line shows the model and its reasoning effort, the current git branch and dirty flag,
session context-window usage as a meter, and the 5-hour and weekly subscription usage
windows — each value clearly divided from the next, on one shared green → amber → red
scale. A reset countdown appears on a usage window only once it passes 80%. The two usage
segments render only for Claude.ai subscription auth, and only once the session's first
API response populates the rate-limit headers; `CRABGIC_STATUSLINE_ASCII=1` selects plain
glyphs for fonts without emoji coverage, and `NO_COLOR` is honoured.

Two engine constraints shape how it is delivered, both read from the 2.1.220 binary and
recorded as `docs/engine-baseline.md` §17: the plugin manifest has no `statusLine` key, so
a plugin cannot register one, and a `settings.json` command referencing
`${CLAUDE_PLUGIN_ROOT}` is rejected outright rather than left unexpanded. The installer
therefore copies the script to `.claude/crabgic-statusline.mjs` as a wholly-owned artifact
and registers it through `$CLAUDE_PROJECT_DIR`, so a committed `.claude/settings.json`
stays portable across machines. `statusLine` is add-only like every other key the
installer writes: a status line already configured is never replaced.

The renderer is a zero-dependency `.mjs` rather than compiled TypeScript, for the same
reason the hooks are — the engine re-runs it on every token change, so process startup is
on the hot path (~34ms standalone against ~300ms through the bundled CLI).

## 1.0.2

Stop the plugin manifest pinning every install to version `0.0.0`, and give the package a
README.

A plugin's effective version resolves `plugin.json` → marketplace entry → source commit
SHA, and when both files declare one the manifest wins silently. The manifest carried the
`0.0.0` workspace placeholder while the marketplace entry carried the real release
version, so every install of `crabgic@crabgic-marketplace` resolved to `0.0.0` — and no
later release would have reached an already-installed user. The manifest no longer
declares a version at all, leaving the marketplace entry, which the release preparer
recomputes each release, as the sole declared version. The resolution order is now
recorded as `docs/engine-baseline.md` §16, flagged documentation-sourced rather than
probe-verified, with a live verification recorded as owed.

The published package also had no README — `npm view crabgic readme` returned "No README
data found" — so the npm listing rendered blank. It now ships one, using absolute asset
URLs because npm resolves neither relative images nor relative links.

The marketplace listing carries the real owner address in place of a placeholder, plus the
optional discovery metadata the marketplace reference supports (`displayName`, `author`,
`homepage`, `repository`, `keywords`). Deliberately no `icon`: the plugin system has no
such field on either a marketplace entry or `plugin.json`.

## 1.0.1

Ship the plugin's distributable assets in the published package.

`1.0.0` bundled the CLI's JavaScript but not the plugin's DATA — the two subagents, the
hooks, the five skills, `.mcp.json` and `.claude-plugin/marketplace.json`.
`@crabgic/plugin` is a private workspace package that is never published, so
`resolvePluginSourceDir` looked for a module that does not exist outside the monorepo. In
any consuming repo both `crabgic doctor` and `crabgic install` — the command the package
exists to be installed for — failed with
`Cannot find module '@crabgic/plugin/package.json'`.

The assets now ship at `<dist>/plugin`, byte-identical to the source so the content digest
`marketplace.json` records still validates, and the resolver prefers that layout with the
workspace path as a fallback.

`scripts/check-install-smoke.mjs` now runs `crabgic doctor` from the installed package
rather than only probing the argument parser — the gap that let this reach the registry
with every other check green.

## 1.0.0

Initial public release.

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

Requires Node.js >= 24 and Linux x86-64/ARM64 (including WSL2). Supported
integration targets are recorded in `docs/compatibility-matrix.md`; the pinned
Claude Code engine range is recorded in `docs/engine-baseline.md`.
