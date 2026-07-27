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

Consumers:

- `packages/cli/src/output/human.ts` — the human-mode stdout primitives.
- `packages/cli/src/output/status-renderer.ts` — `status --watch`.
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

| Limit                       | Value | Rule                                                      |
| --------------------------- | ----- | --------------------------------------------------------- |
| `leadAnswerMaxLines`        | 2     | the conclusion comes first, in at most two lines          |
| `headingRequiredAboveLines` | 5     | past five lines, a report needs headings                  |
| `proseBlockMaxLines`        | 3     | the longest unbroken paragraph                            |
| `bulletMaxWords`            | 15    | a bullet is scannable in one fixation                     |
| `sectionMaxBullets`         | 7     | past seven, split the section or use a table              |
| `tableMinRows`              | 3     | three-plus items with two-plus attributes each is a table |

`proseBlockMaxLines` is held strictly below `headingRequiredAboveLines` — a
test asserts the relation — so prose cannot grow into a wall in the gap between
the two rules.

Brevity is the default. When the owner asks for detail the answer gets longer,
not looser: a long report is still answer-first, still headed, still bulleted.

## Enforcement, honestly

Only part of this is enforceable.

| Surface               | Enforcement                                                                                              |
| --------------------- | -------------------------------------------------------------------------------------------------------- |
| CLI stdout            | **Structural.** `renderHumanReport` throws on an over-long lead and heads every section by construction. |
| Manager session prose | **Instruction only.** The `CLAUDE.md` block states the rules; a model's prose cannot be linted mid-turn. |
| Outbound artifacts    | **Blocking lint** — but under `CommunicationPolicy`, not this one.                                       |

This is the same limitation `manager-protocol.ts` already records for the
autonomy rules: _"Prose is not enforcement."_ There is no equivalent of the
`stop-autonomy-gate.mjs` hook for formatting, because there is no deterministic
signal to hang one on. The mitigation is that the rules are short, always in
context, and quoted from a single constant rather than restated — so they
cannot drift out of agreement with the code.
