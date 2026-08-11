# Design proposal — a production-ready manager report-format gate

**Status: PROPOSAL, not authority.** Nothing here is settled. `docs/presentation-policy.md`
remains the authority on the policy itself; this document proposes how the _manager channel's_
enforcement should look beyond the tactical gate shipped 2026-08-11.

## 1. What exists, and what is wrong with it

`packages/plugin/hooks/stop-report-format-gate.mjs` is a blocking `Stop` hook. It reads
`last_assistant_message` (engine-baseline §19.3), applies two regex-driven rules, and refuses the
turn if either fires.

It was the right thing to ship — it converted "instruction only" into real enforcement. It is not
what this should look like in a year, for five reasons:

| #   | Weakness                            | Why it matters                                                                                                                            |
| --- | ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Thresholds are guessed**          | `ASSUMED_WRAP_COLUMNS = 80`, `>5 prose lines`. No corpus, no measurement. Nobody knows the error rate.                                    |
| 2   | **Line regexes, not a parser**      | Review already found one false-positive class (fenced code). Others remain — see §3.2.                                                    |
| 3   | **No observability**                | If it fires wrongly, nothing records it. The owner experiences a bad turn and has no way to report it.                                    |
| 4   | **No escape hatch**                 | `PresentationPolicy` is a zod schema nothing ever loads. There is no way to tune or disable per project.                                  |
| 5   | **It polices, it does not prevent** | The CLI channel is correct _by construction_ because output goes through a renderer. The manager channel is free text checked afterwards. |

Weakness 5 is the important one. The others are quality; that one is architecture.

## 2. The principle this should be built on

> Make the correct output the easy path. Detect only what prevention cannot reach.

CLI stdout needs no gate because `renderHumanReport` will not emit a wall. The manager channel has
a gate precisely because nothing structures its output. Every layer below is an attempt to move
work _leftward_, from detection toward prevention.

## 3. Proposed architecture — four layers

### L0. Prevention: an output style — ❌ **DISPROVEN as specified (2026-08-11)**

> **Measured, and the answer is no.** `spikes/11-output-style.mjs`, recorded as
> `docs/engine-baseline.md` §23, at engine 2.1.224 and at zero live-model cost: output styles are
> **not a plugin component**. A plugin carrying one lists no such category in its inventory (which
> does print zero-count categories) and reports `~0 tok` always-on. crabgic cannot ship one.
>
> **The remaining path is the installer**, writing `.claude/output-styles/` plus the `outputStyle`
> setting into the consuming project — which is already how `CLAUDE.md`, `.claude/settings.json`,
> the agents and the statusline get there. That is NOT a drop-in substitute: it modifies files in
> the operator's repository, so it needs the managed-artifact treatment, drift detection and
> uninstall path the installer gives everything else, and its own owner-consent story. It deserves
> its own design pass rather than inheriting this one.
>
> Everything below is the original proposal, kept because it records what was expected and why the
> probe was worth running.

An output style replaces the assistant's base communication prompt. If a plugin can ship one, the
reporting rules stop being an instruction the model may drift from and become the model's default
register — which is a categorically stronger position than blocking after the fact.

**This is an engine fact and it is not in the baseline.** `docs/engine-baseline.md` and
`docs/claude-code-adaptation.md` say nothing about output styles, and the plugin manifest crabgic
ships declares only `mcpServers` (with `agents/`, `hooks/`, `skills/`, `statusline/` by directory
convention). Per CLAUDE.md's non-negotiable, this must not be assumed from memory.

**Owed probe — `spikes/11-output-style.mjs`:**

1. Can a plugin ship an output style at all, or is it user/project-scoped only?
2. If shipped, does it compose with or override a project's own `outputStyle` setting?
3. Does it survive `--resume` and subagent contexts?
4. Measured token cost per turn.

If (1) is NO, L0 is unavailable and the design rests on L1–L3. **Nothing below depends on this
resolving PASS** — that is deliberate, and mirrors how §19 was scoped.

### L1. Structure: give reports a rendering path — renderer LANDED, delivery UNDECIDED

> **Correction, 2026-08-11.** This section originally said the manager should render through
> `renderHumanReport`, "the _same_ function, so the two channels cannot drift". **That was wrong,
> and this document's own §"three channels" table said why**: the two channels have opposite
> contrast mechanisms. CLI stdout owns a real terminal and paints SGR codes and box-drawing rules;
> the manager writes into a markdown TUI that cannot emit ANSI, where the controls are `**bold**`
> and `##`. Sharing the renderer would have emitted `────────` underlines into a surface that
> renders headings properly — worse output, bought with a tidier dependency graph.
>
> `renderMarkdownReport` (`contracts/presentation/markdown-report.ts`) is the corrected form. What
> is shared is the part that matters — the limits and their enforcement, read from the same
> `HUMAN_REPORT_LIMITS`, with the same prose-throws/data-degrades split and the same announced
> overflow. Only the spelling differs per channel.

Today the manager writes prose and hopes. Give it the same affordance the CLI has:

- `renderMarkdownReport` accepts `{role, lead, sections[], nextAction}` and emits conforming
  markdown. **Landed.**
- A way for the manager to CALL it. **Not decided** — see below.
- The protocol instructs: compose long reports through it; short answers stay prose.

**The delivery mechanism is an open decision, deliberately not made in haste:**

| Option                       | Cost                                                                                                                      | Objection                                                                                                             |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Gateway MCP tool             | High — `build-tool-registry.ts` is a governed composition root; a new family needs CapabilityManifest and trust treatment | Heaviest, but the only one the manager calls natively                                                                 |
| `crabgic report` CLI command | Medium — argv, dispatch, help, snapshots                                                                                  | Manager shells out to format its own message; works, reads oddly                                                      |
| Skill                        | Low                                                                                                                       | A skill is instructions, not execution — it cannot run the renderer, so it reduces to the instruction we already have |

The third is not a real option for a STRUCTURAL fix and is listed to record why. Choosing between
the first two is an owner call about how much surface the manager channel is worth.

This does not force compliance — the final assistant message is still free text — but it converts
"format it correctly from memory" into "call the thing that formats it". Gate firings should fall
sharply, and the ones that remain are the interesting ones.

### L2. Detection: a block tokenizer, calibrated

**Replace line regexes with a small CommonMark block-level tokenizer.** Not a dependency — a
~150-line pure module in `contracts/presentation/`, shared by the hook and testable directly.

Classes the current regexes get wrong, all real CommonMark:

| Construct                                | Current behaviour                 |
| ---------------------------------------- | --------------------------------- |
| Indented code block (4 spaces)           | counted as prose → false positive |
| Nested/tilde fences of differing lengths | fence toggling desynchronises     |
| Lazy list continuation lines             | counted as prose                  |
| Setext headings (`===` underline)        | not recognised as structure       |
| HTML blocks                              | counted as prose                  |
| Tables without a leading pipe            | not recognised as structure       |
| Reference link definitions               | counted as prose                  |

**Calibrate against a real corpus, not intuition.** The Stop payload carries `transcript_path`
(§19.3) — _for offline harvesting only, never for a runtime decision._ Proposed method:

1. Harvest N≥300 real manager messages from transcripts.
2. The owner labels a stratified sample wall / not-wall. This is the ground truth; the owner's
   reading is the only authority on it, which is the whole point of the policy.
3. Fit thresholds against the labels. Report precision/recall.
4. **Publish an explicit false-positive budget** — proposal: FP ≤ 1%, since a wrongly-blocked turn
   costs a round trip and, worse, teaches distrust of the gate.
5. Freeze the corpus as an evidence transcript; re-run on every threshold change.

Only then do the numbers belong in `HUMAN_REPORT_LIMITS`.

### L3. Observability and control

**Configuration.** `PresentationPolicySchema` exists and is loaded by nothing. Wire it:
`.crabgic/presentation.json` (or the standing-policy file), validated by the existing schema,
falling back to `DEFAULT_PRESENTATION_POLICY`. Gives per-project tuning _and_ an off switch, which
a blocking hook shipped to other people's repositories should have had from the start.

**Telemetry.** Append one line per firing to `$XDG_STATE_HOME/crabgic/format-gate.jsonl`:
timestamp, rule, measured value, threshold, message digest (**digest only — never the text**).
Surface counts in `crabgic doctor`. Without this, "does it misfire?" is unanswerable.

⚠️ **Security note, not an afterthought.** The journal has no writer identity
(see the known issue), so this must NOT go in the journal. A separate append-only counter file with
no security claim attached to it is the honest home.

## 4. Rollout — advisory before blocking

The current gate blocks from day one on unmeasured thresholds. Invert that:

| Phase | Behaviour                                    | Exit criterion                      |
| ----- | -------------------------------------------- | ----------------------------------- |
| 1     | **Advisory.** Records firings, never blocks. | ≥200 real firings recorded          |
| 2     | Owner reviews the sample; thresholds re-fit. | Measured FP ≤ 1% on held-out labels |
| 3     | **Blocking**, config-overridable.            | —                                   |

A Stop hook cannot "warn" — its reason only reaches the model on a block. So phase 1's channel is
the L3 log plus `crabgic doctor`, not the model.

## 5. What stays unenforceable, stated plainly

No layer here can check **whether the first line is actually the answer**. That is the policy's most
important rule and it is a semantic judgement, not a structural one. An LLM-judge could approximate
it; that would put a model call on every turn end, and a wrong judgement would block a correct
report. **Recommendation: do not.** State the limitation instead — which is what
`docs/presentation-policy.md` now does.

## 6. Risks

| Risk                                              | Mitigation                                                                                                   |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Corpus reflects one owner's taste                 | That is correct here — the policy exists for this owner's condition. Say so rather than implying generality. |
| Tokenizer is new code with its own bugs           | Pure, no I/O, fixture-tested against CommonMark examples; fails open like everything else in the hook.       |
| L0 probe consumes live engine budget              | One spike, few turns, follows `spikes/README.md`'s cost discipline.                                          |
| Config file becomes an "off switch everyone uses" | Telemetry records when the gate is disabled, so that is visible rather than silent.                          |

## 7. Sequencing

1. **L3 config + telemetry** — smallest, unblocks measurement, no engine dependency.
2. **Advisory rollout** (phase 1) — starts the corpus accumulating immediately.
3. **L2 tokenizer** — behaviour-neutral refactor under existing tests, then calibration.
4. **L1 report path** — larger; benefits from knowing what actually fires.
5. **L0 probe** — independent; can run any time, and may reduce the value of the rest.
