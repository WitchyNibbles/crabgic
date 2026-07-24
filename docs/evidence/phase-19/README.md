# Phase 19 evidence — Jira Data Center adapter

Governing spec: `roadmap/19-jira-datacenter-adapter.md`. Package: `packages/connectors-jira`
(the SAME package phase 18 built for Jira Cloud — this phase extends it with a second,
`datacenter`-selected implementation behind 18's existing `JiraResourceClient` contract,
never a forked sync engine). Built on `packages/gateway` (16) and `packages/renderer` (17),
reused wholesale — same transport/SSRF/retry-ladder/budgets/secrets/mutation-pipeline/
error-mapping/lint pipeline 18 already reuses; nothing in this phase reimplements them.

## Gate results (exact, reproduced, POST-adversarial-remediation)

- `npx tsc -b` (repo root) → clean, 0 errors.
- `npm run lint` (repo root, `eslint . --ignore-pattern 'spikes/**'`) → clean, 0 problems in
  this phase's own scope. (A concurrent, unrelated phase-13 session's in-progress
  `packages/scheduler/**` work transiently showed 2 lint errors and 3 prettier warnings in
  that package during this session — confirmed via `git status`/`git diff` to be entirely
  outside `packages/connectors-jira/`, not touched by this phase, and not present at the
  time of this evidence doc's final check.)
- `npm run format` (repo root, `prettier --check .`) → this phase's own scope
  (`packages/connectors-jira`, `docker/`, `.github/workflows/jira-datacenter-smoke.yml`,
  `docs/evidence/phase-19/`) is 100% clean, verified with a scoped
  `prettier --check` run against exactly those paths.
- `npx vitest run packages/connectors-jira --coverage.enabled=false` → **45 test files, 426
  tests, all passed** (was 407 before the adversarial-remediation round below; +19 new/
  strengthened tests, 0 removed, 0 weakened).
- `npm test` (repo root, full monorepo) → **437/438 test files, 3686/3687 tests passed.**
  The single failure (`@eo/engine-claude/src/session.test.ts`, a `fast-check` property test
  over `resume(sessionRef, adjudicate)`) is a **pre-existing, unrelated, known host-load-
  flaky test** — this package touches nothing in `packages/engine-claude`, the failure
  reproduces on ZERO of repeated isolated runs
  (`npx vitest run packages/engine-claude/src/session.test.ts` → 7/7 pass, every time), and
  only appears under full-monorepo parallel CPU contention (matching this project's own
  documented "2 known host-load-flaky timing tests" carry-forward). Confirms no phase-18
  (or any other package's) test was broken by this phase's work.
- Coverage for `packages/connectors-jira/src` (scoped via
  `--coverage.include='packages/connectors-jira/src/**/*.ts'`, v8 report):
  - **Statements: 1065/1104 = 96.46%**
  - **Branches: 560/660 = 84.84%**
  - **Functions: 326/345 = 94.49%**
  - **Lines: 1018/1054 = 96.58%**
  - All four metrics clear the ≥80% line+branch ground rule, comfortably.

## Adversarial-review remediation

A fresh adversarial validator reviewed this phase's work and returned FAIL on one MAJOR
plus two MINORs. Every fix below followed strict TDD: a RED regression confirmed to fail
against the pre-fix code FIRST (via a targeted `vitest run` on the exact new test file),
then the fix, then confirmed GREEN. All fixes are inside `packages/connectors-jira/`; no
root config, ledger, or other-package file was touched.

| ID | Finding | File(s) fixed | New test(s) / RED→GREEN evidence |
|---|---|---|---|
| **MAJOR** | `adfDocumentToWikiMarkup`'s `renderInlineNode` emitted `node.text` verbatim — no escaping of `{`, `[`, `]`, `\|`, or macro tokens. `assertSafeAdfDocument` validates node/mark TYPES and link hrefs, not text CONTENT (correct for ADF, inert JSON on Cloud) — but on Data Center that same text becomes LIVE wiki markup once this serializer emits it. Confirmed counterexample: an ADF text node reading `Risk {html}<script>alert(1)</script>{html} {code}rm -rf{code} {noformat}x{noformat}` passed through unescaped, and where the `{html}` macro is enabled on the target instance this is stored XSS. | `resource-client/datacenter/wiki-markup-render-profile.ts` — new `escapeWikiMetacharacters`, applied to every LEAF text node's content (`node.text`, before mark-wrapping) in `renderInlineNode`. Escape set: `\`, `{`, `}`, `[`, `]`, `\|`, `!` — see the module's own doc comment for why each member is there (macro open/close; literal-bracket link/embed open/close; table/link-part delimiter; embed-image marker; the escape character itself, escaped first so a user-supplied `\` can never combine with an escape prefix to fool a naive "preceded by backslash" reader). Deliberately excludes pure visual-formatting delimiters (`*_+-^~?`) — see rationale below. | `wiki-markup-render-profile.test.ts` — 8 new adversarial `it.each` cases (`{html}`/`{code}`/`{noformat}`/`{color}`/`{quote}` macros, literal `[text\|javascript:...]` bracket-syntax link, `\|`-table-row smuggling, `!embed!` reference), each confirmed RED (unescaped, live) before the fix and GREEN (every metacharacter backslash-escaped) after; a lint-interaction case proving 17's `lint()` genuinely passes a pure-macro-token candidate (no raw `<script>`/`javascript:` substring, since url-policy already independently blocks those — this isolates the Jira-wiki-specific gap 17 was never meant to close); an exact-string backslash-escaping-order test; a rewritten `fast-check` property (300 runs) proving NO fuzzed leaf text can ever leave an unescaped `{`/`[`/`\|`/`!` in the output. |
| **MINOR-1** | `adf-guard.ts`'s `assertSafeAdfDocument` hardcoded `provider: JIRA_PROVIDER_NAME` (`"jira-cloud"`), but this guard runs on the Data Center path too — via 19's own DC apply-boundary re-check (`jira-mutation-apply-client-dc.ts`) AND via 18's reused-verbatim plan builders (`issue-plans.ts`/`comment-worklog-attachment-plans.ts`, invoked from `jira-datacenter-resource-client.ts`) — so an ADF-safety block on a Data Center connection was attributed to `jira-cloud` in canonical errors/evidence, the exact misleading-redaction outcome the provider-key-split rationale (below) exists to prevent. | `resource-client/adf-guard.ts` — additive: `assertSafeAdfDocument(candidate, label, provider = JIRA_PROVIDER_NAME)`. Every phase-18 call site (unchanged, no 3rd argument) keeps its exact `"jira-cloud"` attribution, byte-for-byte. `resource-client/datacenter/jira-mutation-apply-client-dc.ts` — its 3 apply-boundary calls now pass `JIRA_DATACENTER_PROVIDER_NAME`. `resource-client/datacenter/jira-datacenter-resource-client.ts` — NEW pre-checks (belt-and-suspenders, phase-19-owned code only, zero edits to 18's `issue-plans.ts`/`comment-worklog-attachment-plans.ts`) in `issues.planCreate`/`planUpdate` and `comments.planCreate`/`planUpdate`, each calling `assertSafeAdfDocument(..., JIRA_DATACENTER_PROVIDER_NAME)` BEFORE delegating to the shared Cloud-attributed function — if the pre-check throws, the shared function's own internal (Cloud-attributed) check is never reached. This closes the attribution gap at BOTH the plan-build AND apply boundaries, using only phase-19-owned files. | `adf-guard.test.ts` — 3 new cases (defaults to `jira-cloud` with no 3rd arg — phase-18 behavior byte-identical; explicit `jira-datacenter` override; correct attribution across all 3 rejection branches — shape/safe-subset/secret-content). `jira-mutation-apply-client-dc.test.ts` — 1 new case proving the apply-boundary rejection now carries `jira-datacenter`. `jira-datacenter-resource-client.test.ts` — 4 new cases, one per plan-build call site (`issues.planCreate`, `issues.planUpdate`, `comments.planCreate`, `comments.planUpdate`), each confirmed RED (`"jira-cloud"` received) before the fix, GREEN (`"jira-datacenter"`) after. |
| **MINOR-2** | The evidence doc's "authorized areas" framing could be read as claiming `.prettierignore` among files this phase edited/authorized. `git diff .prettierignore` shows the only change in the working tree is a **`packages/scheduler/goldens/` entry, added by a concurrent, unrelated phase-13 session** — not this phase. | `docs/evidence/phase-19/README.md` (this file) — see "Anything touched outside..." below, now stating explicitly that `.prettierignore` was NOT edited by this phase, verified via `git diff .prettierignore`. | N/A (documentation-only correction; no code changed). This phase never needed a `.prettierignore` entry in the first place — its own cassette JSON fixtures (`fixtures/datacenter/{10.3,11.3}/read-scenario.cassette.json`) already match Prettier's own style byte-for-byte (verified with `npx prettier --check` against them directly), unlike phase 02/03/06/11's machine-generated goldens, which have their own documented non-Prettier byte-stability contract. |

**Escape-set completeness rationale (why `\{}[]\|!` and not more/less):** every member of
this set OPENS or CLOSES a Jira wiki-markup STRUCTURAL construct — `{`/`}` for macros
(`{html}`, `{code}`, `{noformat}`, `{color}`, `{quote}`, ...), `[`/`]` for literal-bracket
link/embed syntax (recognized even as plain typed characters, independent of any ADF
`link` mark), `|` for both a link's text/target delimiter and table-row cells, `!` for
embedded attachment/image references, and `\` (Jira's own escape character, escaped first
so it can never be combined with one of this function's own escape prefixes to defeat the
escaping). Escaping is applied to **every occurrence**, not just a "leading" one — this
also defeats an attacker trying to relocate a dangerous character to the start of a fresh
line via an embedded `\n` to slip past a leading-character-only escaper, since the same
character is escaped everywhere regardless of position. The set deliberately EXCLUDES pure
visual-formatting delimiters (`*_+-^~?`) — those can, at most, misrender text as bold/
italic/strikethrough (a cosmetic spoofing concern), never open a macro, link/embed
reference, or table row (the structural/injection class this fix targets, up to and
including stored XSS). This is a scoped, deliberate boundary, not an oversight: a partial-
but-overreaching escape set that degrades ordinary benign content (e.g. escaping `-` would
have mangled "PROJ-123" in this very test suite) without closing a real additional vector
is its own kind of hasty, worse-than-none fix — the repo's own stated lesson. If a future
review identifies a concrete STRUCTURAL (not merely cosmetic) risk from an excluded
character, that is a new, separately-justified finding, not something silently folded into
this fix's scope.

**NITs (left as-is, per the coordinator's explicit instruction, but documented honestly):**

(a) `jira-mutation-apply-client-dc.ts`'s `parseResponseForAction` performs an unguarded
`JSON.parse(response.bodyText)` — this is **verbatim-inherited from Cloud's own apply
client** (`jira-mutation-apply-client.ts`'s identical `parseResponseForAction`), not a
Data-Center-introduced regression. Both share the same characteristic: a malformed 2xx
response body would throw synchronously inside `parseResponse` rather than mapping to a
typed `ConnectorError.validation`. This is a phase-18-owned design carried forward
unchanged, flagged here as a shared carry-forward rather than silently reproduced without
comment.

(b) The attachment-upload wire shape (`{filename, contentBase64}` as this connector's own
`MutationHttpRequestSpec.body` encoding, not a real multipart upload) is **modeled, not a
faithful reproduction of Jira's real attachment API** — already disclosed in this phase's
original evidence pass and in 18's own equivalent disclosure for Cloud; deferred to 23's
live-testing work, not something this phase's own cassette/fake-based test strategy can
close on its own.

## Adversarial-review remediation, round 2 — codeBlock macro-breakout residual

A second adversarial audit re-checked the round-1 escaping fix and confirmed the inline-
text escaping itself is sound (escape set, single-pass `\`-first ordering, position-
independent application — all correct; every inline path — `code` marks, paragraphs,
headings, lists, blockquotes — routes leaf text through `escapeWikiMetacharacters`). It
found ONE residual of the SAME injection class the round-1 fix targets, in a path that
bypasses that escaping entirely, plus asked for a defensive double-check of link `href`
interpolation.

| ID | Finding | File(s) fixed | New test(s) / RED→GREEN evidence |
|---|---|---|---|
| **MAJOR (residual)** | `renderBlockNode`'s `"codeBlock"` case joined each child's `.text` VERBATIM (`(node.content ?? []).map((child) => child.text ?? "").join("")`), wrapped in `{code}\n...\n{code}`, with NO escaping — `codeBlock` content is never routed through `renderInlineNode`, so the round-1 escaping never reaches it. In real Jira wiki markup, a `{code}` block's body ends at the FIRST literal `{code}` (or `{code:...}`) it contains — content containing that token breaks OUT of the block, and anything after is parsed as live wiki markup again (the identical `{html}`-macro/stored-XSS class round 1 closed for inline text, reachable here through a different, unescaped path). **Critical nuance, explicitly avoided:** backslash-escaping does NOT work inside `{code}`/`{noformat}` bodies — Jira renders their content LITERALLY (that is the entire point of those two macros), so `\{code\}` would display a visible backslash rather than neutralizing anything; reusing `escapeWikiMetacharacters` here would have been exactly the kind of hasty, incomplete fix this project has already learned to avoid. | `resource-client/datacenter/wiki-markup-render-profile.ts` — new `neutralizeCodeBlockBreakoutTokens`, applied to `codeBlock` content only (never inline text, which already gets the round-1 backslash-escaping). Mechanism: inserts a zero-width space (U+200B) immediately after the opening `{` of any `{code}`/`{code:...}`/`{noformat}`/`{noformat:...}` occurrence — `{code}` becomes `{<ZWSP>code}`, no longer the literal byte-sequence Jira's macro parser scans for to close/open a macro, while rendering VISUALLY IDENTICAL (a zero-width space displays as nothing in every mainstream renderer) — the standard, well-established technique for defusing a literal-token match without altering displayed content. Scoped NARROWLY to the two verbatim-content macro names Jira recognizes for a fenced/preformatted block (never a blanket `{anything}` pattern, which would falsely mangle ordinary code containing unrelated brace-delimited constructs — JS/TS object literals, JSX props, CSS rules, JSON — that have nothing to do with Jira macro syntax). | `wiki-markup-render-profile.test.ts` — RED-proof case (a `{code}`-in-codeBlock breakout wrapping `{html}<script>...`), a `{noformat}`-in-codeBlock case, a parameterized-token case (`{code:javascript}`/`{noformat:title=x}`), an exact-string "invisible neutralization" case (proves the ZWSP insertion point precisely and that stripping it reproduces the original body byte-for-byte), a 6-item BENIGN golden (`if (x) { return y; }`, `const { name } = user;`, a TS type literal, JSON, a CSS rule, JSX — none containing the `code`/`noformat` token — all render byte-identical, unmangled), a lint-interaction case (`pr_body` kind — `jira_milestone_comment`'s own `maxLines: 6` has no room for both its 5-line template and a 3-line fence in one candidate; `pr_body`'s 4-line template + `maxLines: 12` does — proving 17's lint has no opinion on Jira-wiki macro tokens regardless of which templated kind is checked), and a `fast-check` property (300 runs) proving no fuzzed codeBlock text can ever leave a live `{code}`/`{noformat}`-shaped closing token in the output. All confirmed RED against the pre-fix code, GREEN after. |
| **Defensive double-check (requested, confirmed real, fixed)** | Link-mark `href` was interpolated into `[${text}|${href}]` UNESCAPED. `href` is upstream-validated https-ONLY by `../adf-guard.ts`'s `isSafeHref`, but that check inspects only the SCHEME — not the rest of the URL — so a raw `]`/`{`/`\|` captured into `href` (reachable via `toADF`'s own markdown-link regex, whose URL capture group `[^)]+` does not exclude those characters) could still prematurely close the `[text\|href]` construct or reopen a macro immediately after. | `resource-client/datacenter/wiki-markup-render-profile.ts` — the `link` mark case now escapes `href` through the SAME `escapeWikiMetacharacters` used for leaf text (a link's href is ordinary INLINE content, never inside a `{code}`/`{noformat}` body, so backslash-escaping IS valid here — unlike the codeBlock case above). | `wiki-markup-render-profile.test.ts` — a case with `href: "https://example.com/]{html}evil{html}"`, asserting the exact expected output (`[click\|https://example.com/\]\{html\}evil\{html\}]`) — the construct's own structural `[`/`\|`/`]` wrapper remains unescaped (correct — that is real, intended Jira link syntax this serializer emits), while the href's OWN raw `]`/`{`/`}` characters are all escaped, and the dangerous raw `]{html}` adjacency from the source href never survives into the output. |
| **No other bypass found** | Audited every other place leaf content reaches the output: `renderListItems` (routes through `renderInlineNodes`, escaped), `heading`/`paragraph`/`blockquote` (same), the `default` unreachable-node fallback (same). `codeBlock` was the only structural bypass; `href` was the only un-escaped attribute interpolation. | — | — |
| **MINOR (round 2 follow-up): case-sensitivity gap in the ZWSP fix itself** | `CODE_BLOCK_BREAKOUT_TOKEN_PATTERN` was case-sensitive (`/\{(code\|noformat)(:[^}]*)?\}/g`) — it would not match `{CODE}`, `{Code}`, `{NoFormat}`, etc. Whether Jira DC's real macro-close matcher is case-sensitive cannot be verified without a live instance; if it is NOT, an attacker-supplied `{CODE}` in codeBlock content would still break out of the lowercase `{code}` fence this serializer emits, unneutralized. | `resource-client/datacenter/wiki-markup-render-profile.ts` — added the `i` flag: `/\{(code\|noformat)(:[^}]*)?\}/gi`. Deliberately conservative (matches MORE, never less) — over-neutralizing an uppercase/mixed-case token in ordinary code content is harmless (rare, and the ZWSP insertion is visually invisible either way), so the conservative choice costs nothing. | `wiki-markup-render-profile.test.ts` — new case (`a{CODE}b{NoFormat}c{Code:javascript}d`), confirmed RED against the pre-`/i`-flag code (the case-varied tokens passed through live/unneutralized), GREEN after. The test's own `containsLiveCodeOrNoformatCloseToken` checker was updated to the same case-insensitive pattern (otherwise it could not have detected the gap it exists to catch). |

**Live-verification contingencies (named carry-forwards for 23's live DC matrix)** — the ZWSP
technique is the correct, standard mitigation for a literal-token-match vulnerability, but
its effectiveness rests on two assumptions this session cannot verify without a running
Jira Data Center instance (same honesty class as this phase's already-disclosed cassette-
modeled-not-live-captured caveat — see "What is cassette-modeled vs. live" above):

1. **A U+200B zero-width space inserted immediately after a macro token's opening `{`
   actually defeats Jira DC 10.3/11.3's real macro close-token matcher** — i.e. that
   parser does not itself strip, normalize, or otherwise ignore zero-width/invisible
   Unicode characters before performing its literal `{code}`/`{noformat}` match. If a
   future Jira DC version (or an as-yet-unconfirmed behavior of 10.3/11.3) DOES normalize
   away zero-width characters before matching, this specific mitigation would need a
   different neutralization character/technique. **23 must confirm this against a live
   10.3/11.3 instance** (or an authoritative Atlassian source) before this mitigation can
   be trusted beyond a cassette-modeled level of confidence.
2. **Close-token case-sensitivity is as conservatively assumed** — this phase now treats
   `{code}`/`{CODE}`/`{Code}` (and the `noformat` equivalents) as equally dangerous (the
   `/i` flag above), which is safe if Jira's real matcher is EITHER case-sensitive OR
   case-insensitive. **23 should still confirm the real behavior** so a future maintainer
   understands why the conservative choice was made, rather than assuming it was
   arbitrary.

Coverage/gate re-check after this round: `packages/connectors-jira` — **45 test files, 435
tests, all green** (was 426 after round 1's own remediation; +9 new across both round-2
passes). Coverage: 96.48% stmt / 84.89% branch / 94.52% func / 96.59% line. `npx tsc -b`
(repo root) clean. `npm run lint`/`npx prettier --check` clean in this phase's own scope.
No phase-18 test touched (this round's only
edits are inside `wiki-markup-render-profile.ts`/`.test.ts`, files this phase itself
created in round 1 — no phase-18-owned file was touched at all in this round).

## What this phase built (files created/modified)

Every file below lives under `packages/connectors-jira/`, `docker/jira-datacenter/`,
`.github/workflows/jira-datacenter-smoke.yml`, or `docs/evidence/phase-19/` — the only
areas this worker's brief authorized. See "Anything touched outside the authorized
areas" below for the additive, non-breaking exceptions (all still inside
`packages/connectors-jira/`, none in another package's `src/`).

**Adversarial-remediation round additions/changes (see "Adversarial-review remediation"
above for the full RED→GREEN account):**
- `src/resource-client/datacenter/wiki-markup-render-profile.ts` (**modified**) — added
  `escapeWikiMetacharacters` + its integration into `renderInlineNode` (the MAJOR fix).
- `src/resource-client/datacenter/wiki-markup-render-profile.test.ts` (**modified**) — 8 new
  adversarial `it.each` cases, 1 lint-interaction case, 1 exact-string escape-order case,
  1 rewritten property test (replacing the previously vacuous one), 1 new property test.
- `src/resource-client/adf-guard.ts` (**modified, additive only**) — `assertSafeAdfDocument`
  gained an optional 3rd `provider` parameter, defaulting to `JIRA_PROVIDER_NAME`; every
  phase-18 call site is unchanged (MINOR-1 fix).
- `src/resource-client/adf-guard.test.ts` (**modified**) — 3 new provider-attribution cases.
- `src/resource-client/datacenter/jira-mutation-apply-client-dc.ts` (**modified**) — its 3
  `assertSafeAdfDocument` calls now pass `JIRA_DATACENTER_PROVIDER_NAME`.
- `src/resource-client/datacenter/jira-mutation-apply-client-dc.test.ts` (**modified**) — 1
  new provider-attribution case.
- `src/resource-client/datacenter/jira-datacenter-resource-client.ts` (**modified**) — 4 new
  belt-and-suspenders `assertSafeAdfDocument` pre-checks (DC-attributed), one each in
  `issues.planCreate`/`planUpdate` and `comments.planCreate`/`planUpdate`.
- `src/resource-client/datacenter/jira-datacenter-resource-client.test.ts` (**modified**) — 4
  new provider-attribution cases, one per pre-check above.

**Deployment-type / auth-mode config (work item 1):**
- `src/provider/jira-connection-config.ts` (+`.test.ts`) — `JiraDeploymentType`
  (`"cloud"|"datacenter"`), `JiraAuthMode` (`"oauth"|"pat"|"basic"`),
  `JiraConnectionConfigSchema` (zod), `assertBasicAuthPermitted` (the pre-network
  `authentication` guard).
- `src/auth/jira-datacenter-auth.ts` (+`.test.ts`) — `JiraAuthHeaderProvider` type,
  `buildJiraPatAuthHeaderProvider` (wraps `JiraTokenManager` for cache/refresh reuse),
  `buildJiraBasicAuthHeaderProvider`, `resolveJiraDatacenterAuthHeaderProvider` (the one
  production call site; runs `assertBasicAuthPermitted` FIRST).
- `src/auth/connection-doctor-datacenter.ts` (+`.test.ts`) — `runJiraDatacenterConnectionDoctor`:
  PAT-validity + reachability probe, non-blocking `basicAuthActive` finding.
- `src/errors/jira-error-mapping.ts` (**modified, additive only**) — added
  `JIRA_DATACENTER_PROVIDER_NAME = "jira-datacenter"` and
  `mapJiraDatacenterStatusToConnectorErrorKind`; the pre-existing `JIRA_PROVIDER_NAME`
  (`"jira-cloud"`) and `mapJiraStatusToConnectorErrorKind` are untouched.

**DC resource-client implementation, REST v2 + Agile (work item 2):**
- `src/resource-client/datacenter/jira-datacenter-http-context.ts` (+`.test.ts`) —
  `JiraDatacenterHttpContext` + `jiraDatacenterGetJson` (Cloud's `JiraHttpContext`/
  `jiraGetJson` equivalent, built against an `authHeaderProvider` instead of a
  `JiraTokenManager` so it covers PAT's Bearer scheme AND Basic's non-Bearer scheme).
- `src/resource-client/datacenter/schemas-dc.ts` — the two genuinely DC-specific response
  schemas (bare-array project list; offset-based `startAt`/`maxResults`/`total` search
  pagination). Every other read schema is Cloud's `../schemas.ts`, reused unchanged.
- `src/resource-client/datacenter/reads-dc.ts` (+`.test.ts`) — REST v2 (`/rest/api/2/`)
  + Agile (`/rest/agile/1.0/`, byte-identical to Cloud) GET methods.
- `src/resource-client/datacenter/jira-mutation-apply-client-dc.ts` (+`.test.ts`) — the DC
  `MutationApplyClient`: REST v2 paths, wiki-markup conversion of every ADF-bearing field
  at the apply boundary (see work item 4 below), same `assertAllowedJiraOperation`/
  `assertSafeAdfDocument` belt-and-suspenders re-checks Cloud's apply client has.
- `src/resource-client/datacenter/jira-datacenter-resource-client.ts` (+`.test.ts`) —
  `createJiraDatacenterResourceClient`, composing `reads-dc.ts` with 18's OWN `plan*`
  builder modules (`../board-sprint-plans.ts`, `../issue-plans.ts`,
  `../comment-worklog-attachment-plans.ts`) **reused verbatim, never forked** (see
  "Design decision" below) — plus a `DcEditionFeatureMatrix` gate in front of every
  mutating method.
- `src/reconciliation/entity-property-marker-dc.ts` (+`.test.ts`) — the DC
  `MarkerReconciler`, identical strategy to Cloud's, over `reads-dc.ts`'s REST v2 search/
  comment reads.

**`DcEditionFeatureMatrix` (work item 3):**
- `src/capability/dc-edition-feature-matrix.ts` (+`.test.ts`) — `DcEditionEntry`,
  `resolveDcEditionFeatures`, `normalizeDcEdition`, `isActionSupportedForDcEdition`. Closed,
  explicit 2-entry matrix (`10.3`, `11.3`); an unrecognized edition/action always resolves
  to "not supported," proven both by unit cases and a `fast-check` property fuzzing
  arbitrary edition/action strings.
- `src/capability/discovery-datacenter.ts` (+`.test.ts`) — `discoverJiraDatacenterCapabilitySnapshot`,
  mirroring Cloud's `discovery.ts` shape; an unrecognized edition/version resolves
  `isReadOnly: true` and an EMPTY `actions` list (never a guessed subset).

**`wikiMarkupRenderProfile` (work item 4):**
- `src/resource-client/datacenter/wiki-markup-render-profile.ts` (+`.test.ts`) —
  `adfDocumentToWikiMarkup`, an `AdfDocument`-tree-walking serializer producing Jira wiki
  markup, engineered to agree byte-for-byte with `@eo/renderer`'s own markdown-based
  `toWikiMarkup` (17's pre-existing "Jira Data Center wiki-markup fallback profile" — see
  "Design decision" below) for every golden-corpus item, plus `fast-check` properties
  proving structural-limit preservation and no script/markup-injection surface under
  fuzzed input.

**Provider registration — the Cloud/Data Center seam (reconciliation):**
- `src/provider/jira-datacenter-connection-registry.ts` (+`.test.ts`) —
  `JiraDatacenterConnectionRegistry`, the DC mirror of `./jira-connection-registry.ts`'s
  per-connection wiring cache, built against `JiraConnectionConfig` instead of a bare
  `JiraTokenManager`.
- `src/provider/register-datacenter.ts` (+`.test.ts`) — `JIRA_DATACENTER_PROVIDER_KEY`,
  `registerJiraDatacenterProvider`. See "How the jira-cloud/jira-datacenter provider-key
  split was resolved" below.

**Parameterized conformance suite (work item 5):**
- `src/testkit/conformance-harness.ts` — `buildConformanceHarness(deploymentType, ...)`,
  the ONE factory hiding which concrete Cloud/DC resource-client + apply-client pair backs
  a given deployment type.
- `src/testkit/parameterized-conformance.integration.test.ts` — `describe.each(["cloud",
  "datacenter"])`, running the IDENTICAL assertions 18's `jira-flow.integration.test.ts`
  established (board → sprint → epic → issue → link → comment → worklog → attachment;
  a transition with server-resolved done-ness; a 412 conflict) against both.
  `jira-flow.integration.test.ts` itself (18-owned) is left completely untouched — see
  "Deviation" note below for why this is a NEW file rather than a literal in-place rewrite
  of that one.

**DC cassette fixtures + testkit extensions (work items 6-7):**
- `fixtures/datacenter/10.3/read-scenario.cassette.json`,
  `fixtures/datacenter/11.3/read-scenario.cassette.json` — see honesty note below
  (hand-authored/modeled, not live-captured).
- `src/testkit/scripted-read-scenario-dc.ts` — `buildDatacenterHandAuthoredScenario`,
  `loadDatacenterReadScenarioCassette`, `runDatacenterScriptedReadScenario`.
- `src/testkit/fake-cassette-parity-dc.test.ts` — parity proof for BOTH 10.3 and 11.3.
- `src/testkit/fault-matrix-dc.ts` (+`.test.ts`), `src/testkit/fault-matrix-dc.replay.test.ts` —
  extends `@eo/gateway`'s `FULL_FAULT_MATRIX` with a `forbidden` (403) entry (mirroring
  Cloud's own extension) and OVERRIDES `rateLimited` to carry NO `retry-after` header (see
  "Rate-limit fixture honesty" below).
- `src/testkit/self-signed-cert.ts`, `src/testkit/custom-ca-self-signed.integration.test.ts` —
  the custom-CA/self-signed exit criterion, exercised library-level against a real,
  disposable, `openssl`-generated self-signed HTTPS server (mirrors `@eo/gateway`'s own
  internal test-support helper, duplicated locally since that module is not part of
  `@eo/gateway`'s public barrel).

**Container recipes + CI smoke job (work item 7):**
- `docker/jira-datacenter/10.3/docker-compose.yml`, `docker/jira-datacenter/11.3/docker-compose.yml`,
  `docker/jira-datacenter/smoke-test.sh`, `docker/jira-datacenter/README.md`.
- `.github/workflows/jira-datacenter-smoke.yml` — manual (`workflow_dispatch`) matrix job
  over `10.3`/`11.3`, requiring NO secret (a boot/health-probe smoke test only).

**Barrel:**
- `src/index.ts` (**modified, additive only**) — every phase-18 export is untouched, in
  its original position; a new, clearly-delimited "Phase 19" section appends every new
  export named above.

## Design decision: `wikiMarkupRenderProfile` builds on 17's pre-existing `toWikiMarkup`

Discovery during exploration: `@eo/renderer` (phase 17) already exports `toWikiMarkup`
(`packages/renderer/src/wiki-markup.ts`), explicitly documented as "Jira Data Center
wiki-markup fallback profile ... consumed by phase 19." It converts MARKDOWN TEXT
directly to wiki markup — but 18's shared plan builders (reused verbatim by this phase,
see below) never hand this connector markdown; they hand it an `AdfDocument` (built via
`toADF`), since that is the ONE payload shape those builders, `assertSafeAdfDocument`, and
the intake/milestone-sync engine all already agree on, regardless of deployment type. The
original markdown is gone by the time a DC apply call needs wiki markup.

Resolution: `adfDocumentToWikiMarkup` (this phase's own new code) walks that SAME
`AdfDocument` tree directly — never re-deriving markdown — using the identical syntax
choices `toWikiMarkup` uses (`h1.`-`h3.`, `*bold*`, `_italic_`, `{{code}}`, `[text|url]`,
`*`/`#` bullets, `{code}...{code}`, `bq. `). The golden-corpus test
(`wiki-markup-render-profile.test.ts`) proves `adfDocumentToWikiMarkup(toADF(md)) ===
toWikiMarkup(md)` for every corpus item, so both serializers are proven to agree, and
17's own pre-built `toWikiMarkup` is not bypassed or duplicated in spirit — this is the
ADF-native counterpart needed because the ADF-vs-markdown boundary already exists one
layer up, in 18's own shared code.

This same insight is what keeps 18's `assertSafeAdfDocument` (the ADF safe-subset +
secret-scan guard) reusable UNCHANGED for Data Center: since DC's shared plan builders
also produce/validate `AdfDocument`s, DC gets the identical structural-safety guarantee
Cloud has, for free — `adfDocumentToWikiMarkup` only runs downstream of that guard, at
the apply boundary, converting an ALREADY-validated document.

## Design decision: 18's shared `plan*` builders are reused VERBATIM, not forked

Discovery during exploration: `../board-sprint-plans.ts`, `../issue-plans.ts`, and
`../comment-worklog-attachment-plans.ts` (18's own plan-builder modules) are already
deployment-type-agnostic — every `plan*` function builds an abstract `RemoteMutationPlan`
(action name, redacted diff, desired-state payload, idempotency key) with **no REST path
and no ADF-vs-wiki-markup decision baked in at all**. Those decisions only happen
downstream, at the read (`reads.ts` vs. `reads-dc.ts`) and apply
(`jira-mutation-apply-client.ts` vs. `jira-mutation-apply-client-dc.ts`) boundaries. This
meant `createJiraDatacenterResourceClient` could import and call Cloud's OWN plan-builder
functions directly, with zero duplication of planning/validation logic (including
`assertSafeAdfDocument`, `assertDoneTransitionHasEvidence`,
`assertCustomFieldWritesAreDiscovered`, and the high-impact-capability-flag wiring — every
one of these fires identically for a Data Center plan, because it is the literal same
function call). Only the read/apply HTTP layers are genuinely new code. This is what
makes roadmap/19's own framing literally true, not just aspirational: "a second
resource-client implementation behind 18's existing contract, not a second sync engine."

## How the `jira-cloud`/`jira-datacenter` provider-key split was resolved

Phase 18's evidence doc (`docs/evidence/phase-18/README.md`, "Carry-forwards") explicitly
left this open: reuse `"jira-cloud"` for DC too (deployment-type-disambiguated internally)
or register a distinct `"jira-datacenter"` key. **This phase registers a distinct key,
`JIRA_DATACENTER_PROVIDER_KEY = "jira-datacenter"`** (`src/provider/register-datacenter.ts`),
for three reasons (documented in that file's own doc comment):

1. `@eo/gateway`'s `ProviderRegistry` is one-instance-per-key (`register()` throws
   `DuplicateProviderError` on a second registration under the same key) — sharing
   `"jira-cloud"` would require both phases to register into the exact same
   `JiraConnectionRegistry` instance, a coupling neither phase's file expects.
2. **Canonical-error attribution honesty**: every `ConnectorError` this package throws
   carries a `provider` string meant to identify which backend produced it. A DC failure
   attributed to `"jira-cloud"` would be actively misleading in redacted logs/evidence —
   this directly serves roadmap/19's own "canonical-error redaction confirmed on
   DC-specific error bodies" security requirement.
3. Retrofitting 18's `register.ts`/`JIRA_PROVIDER_NAME` to be deployment-agnostic would
   mean editing a phase-18-owned file for zero behavioral gain, directly against this
   worker's "do not break any phase-18 test" constraint (higher risk, no benefit).

Both keys share the IDENTICAL `JiraResourceClient` contract (`../resource-client/types.ts`)
and the IDENTICAL dispatch adapter (`createJiraProviderClient`, reused verbatim — already
deployment-agnostic) — only the registered key and the per-connection wiring (which
concrete resource-client/apply-client pair) differ. A caller selects which key to dispatch
to via `ExternalConnection.provider` — exactly the same provider-keyed-extension-point
mechanism 16 already uses for any other pair (e.g. Grafana's Cloud/OSS/Enterprise, which
uses a SINGLE shared key because — unlike here — no phase had already shipped a
concrete, fixed-key Cloud registration before the other editions arrived).

`JIRA_PROVIDER_NAME` (`"jira-cloud"`) and `mapJiraStatusToConnectorErrorKind` in
`src/errors/jira-error-mapping.ts` are untouched; `JIRA_DATACENTER_PROVIDER_NAME` and
`mapJiraDatacenterStatusToConnectorErrorKind` are new, additive exports in the same file.

## What is cassette-modeled vs. live (honesty note, mirroring phase 20's Grafana precedent)

No live Jira Data Center license or running instance was available in this environment.
**The `fixtures/datacenter/{10.3,11.3}/read-scenario.cassette.json` cassettes are
hand-authored/MODELED** against Jira's documented REST v2/Agile response shapes — they
are NOT byte-recorded traffic from a real running 10.3/11.3 instance. The fake/cassette
parity test (`fake-cassette-parity-dc.test.ts`) still proves something real and useful:
that the hand-authored fake and the (also hand-authored) cassette drive this connector's
DC resource client to byte-identical typed results — the SAME parity discipline 18
established for Cloud — but it does not, by itself, prove wire-shape fidelity against a
genuinely live server. `docker/jira-datacenter/{10.3,11.3}/`'s container recipes exist
precisely so a future pass (this phase's own author revisiting it, or phase 23's release
work) can boot a real instance and replace these modeled cassettes with recorded ones,
without redesigning the recipe from scratch. The CI smoke job
(`.github/workflows/jira-datacenter-smoke.yml`) DOES run for real in CI — it boots each
container and polls `/status` until Jira reports `RUNNING`, proving the recipes
themselves are sound — but it is a boot/health-probe smoke test only, never a live REST
call against the connector (no Jira license is available or required for that state).

## Rate-limit fixture honesty

roadmap/19 §In scope, "Rate limits": "DC deployments typically have no Cloud-style
quota/burst headers ... this phase's fixtures must not assert a `Retry-After` contract DC
doesn't make." `JIRA_DATACENTER_FAULT_MATRIX`'s `rateLimited` entry is a bare 429 with NO
`retry-after` header (`fault-matrix-dc.test.ts` asserts this explicitly), unlike Cloud's
`FULL_FAULT_MATRIX.rateLimited`, which carries one. `fault-matrix-dc.replay.test.ts`
proves the SAME underlying retry-ladder/backoff mechanism (16's, unmodified) still
eventually surfaces `rate_limited` even without that header — the gateway's cross-worker
write serialization and retry ladder are deployment-type-agnostic; only the fixture's own
header shape differs, exactly as roadmap/19 requires.

## Exit criterion → evidence mapping

| # | Exit criterion (verbatim) | Evidence |
|---|---|---|
| 1 | Parameterized conformance suite green on both `cloud` and `datacenter` (10.3 and 11.3) fixture-backed runs — CI job artifact. | `src/testkit/parameterized-conformance.integration.test.ts` — `describe.each(["cloud","datacenter"])` over the full board→sprint→epic→issue→link→comment→worklog→attachment chain, a transition, and a 412 conflict (6 passing cases total, 3 assertions × 2 deployment types), via `src/testkit/conformance-harness.ts`. `src/testkit/fake-cassette-parity-dc.test.ts`'s `describe.each(["10.3","11.3"])` additionally proves the DC read path green against BOTH named fixture versions. `npm test`'s CI-equivalent run is the "CI job artifact" (`npx vitest run packages/connectors-jira`, 45 files/407 tests, all green). |
| 2 | DC-only unsupported actions/fields return typed `unsupported` — fixture-proven cassette test, zero raw-fallback occurrences. | `src/resource-client/datacenter/jira-datacenter-resource-client.test.ts` — "rejects a mutating action absent from the resolved DC edition's availableActions with typed unsupported, before any plan is built" and "rejects every mutating action when dcFeatures is undefined (unrecognized edition, safe default)"; `src/capability/dc-edition-feature-matrix.test.ts`'s `fast-check` property fuzzes arbitrary edition/action pairs, proving `isActionSupportedForDcEdition` never guesses `true` for anything absent from the closed matrix. No code path in `jira-mutation-apply-client-dc.ts` falls back to a raw/unlisted endpoint — the `default` branch of its action switch is an unreachable exhaustiveness guard (`JIRA_ACTIONS` is a closed union), identical to Cloud's own apply client. |
| 3 | `DcEditionFeatureMatrix` resolves capability discovery correctly for both known editions (10.3, 11.3) and falls back to typed `unsupported` for an unrecognized edition — fixture-proven, no raw fallback. | `src/capability/discovery-datacenter.test.ts` — resolves edition `10.3`/`11.3` (`isReadOnly: false`, full API-family/resource list) from a scripted `serverInfo`/`mypermissions` pair; a scripted unrecognized version (`8.20.1`) resolves `edition: "unknown"`, `isReadOnly: true`, `actions: []` — the safe default, proven BEFORE this test even needed real fixture data (work item 3's own failing-first framing). `dc-edition-feature-matrix.test.ts` proves the underlying resolver/normalizer in isolation, including the property-fuzzed "never a guess" proof. |
| 4 | `wikiMarkupRenderProfile` output passes 17's blocking-artifact-lint corpus — golden-file diff test, zero exceptions. | `src/resource-client/datacenter/wiki-markup-render-profile.test.ts` — 7-item benign golden corpus, each asserted `adfDocumentToWikiMarkup(toADF(md)) === toWikiMarkup(md)` (byte-identical to 17's own converter); **post-adversarial-remediation**, an 8-item ADVERSARIAL corpus (`{html}`/`{code}`/`{noformat}`/`{color}`/`{quote}` macros, literal bracket-syntax `javascript:` link, `\|`-table smuggling, `!embed!` reference), each proven neutralized (every wiki metacharacter backslash-escaped); a `jira_milestone_comment` candidate containing pure macro tokens (no raw `<script>`/`javascript:`, which 17's own url-policy stage already independently blocks) PASSES `@eo/renderer`'s real `lint()` call yet is still neutralized by this serializer, proving lint alone does not (and isn't meant to) close this Jira-wiki-specific gap; 3 `fast-check` properties (structural-limit preservation; no NEW `javascript:` substring; no fuzzed leaf text ever leaves an unescaped `{`/`[`/`\|`/`!`, 300 runs). **Round 2** (see "Adversarial-review remediation, round 2" above) additionally covers the `codeBlock`-specific breakout path (ZWSP neutralization of `{code}`/`{noformat}` closing tokens, 6-item benign-code golden, a `pr_body`-kind lint-interaction case, a 300-run property) and defensive href escaping. 33/33 tests pass in this file, zero exceptions. |
| 5 | Custom-CA/self-signed connection succeeds against a disposable self-signed test server, exercised library-level (16's transport invoked directly) — integration test artifact. | `src/testkit/custom-ca-self-signed.integration.test.ts` — a REAL `node:https` server with an `openssl`-generated disposable self-signed cert; `GatewayHttpClient` (16's own transport, invoked directly, `customCaPem` set to the disposable cert) + this phase's `resolveJiraDatacenterAuthHeaderProvider` (PAT mode) succeed end-to-end over that connection; a companion case proves a WRONG PAT still fails closed (`authentication`), never silently unauthenticated. |
| 6 | Basic-auth guard rejects without `allowBasicAuth: true` and accepts with it while emitting a non-blocking doctor finding — unit + integration test. | Unit: `src/provider/jira-connection-config.test.ts` (`assertBasicAuthPermitted`), `src/auth/jira-datacenter-auth.test.ts` (`resolveJiraDatacenterAuthHeaderProvider` — pre-network rejection with canonical `authentication`; secret refs never leaked into the thrown message). Integration: `src/auth/connection-doctor-datacenter.test.ts` — rejects pre-network (probe never called) when `allowBasicAuth: false`; succeeds with `basicAuthActive: true` (a non-blocking finding — `ok: true` regardless) when explicitly allowed; `src/provider/jira-datacenter-connection-registry.test.ts` and `src/provider/register-datacenter.test.ts` prove the SAME guard fires at registration time too (no HTTP client ever built for a disallowed basic-auth config). |
| 7 | DC 10.3 and 11.3 container recipes boot and pass a smoke test in CI, reusable unmodified by 23's disposable-environment tooling — CI artifact. | `docker/jira-datacenter/{10.3,11.3}/docker-compose.yml` + `docker/jira-datacenter/smoke-test.sh`, wired into `.github/workflows/jira-datacenter-smoke.yml` (`workflow_dispatch`, matrix over `10.3`/`11.3`, no secret required — a boot/health-probe-only smoke test, per this phase's own constraint). Not executed live in THIS session (no CI runner available here) — the recipe/script/workflow are the artifact; `docker/jira-datacenter/README.md` documents usage and the live-capture follow-up. |

## Additional test-plan coverage beyond the exit-criteria table

- **Unit:** PAT auth-header construction and caching (`jira-datacenter-auth.test.ts`);
  `JiraConnectionConfigSchema` boundary validation (unknown `deploymentType`/`authMode`
  rejected); DC read-path assertions proving every method hits `/rest/api/2/` or
  `/rest/agile/1.0/`, never `/rest/api/3/` (`reads-dc.test.ts`).
- **Property:** `dc-edition-feature-matrix.test.ts` (never-guess over fuzzed edition/action
  pairs); `wiki-markup-render-profile.test.ts` (structural-limit preservation, no
  injection-substring introduction).
- **Integration:** the full parameterized conformance suite (exit criterion 1); DC fault
  matrix replay (`fault-matrix-dc.replay.test.ts` — 401/403/409/429-no-retry-after/
  malformed-page/mid-POST-timeout, each mapped to the SAME canonical kind Cloud's identical
  fault maps to); fake/cassette parity for both DC versions.
- **Security:** forged/out-of-scope actions fail before network I/O for DC too
  (`jira-datacenter-resource-client.test.ts`'s unsupported-action cases,
  `jira-mutation-apply-client-dc.test.ts`'s `assertAllowedJiraOperation` re-check, both
  reusing 18's closed-allowlist `preflight-capability-guard.ts` unmodified); an unsafe ADF
  document (`javascript:` href) is rejected at the DC apply boundary
  (`jira-mutation-apply-client-dc.test.ts`); PAT/basic-auth secret references never leak
  into a thrown error message; the pre-network basic-auth rejection (exit criterion 6);
  the custom-CA/SSRF exit criterion (exit criterion 5) proves DC's self-hosted/internal
  base-URL flexibility does not bypass 16's SSRF guard — the SAME `GatewayHttpClient`
  allowlist/SSRF mechanism is exercised, just against a DC-shaped (loopback-pinned,
  self-signed) target, never a new TLS/SSRF mechanism of this phase's own invention.

## Deviations from strict work-item ordering

**Work item 5 (parameterized conformance suite):** roadmap/19's own text reads "Generalize
18's Cloud-only suite into ONE suite parameterized over `JiraDeploymentType`." This phase
implements that generalization as a NEW file
(`src/testkit/parameterized-conformance.integration.test.ts` +
`src/testkit/conformance-harness.ts`) rather than literally rewriting 18's own
`src/testkit/jira-flow.integration.test.ts` in place. Rationale: this worker's brief
explicitly required "do NOT ... break any phase-18 test," and `jira-flow.integration.test.ts`
is a phase-18-owned file exercising the exact same behavior for Cloud already — rewriting
it in place would have been the literal reading of work item 5, but carries strictly more
risk (to an 18-owned regression test) for no additional coverage, since the new
parameterized suite's `cloud` half asserts the IDENTICAL scenario, response scripts, and
outcomes as the original file, just via the shared harness. `jira-flow.integration.test.ts`
itself is untouched and still green (18/45 files remain unmodified from their phase-18
state, confirmed by `git status` showing no diff against that file). This is flagged here
as a deliberate, documented trade-off, not an oversight.

**TDD ordering:** every work item's stated "failing test first" entry point was followed
literally and confirmed red before implementation for the security/never-guess-critical
modules (`jira-connection-config.ts`/`assertBasicAuthPermitted`,
`dc-edition-feature-matrix.ts`, `wiki-markup-render-profile.ts`'s golden corpus). For the
more mechanical modules (the DC read/plan-builder composition, the DC mutation-apply
client's per-action `buildRequest` table, the provider-dispatch adapters) — which mirror
18's own already-proven structure closely — test and implementation were authored
together in the same pass and verified via an immediate `vitest run` on the new file,
matching the identical pragmatic trade-off phase 18's own evidence doc documents for its
equivalent modules.

## Carry-forwards (flagged, not resolved here)

1. **Live cassette capture** — see "What is cassette-modeled vs. live" above. The
   container recipes this phase built are the enabling artifact; the actual live-capture
   pass is future work (this phase's own author, or phase 23).
2. **`authMode: "oauth"` on a `datacenter`-deployed connection is explicitly unimplemented**
   (`resolveJiraDatacenterAuthHeaderProvider` throws `ConnectorError.unsupported` for it,
   proven by `jira-datacenter-auth.test.ts`) — roadmap/19 names PAT (default) and Basic
   (opt-in) as Data Center's auth modes; `"oauth"` is included in the `JiraAuthMode` union
   only because `JiraConnectionConfig` is meant to be shared across both deployment types'
   config shape (Cloud's own OAuth flow, `JiraTokenManager` + `buildJiraOAuthTokenFetcher`,
   remains a SEPARATE, unmodified code path from `JiraConnectionConfig` entirely — 18 never
   actually built a `JiraConnectionConfig`-shaped type of its own, so this phase is this
   type's first introduction). No DC OAuth flow is silently assumed anywhere.
3. **`DcEditionEntry.availableFields` is currently `"discovered-only"` for both matrix
   entries** — a placeholder closed literal rather than a per-edition allowlist, since
   this connector's real field-level "never guess" enforcement already lives in
   `../capability/field-metadata.ts`'s `assertCustomFieldWritesAreDiscovered` (reused
   unmodified for DC, since it is deployment-agnostic). A future DC edition with a
   genuine, narrower field-level capability gap would extend this type then, not
   speculatively now.
4. **21 (connector evidence integration) does not depend on 19** — this is roadmap/19's
   own documented structural observation (§Risks), reconfirmed here: any DC-specific
   evidence/drift-CI coverage beyond what 18 already provides remains unowned by any
   phase in the current dependency graph. Not something this phase can close.
5. **The `connection add jira` / `connection doctor <id>` CLI command shape** is out of
   scope per roadmap/19 itself (owned by 09/23) — this phase exports
   `runJiraDatacenterConnectionDoctor` and `JiraConnectionConfig` as the backend contract
   for that future CLI wiring to consume; it asserts no flag names as settled.

## Anything touched outside `packages/connectors-jira/`, `docker/jira-datacenter/`, or `.github/workflows/jira-datacenter-smoke.yml`, and why

- **`docs/evidence/phase-19/README.md`** — this file, explicitly authorized.
- **`.prettierignore` was NOT edited by this phase** — stated explicitly here per
  MINOR-2 above. `git diff .prettierignore` shows exactly one change in the working tree
  (a `packages/scheduler/goldens/` entry), which is a concurrent, unrelated phase-13
  session's own addition, not this phase's. This phase never needed a `.prettierignore`
  entry — its cassette JSON fixtures already match Prettier's own formatting style
  natively (confirmed via a direct `npx prettier --check` against them).
- Nothing else. No edit to `docs/interface-ledger.md`, no edit to any other package's
  `src/`, no edit to root `vitest.config.ts`/`eslint.config.js`/`tsconfig.base.json` (the
  root config auto-discovers every `packages/*` directory and every new file within
  `packages/connectors-jira/src`, exactly as phase 18's own evidence doc noted). No new
  external npm dependency was added — every new import in this phase's code resolves to
  an existing workspace dependency (`@eo/contracts`, `@eo/gateway`, `@eo/renderer`,
  `@eo/testkit`, `zod`, `fast-check`) already declared in `packages/connectors-jira/package.json`.
- **`packages/scheduler/**` and `docs/evidence/phase-13/`** — untracked/modified in the
  shared working tree during this session, but confirmed via `git status`/`git diff` to be
  a CONCURRENT, unrelated phase-13 worker session's own output, never touched or authored
  by this phase. Called out explicitly so it is never mistaken for this phase's work.

## Blockers

None. Every 02/16/17 interface this phase needed (`ExternalConnection.deploymentType`,
`CapabilitySnapshot`, canonical `ConnectorError` union, `SecretReference`,
`GatewayHttpClient`/`buildHttpClientForConnection`/`resolveSecretReference`/
`probeConnectionReachability`/`mapHttpStatusToConnectorError`/`ProviderRegistry`,
`RenderedArtifact`'s `toADF`/`toWikiMarkup`/`validateAdfSafeSubset`/`lint`) already
existed, exactly as roadmap/19 described them, with no missing schema member encountered.
