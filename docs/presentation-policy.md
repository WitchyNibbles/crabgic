# Presentation policy — how Crabgic talks to its owner

Crabgic has two audiences and needs two opposite policies for them.

- **`CommunicationPolicy`** (roadmap/02, enforced by roadmap/17's `lint()`)
  governs what Crabgic says to _third parties_: branch names, commit messages,
  PR titles and bodies, Jira comments, Grafana annotations. Neutral voice, no
  first person, no signatures, no decoration, no emoji.
- **`PresentationPolicy`** (this document) governs what Crabgic says to _its
  owner_: CLI stdout and the manager session's prose. Signposted, structured,
  answer-first.

Merging them would corrupt both. This document covers the second.

## Why this exists

This product's owner has a condition that makes long, unordered prose very hard
to read. That makes structure an **accessibility requirement**, not a style
preference, and it changes what counts as a defect: a report that technically
contains the answer somewhere inside an undifferentiated block has not
delivered it. "It was in there" is not a defence.

The same condition makes flat monochrome output easy to slide off: with nothing
to catch the eye, there is nothing to return to after a lapse in attention. So
colour is part of the same requirement, not a garnish on top of it.

Three consequences follow, and all are load-bearing:

1. **Limits are floors on legibility, not targets.** Coming in under one is
   always fine; going over one is a bug.
2. **The glyph vocabulary is closed.** A glyph is a navigation aid only if the
   same shape always means the same thing. Decorative emoji actively destroy
   the affordance they appear to add, so there are none.
3. **Colour is additive only.** It is a second navigation channel layered on
   the glyphs and words, never the carrier of meaning — see below.

## The three channels

| Channel                                           | Read by             | Emoji | Contrast channel       | Governed by                                                  |
| ------------------------------------------------- | ------------------- | ----- | ---------------------- | ------------------------------------------------------------ |
| Manager session prose (plugin → the owner's TUI)  | the owner           | yes   | markdown weight        | `PresentationPolicy`, via the `CLAUDE.md` operating protocol |
| CLI stdout (`crabgic status`, `doctor`, …)        | the owner and pipes | gated | ANSI colour, TTY-gated | `PresentationPolicy`, via the resolved context               |
| Outbound artifacts (PR / commit / Jira / Grafana) | third parties       | never | none                   | `CommunicationPolicy`, via `packages/renderer`               |

The manager session cannot emit ANSI — it writes into a markdown-rendering TUI,
so its contrast controls are **bold** and `code`. The CLI owns the real stream
and paints it with SGR codes. Same intent, two mechanisms.

`--json` output is a fourth thing and belongs to none of them: it is a machine
contract, formatted by `formatJson`, and nothing in this policy may touch it.

## Where the code lives

`packages/contracts/src/presentation/` — a module inside `packages/contracts`,
in the manner of `renderer-core` (interface-ledger Gap 3) and `cli-surface`.
It is **not** a new workspace package and **not** one of the 21 roadmap
contracts.

| File                     | Holds                                                                            |
| ------------------------ | -------------------------------------------------------------------------------- |
| `glyphs.ts`              | the closed role union, the three-profile glyph table, `glyph()`                  |
| `colors.ts`              | `ROLE_COLORS`, `STRUCTURE_COLORS`, `paint()`, `paintRole()`, `stripAnsi()`       |
| `presentation-policy.ts` | `HUMAN_REPORT_LIMITS`, the zod schema, `DEFAULT_PRESENTATION_POLICY`             |
| `profile.ts`             | `resolvePresentationProfile()`, `resolveColorEnabled()`, `resolvePresentation()` |
| `human-report.ts`        | the stdout primitives, and the enforcement of all six limits                     |
| `reports.ts`             | `renderResultLine`, `renderItemListReport`, `CLI_TEXT`, `pluralize`              |

The last two were relocated here from `packages/cli/src/output/` (2026-08-11)
when `trust review|approve|revoke`, whose backend is `packages/detect`, needed
them. `packages/cli` depends on `packages/detect`, so the renderers were
unreachable from there without inverting that edge; the alternative was a second
copy, and the `crabgic-statusline.mjs` note below is what a second copy costs.
It is the move `cli-surface` already made for `formatJson`/`CommandResult`, and
`packages/cli/src/output/{human,reports}.ts` re-export from here verbatim so
every existing import path still resolves.

`reports.ts` splits by CARDINALITY, not by command: `renderResultLine` for a
single-fact result, `renderItemListReport` for a list whose length is unknown
when the code is written. A headed report over one line is scaffolding with
nothing to hold up, and would add reading rather than remove it.

Consumers:

- `packages/cli/src/output/status-renderer.ts` — `status --watch`.
- `packages/cli/src/commands/real-handlers.ts` — `doctor`, `status`, `evidence`,
  `cancel`, `resume`.
- `packages/cli/src/commands/installer-handlers.ts` — `install`, `upgrade`,
  `uninstall`.
- `packages/cli/src/commands/approve.ts` — `approve`.
- `packages/cli/src/commands/help.ts` — the grouped command table.
- `packages/cli/src/learning/learn-command-backend.ts` — `learn *`.
- `packages/cli/src/connection/connection-commands.ts` and
  `connection-capabilities.ts` — `connection *`.
- `packages/detect/src/trust/` — `trust review|approve|revoke`.
- `packages/plugin/src/manager-protocol.ts` — the always-loaded `CLAUDE.md`
  operating protocol, which quotes the limits and the vocabulary rather than
  restating them.

`packages/renderer` must never import this module. Its artifacts are governed
by `CommunicationPolicy`, and its Jira ADF whitelist rejects the `emoji` node
outright — a decorated outbound artifact fails the render with `policy_blocked`.

## The glyph vocabulary

Roles are chosen by meaning. Adding one is a change to the table plus its test,
never an ad-hoc string at a call site.

| Role       | emoji | text | ascii | Means                                       |
| ---------- | ----- | ---- | ----- | ------------------------------------------- |
| `ok`       | ✅    | `✓`  | `+`   | passed / succeeded                          |
| `fail`     | ❌    | `✗`  | `x`   | failed                                      |
| `warn`     | ⚠️    | `!`  | `!`   | succeeded, but degraded or with a caveat    |
| `blocked`  | 🛑    | `⊘`  | `#`   | halted at a stop condition or approval gate |
| `pending`  | ⏳    | `•`  | `.`   | accepted, not started                       |
| `running`  | 🔄    | `•`  | `>`   | in flight now                               |
| `parked`   | ⏸️    | `⏸`  | `=`   | parked by an external limit, not a failure  |
| `question` | ❓    | `?`  | `?`   | an open decision for the owner              |
| `evidence` | 📎    | `▸`  | `*`   | an evidence reference                       |
| `info`     | ℹ️    | `•`  | `-`   | a neutral note, no verdict                  |

The `text` profile deliberately collapses `pending`, `running` and `info` onto
`•`. That is not an oversight: in text mode the label already carries the
distinction, and three lookalike symbols would trade a real readability gain
for a false one.

## Colour

One hue per role, in `ROLE_COLORS`. The values deliberately reuse the status
line's existing 256-colour palette (`crabgic-statusline.mjs`) — the two
surfaces sit in the same terminal seconds apart, and should read as one
product. That file is a zero-dependency hot-path script and cannot import this
module, so the duplication is intentional and documented, not drift.

| Role               | SGR        | Hue                                        |
| ------------------ | ---------- | ------------------------------------------ |
| `ok`               | `38;5;114` | soft green                                 |
| `fail`             | `38;5;203` | soft red                                   |
| `warn`             | `38;5;179` | amber                                      |
| `blocked`          | `38;5;168` | crimson — distinct from `fail` at a glance |
| `running`          | `38;5;110` | blue                                       |
| `parked`           | `38;5;214` | orange                                     |
| `question`         | `38;5;176` | mauve                                      |
| `evidence`         | `38;5;146` | lavender-grey                              |
| `pending` / `info` | `38;5;242` | low-salience grey                          |

`blocked` is crimson rather than a heavier red because a halt and a failure ask
different things of the reader — one is waiting on them, the other is not.
`pending` and `info` share the grey on purpose: both are "no verdict yet", and
dimming them is what lets the verdicts stand out.

Layout styles are separate from verdict styles, in `STRUCTURE_COLORS`: `lead`
and `heading` are bold — the two places a reader who lost the thread must land
— while `rule`, `key` and `bullet` are dimmed so the scaffolding recedes behind
the content it holds up.

### Colour is additive only

Every coloured element also carries a glyph and a word, and colour never
changes layout. `human.ts`'s own suite asserts this structurally, for every
profile:

```
stripAnsi(render(x, { color: true })) === render(x, { color: false })
```

That invariant is what makes the whole surface survive `NO_COLOR`, a monochrome
terminal, colour-vision deficiency, and a paste into a plain-text ticket. It is
also why the red/green pairing of `ok` and `fail` is safe here: the colour
reinforces the distinction, it never _is_ the distinction.

Two mechanical consequences, both enforced in `human.ts`:

- Key-value padding is computed and trimmed on the **plain** text, then colour
  is applied. Padding a painted string counts escape bytes as width and shears
  the column; trimming one can truncate a reset and bleed colour into the rest
  of the stream.
- `paint` returns empty text untouched rather than emitting a bare colour
  change, which would otherwise survive as a phantom difference under
  `stripAnsi`.

`text` is also a compatibility contract. `status --watch` emitted `✓ ✗ ⏸ •`
before this vocabulary existed and is snapshot-tested, so those four values are
pinned by a test and must not be "improved".

## Resolution

`resolvePresentation({ env, isTTY })` returns the `PresentationContext` a
handler threads through every render: `{ profile, color }`. It composes the two
independent decisions below. Resolve **once** at a command's entry point — a
single command's output must never mix profiles or half-apply colour.

### Glyph profile

`resolvePresentationProfile({ env, isTTY })`, highest precedence first:

1. `CRABGIC_PRESENTATION=emoji|text|ascii` — explicit operator intent. An
   unrecognised value is **ignored**, never fatal: a typo in a shell profile
   must degrade the display, not break a command.
2. `CRABGIC_ASCII=1` — the blunt "my terminal has no Unicode" switch. Exactly
   `"1"`, matching `CRABGIC_STATUSLINE_ASCII`'s existing contract.
3. Not a TTY → `text`. Piped, redirected or snapshot-captured output stays
   byte-stable and `| grep`-able.
4. Otherwise → `emoji`. A human is looking at this.

`NO_COLOR` is deliberately **not** consulted here. It governs colour. A reader
who suppresses colour has not asked to lose the structural markers that make a
report scannable, and conflating the two would strip exactly the affordance
this policy exists to provide.

### Colour

`resolveColorEnabled({ env, isTTY })`, highest precedence first:

1. `CRABGIC_COLOR=1|0` — explicit intent, and the only thing that can turn
   colour **on** for a non-TTY. That case is real: piping into `less -R`, or a
   CI log viewer that renders ANSI. An unrecognised value falls through rather
   than throwing, matching `CRABGIC_PRESENTATION`.
2. `NO_COLOR`, however it is set — the cross-tool convention, checked by
   definedness exactly as `crabgic-statusline.mjs` already checks it.
3. Not a TTY → off. Never write escape bytes into a pipe, a snapshot or a log.
4. Otherwise → on.

The two decisions stay independent on purpose. `NO_COLOR` means "no colour",
not "no structure", so `emoji` output can be monochrome; and a terminal with
colour but no Unicode coverage is a real configuration, so `ascii` output can
still be coloured.

Both functions are pure and take the environment rather than reaching for
`process`, so they are testable without mutating global state and cheap enough
for the statusline's hot path.

| Variable               | Effect                                                     |
| ---------------------- | ---------------------------------------------------------- |
| `CRABGIC_PRESENTATION` | `emoji` \| `text` \| `ascii` — forces the glyph profile    |
| `CRABGIC_ASCII=1`      | forces the `ascii` profile                                 |
| `CRABGIC_COLOR`        | `1` forces colour on (even when piped), `0` forces it off  |
| `NO_COLOR`             | any value disables colour; glyphs and structure unaffected |

## The structural limits

From `HUMAN_REPORT_LIMITS`:

| Limit                       | Value | Rule                                                         |
| --------------------------- | ----- | ------------------------------------------------------------ |
| `leadAnswerMaxLines`        | 2     | the conclusion comes first, in at most two lines             |
| `headingRequiredAboveLines` | 5     | past five lines, a report needs headings                     |
| `proseBlockMaxLines`        | 3     | the longest unbroken paragraph                               |
| `bulletMaxWords`            | 15    | a bullet is scannable in one fixation                        |
| `sectionMaxBullets`         | 7     | past seven, split the section or use a table                 |
| `tableMinRows`              | 3     | three-plus items with two-plus attributes each is a table    |
| `bulletMaxColumns`          | 100   | a bullet's DISPLAY WIDTH — what the word budget cannot bound |
| `titleMaxColumns`           | 40    | a section title's display width                              |

### Width is measured in columns

Added 2026-08-11. Every limit above is ultimately about **how much screen a
thing occupies**, and until this landed nothing measured that: the code carried
four notions of "length" — UTF-16 code units (`text.length`), code points
(`countChars`), grapheme clusters (nothing), display columns (nothing) — and
used the first two wherever the fourth was meant. Two measured consequences,
both latent only because every caller passed ASCII:

- `renderHeading` drew a **4-column rule under the 8-column title `評価結果`**.
  This file's own claim that "section titles are plain single-width text by
  contract" was a contract nothing enforced. `titleMaxColumns` is now that check.
- `renderKeyValues` — whose entire purpose is alignment — started its value
  column at **5 for a `run` key and 7 for a `実行` key**.

`displayWidth()` (`renderer-core/display-width.ts`) is the single primitive, over
`Intl.Segmenter` grapheme clusters. It supersedes `.length` at every layout site.

**It picks a convention, because there is no single correct answer.** `⚠️`
(U+26A0 + VS16) is one column in some terminals and two in others; East Asian
Ambiguous characters depend on locale. So:

| Case                                | Columns | Why                                                                |
| ----------------------------------- | ------- | ------------------------------------------------------------------ |
| VS16-qualified / emoji-presentation | 2       | the modern-terminal default, and what the glyph vocabulary assumes |
| East Asian Wide / Fullwidth         | 2       | EastAsianWidth.txt                                                 |
| East Asian Ambiguous                | 1       | the Western-locale default                                         |
| Format, combining, control          | 0       | occupies no cell                                                   |

**±1 column per emoji is expected and tolerated** — these are floors on
legibility, not layout guarantees. Silent shearing of an _aligned_ column is not
tolerable, which is the distinction that decides where exactness matters.

`bulletMaxWords` and `bulletMaxColumns` **both** apply, whichever bites first.
They bound different failures: many short words, versus one enormous token. A
`sha256:` digest is a single word and a horizontal wall, which is precisely what
the word budget alone let through.

`proseBlockMaxLines` is held strictly below `headingRequiredAboveLines` — a
test asserts the relation — so prose cannot grow into a wall in the gap between
the two rules.

Brevity is the default. When the owner asks for detail the answer gets longer,
not looser: a long report is still answer-first, still headed, still bulleted.

### Prose throws; data degrades

`renderHumanReport` enforces the limits two different ways, and which one
applies is decided by **who controls the input**, not by which limit it is.

| Field          | Over the limit                                      | Why                                                                                                                       |
| -------------- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `lead`, `body` | **throws**                                          | prose an author typed — a wall here is a programming error, and the call site that can fix it should hear about it loudly |
| `bullets`      | **elided / capped, and the shortfall is announced** | data (doctor findings, evidence rows, work units) whose count and length are unknown when the code is written             |

Throwing on data would turn "the host has eleven findings" into a crashed
command, which is strictly worse than a capped list. So an over-long bullet is
cut at `bulletMaxWords` with a `…`, a section past `sectionMaxBullets` keeps the
first `sectionMaxBullets` and appends `… N more (--json for all)`, and nothing
is ever dropped **silently** — a truncated list that does not say it was
truncated reads as a complete one, which is the exact failure this whole policy
exists to prevent. `--json` remains the lossless channel in both cases.

## Enforcement, honestly

| Surface               | Enforcement                                                                                                                                    |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| CLI stdout            | **Structural.** `renderHumanReport` heads every section by construction and enforces all six limits — see "Prose throws; data degrades" above. |
| Manager session prose | **Instruction, plus a blocking `Stop` gate** — `hooks/stop-report-format-gate.mjs`. See below.                                                 |
| Outbound artifacts    | **Blocking lint** — but under `CommunicationPolicy`, not this one.                                                                             |

### The manager channel, corrected (2026-08-11)

This section used to end here, saying the manager channel was instruction-only
because "there is no deterministic signal to hang one on". **That was wrong**,
and the evidence disproving it was already in the repository when it was
written: `docs/engine-baseline.md` §19.3 records that the `Stop` payload carries
`last_assistant_message`, probe-verified at engine 2.1.220, and even flags it as
"the field a regex-classifying gate would key on".

The claim was right about the AUTONOMY gate and got over-generalised. Whether a
run is in flight is something the supervisor knows authoritatively, so
classifying it from prose would be guessing at an answer already available —
which is exactly why `stop-autonomy-gate.mjs` asks the supervisor instead.
Formatting is the opposite case: it is a property OF the text, so the text is
not a proxy for the signal, it IS the signal.

`hooks/stop-report-format-gate.mjs` is that gate. Two rules, both deliberately
blunt: an over-long prose paragraph, and a long message carrying no heading,
bullet or table at all. Code fences, tables, blockquotes and bullets are exempt,
because each legitimately runs long and flagging one would be a false positive
on a well-formed report.

**It measures characters where the renderer measures lines, and that is not an
inconsistency.** `proseBlockMaxLines` counts newlines, which is correct for CLI
stdout because that stream is not re-wrapped. The manager writes into a
markdown-rendering TUI that does re-wrap, where the commonest wall of all — one
900-character paragraph — contains no newline and would pass a line count while
filling the screen. Same limit, two channels, two correct spellings of it; the
character budget is derived from the line budget rather than invented, and a
parity test pins both to `HUMAN_REPORT_LIMITS`.

**It blocks at most once per turn**, via `stop_hook_active` (§19.2). If the
re-render is still over budget the turn ends anyway: the gate exists to catch
the reflex wall, not to hold a session hostage to a formatter. It fails open on
every error path, for the same reason the autonomy gate does — a false positive
costs the owner a wasted round trip, and a hook that runs on every session end
must never be able to trap one.

What remains unenforceable is everything below the wall threshold: bullet word
counts, section bullet counts, whether the first line is really the answer. For
those the mitigation is unchanged — the rules are short, always in context, and
quoted from a single constant rather than restated, so they cannot drift out of
agreement with the code.
