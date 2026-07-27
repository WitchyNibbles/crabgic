---
"crabgic": minor
---

Add a presentation policy for owner-facing output.

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
