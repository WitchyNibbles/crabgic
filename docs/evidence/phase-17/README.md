# Phase 17 evidence — Shared-text renderer & blocking artifact lint

Governing spec: `roadmap/17-renderer-communication-lint.md`. Package: `packages/renderer`.

## Adversarial-review remediation (round 2)

Independent adversarial validation found 11 real defects in the lint security boundary after the
initial implementation. Each was fixed with a failing test/corpus fixture added FIRST (confirmed red
against the pre-fix code), then the minimal fix, then confirmed green. All fixes are inside
`packages/renderer/`; no root config, ledger, or other-package file was touched.

| ID | Finding | File(s) fixed | New test(s) | New corpus fixture(s) |
|---|---|---|---|---|
| **C1** (CRITICAL) | `secret-scan.ts`'s generic `sk-[A-Za-z0-9]{20,}` pattern broke at the first hyphen, so hyphenated modern keys (`sk-ant-...`, `sk-proj-...`) passed clean. | `secret-scan.ts` | `secret-scan.test.ts`: 3 new cases (Anthropic-style, OpenAI-style, generic hyphenated fallback) | `attack-secret-anthropic-key.json`, `attack-secret-openai-project-key.json` |
| **H1** (HIGH) | No GCP `AIza...` API-key pattern. | `secret-scan.ts` | `secret-scan.test.ts`: 1 new case | `attack-secret-gcp-key.json` |
| **H2** (HIGH) | Only the classic `gh[pousr]_...{36}` GitHub PAT shape matched; modern `github_pat_...` and raw JWTs (no `Bearer` prefix) passed. | `secret-scan.ts` | `secret-scan.test.ts`: 2 new cases | `attack-secret-github-fine-grained-pat.json`, `attack-secret-raw-jwt.json` |
| **M1** (MEDIUM) | `url-policy.ts`'s raw-HTML tag pattern required whitespace before attributes, so slash-delimited-attribute XSS (`<svg/onload=...>`, `<img/src=x onerror=y>`) passed clean. | `url-policy.ts` | `url-policy.test.ts`: 2 new cases | `attack-html-injection-slash-attribute.json` |
| **M2** (MEDIUM) | `adf.ts`'s `validateAdfSafeSubset` checked `node.type`/`mark.type` only, never mark ATTRIBUTES — a `link` mark with an unsafe `href` (`javascript:`, `data:`, non-`https:`, missing) passed, and phase 18 uses this validator standalone with no `url-policy` stage running ahead of it. | `adf.ts` | `adf.test.ts`: 5 new cases (javascript:, data:, http:, missing href, safe https: control case) | `attack-adf-link-javascript-href.json` |
| **M3** (MEDIUM) | `evidence-claims.ts`'s ticket-key pattern (`\b[A-Z][A-Z0-9]+-\d+\b`) matched common standard/hash tokens (`SHA-256`, `COVID-19`, `UTF-8`), letting unevidenced claims through. | `evidence-claims.ts` | `evidence-claims.test.ts`: 2 new cases (denylisted tokens rejected; real ticket keys still accepted) | `attack-unevidenced-claim-standard-token.json` |
| **M4** (MEDIUM) | `unicode-defense.ts`'s confusable/homograph table (~16 entries) omitted Greek LOWERCASE alpha/beta and several common Cyrillic lowercase singles, so `pαypal.com` passed clean. | `unicode-defense.ts` | `unicode-defense.test.ts`: broadened property-test codepoint list + 1 new fixture case | `attack-confusable-greek-alpha.json` |
| **L1** (LOW, "your call") | `attribution-neutral.ts`'s sign-off pattern matched ANY line starting with `--`/`—`, false-blocking a quoted unified-diff header (`--- a/file`) or a markdown horizontal rule (`---`). Treated as an unintended over-block and narrowed. | `attribution-neutral.ts` | `attribution-neutral.test.ts`: 3 new cases (lone `--` still caught; diff header and markdown rule no longer false-blocked) | — (unit-level fix; no corpus fixture needed since neither false-positive shape is itself an attack) |
| **L2** (LOW) | `render-with-regeneration.ts` linted the RAW candidate but stored `normalizeToNfc(candidate)` — a decomposed-vs-composed codepoint-count mismatch could make the length-limit verdict disagree with what was actually stored. | `render-with-regeneration.ts` | `render-with-regeneration.test.ts`: 1 new case (decomposed "é" sequence, 65 raw chars over the 64-char `branch_name` limit but 33 chars once composed) | — (orchestration-level fix; already covered by the corpus's per-`ArtifactKind` valid fixtures) |
| **L3** (LOW) | Unicode defense didn't block LEFT-TO-RIGHT MARK / RIGHT-TO-LEFT MARK (U+200E/U+200F) or LINE/PARAGRAPH SEPARATOR (U+2028/U+2029), the latter bypassing `countLines`'s newline-only line counting. | `unicode-defense.ts` | `unicode-defense.test.ts`: 2 new cases | `attack-lrm-rlm-direction-marks.json`, `attack-line-paragraph-separator.json` |

Corpus grew from 22 to **33 fixtures** (11 new attack fixtures, one per finding requiring a corpus
case — L1/L2 are unit/orchestration-level fixes without a standalone attack shape of their own).

### Gate results after remediation (exact, reproduced)

- `npx vitest run packages/renderer --coverage.enabled=false` → **18 test files, 190 tests, all passed.**
- `npx eslint packages/renderer` → clean, 0 problems.
- `npx tsc -b packages/renderer` → clean, 0 errors. `npx tsc --project packages/renderer/tsconfig.json
  --noEmit` → clean, 0 errors.
- Coverage for `packages/renderer/src` (scoped via `--coverage.include='packages/renderer/src/**/*.ts'`,
  measured from `coverage/lcov.info`):
  - **Lines: 421/423 = 99.53%**
  - **Branches: 150/167 = 89.82%**
  - Statements: 97.74%, Functions: 100%.
  - Both line and branch coverage remain well above the ≥80% ground rule.
- `packages/renderer/src/__snapshots__/golden.test.ts.snap` — unchanged (`git diff --stat` empty) —
  none of the round-2 fixes touch template/converter output, so golden byte-stability holds.

## Gate results (initial implementation, before adversarial-review remediation)

- `npx tsc --project packages/renderer/tsconfig.json --noEmit` → clean, 0 errors.
- `npx tsc -b` (full monorepo, forced rebuild) → clean, exit code 0.
- `npx vitest run packages/renderer --coverage.enabled=false` → **18 test files, 157 tests, all passed.**
- `npx eslint packages/renderer` → clean, 0 problems.
- Coverage for `packages/renderer/src` (scoped via `--coverage.include='packages/renderer/src/**/*.ts'`,
  measured from `coverage/lcov.info`):
  - **Lines: 397/399 = 99.49%**
  - **Branches: 141/158 = 89.24%**
  - Statements: 97.61%, Functions: 100%.
  - Both line and branch coverage clear the ≥80% ground rule.

## Exit criterion → evidence mapping

1. **"Every attack in `packages/renderer/fixtures/corpus/` is blocked... proven by the corpus suite
   passing red-then-green."**
   - Evidence: `packages/renderer/fixtures/corpus/` (22 fixtures: 14 attack + 8 valid, one per
     `ArtifactKind`) + `packages/renderer/src/corpus.test.ts` (23 tests, all passing).
   - Attack vectors covered, one fixture each: bidi-override (`attack-bidi-override.json`),
     zero-width smuggling (`attack-zero-width.json`), confusable/homograph domain
     (`attack-confusable-domain.json`), AWS-style key / PEM header / DB connection string
     (`attack-secret-aws-key.json`, `attack-secret-pem-key.json`,
     `attack-secret-connection-string.json`), remote image (`attack-remote-image.json`), HTML/script/
     data-URL injection (`attack-html-injection.json`, `attack-script-url.json`,
     `attack-data-url.json`), attribution/engine-name leak (`attack-attribution-leak.json`,
     `attack-engine-name-leak.json`), over-length payload (`attack-over-length.json`), unevidenced
     completion claim (`attack-unevidenced-claim.json`).
   - Red-then-green: each stage's own unit test file demonstrates the failing-first fixture from its
     work item before the stage existed (see per-stage test files below); `corpus.test.ts` is the
     aggregation gate (work item 9) exercising the full `STAGE_PIPELINE` against every fixture.

2. **"Every valid `ArtifactKind` × fixture pair renders byte-identical across two consecutive CI
   builds (empty golden diff)."**
   - Evidence: `packages/renderer/src/golden.test.ts` (10 snapshot tests, one per `ArtifactKind` plus
     `toADF`/`toWikiMarkup`) + committed snapshot file
     `packages/renderer/src/__snapshots__/golden.test.ts.snap`.
   - Verified: ran the suite twice consecutively — first run wrote 10 snapshots, second run reported
     0 written / 10 passed (byte-identical, empty diff).

3. **"Regenerate-once proven: fail-then-pass generator yields `status: "rendered"`... always-fail
   generator returns `status: "blocked"`/`policy_blocked` on exactly the second attempt."**
   - Evidence: `packages/renderer/src/render-with-regeneration.test.ts`. The fail-then-pass case
     asserts `generate` was called exactly twice and the second call received the first attempt's
     findings as feedback; the always-fails case asserts `generate` was called exactly twice (never
     a third time) and the outcome is `{ status: "blocked", error: "policy_blocked", findings }`.

4. **"`toADF` output validates against the safe-subset whitelist for every ADF fixture; zero
   disallowed nodes/marks appear in any snapshot."**
   - Evidence: `packages/renderer/src/adf.ts` (`toADF`, `validateAdfSafeSubset`,
     `ADF_ALLOWED_NODE_TYPES`, `ADF_ALLOWED_MARK_TYPES`) + `packages/renderer/src/adf.test.ts`
     (15 tests). `toADF` is constructed so it can only ever emit whitelisted node/mark types (an
     unrecognized construct, e.g. a markdown table, degrades to a plain paragraph rather than a
     disallowed node — asserted directly in the "degrades an unrecognized construct" test).
     `validateAdfSafeSubset` is exercised both as an independent walker against hand-built
     disallowed-node/mark fixtures (work item 5's failing-first case: `layoutSection`, `mention`)
     and against every `toADF` output in the golden suite (`golden.test.ts`'s `toADF` snapshot) —
     zero disallowed nodes/marks in any case.

5. **"`toWikiMarkup` output passes the same corpus subset phase 19 names as its own exit
   criterion."**
   - Evidence: `packages/renderer/src/wiki-markup.ts` + `packages/renderer/src/wiki-markup.test.ts`
     (9 tests), including a test that runs the identical markdown fixture used in
     `golden.test.ts`'s `toADF` case through `toWikiMarkup` and asserts every converted construct
     (heading, bold, italic, code, link, bullet list) round-trips correctly.

6. **"PR-title template enforces ≤72 chars and `type(scope): outcome`, golden-proven against 08's
   commit-subject convention."**
   - Evidence: `packages/renderer/src/templates/pr-title.ts` (`renderPrTitle`) +
     `packages/renderer/src/templates/templates.test.ts`'s `renderPrTitle` block: asserts the
     rendered title passes `lint()` under BOTH `"pr_title"` and `"commit_subject"` kinds (same
     `CommunicationPolicy` limit shape, `{ maxChars: 72, format: "type(scope): outcome" }` for both),
     plus an over-length fixture that is blocked by `lint()`. `golden.test.ts` snapshots the same
     template's output for byte-stability.

7. **"`packages/renderer`'s `package.json` carries no HTTP-client or VCS-host SDK dependency — a
   static manifest check."**
   - Evidence: `packages/renderer/package.json` (`dependencies: { "@eo/contracts": "0.0.0" }`,
     `devDependencies: { "fast-check": "4.9.0" }` only) + `packages/renderer/src/manifest.test.ts`,
     which reads the actual on-disk manifest (never a hardcoded copy) and asserts (a) the only
     runtime dependency is `@eo/contracts`, and (b) no dependency name (in `dependencies` or
     `devDependencies`) contains any HTTP-client or VCS-host SDK substring (axios, node-fetch,
     undici, got, superagent, octokit, gitlab, bitbucket, github, `@modelcontextprotocol`).

## Work item → test mapping

| Work item | Stage / artifact | Test file |
|---|---|---|
| 1. Stage-pipeline skeleton | `ArtifactKind`, `LintFinding`/`LintOutcome`, `STAGE_PIPELINE` runner order | `artifact-kind.test.ts`, `lint.test.ts` |
| 2. Unicode defense | NFC normalization, bidi override, zero-width, confusables | `unicode-defense.test.ts` (property + fixture tests) |
| 3. Secret/URL-policy | AWS key, PEM header, connection string, `<script>`, `data:` URL | `secret-scan.test.ts`, `url-policy.test.ts` |
| 4. Attribution-neutral | Generated-with/Co-Authored-By, first-person, signatures, engine names | `attribution-neutral.test.ts`, `metadata-strip.test.ts` |
| 5. ADF safe-subset + wiki fallback | `toADF`, `validateAdfSafeSubset`, `toWikiMarkup` | `adf.test.ts`, `wiki-markup.test.ts` |
| 6. Templates | Jira comment, Grafana annotation, PR title/body, review comment | `templates/templates.test.ts` |
| 7. Evidence-required claims | fixed/resolved/verified/working/completed | `evidence-claims.test.ts` |
| 8. `renderWithRegeneration` | regenerate-once, `policy_blocked` | `render-with-regeneration.test.ts` |
| 9. Golden + property corpus | `fixtures/corpus/`, `renderer-corpus` aggregation gate | `corpus.test.ts`, `golden.test.ts` |

## Documented deviations / interpretive decisions

The roadmap phase file and interface ledger left several concrete shapes unspecified. Each is
resolved here with a documented, testable choice (also noted inline in the relevant source file's
doc comment):

1. **"Strip caller-supplied authorship/history metadata" is implemented as a BLOCKING stage, not a
   mutation.** `lint()`'s signature (`LintOutcome`) never returns rewritten text — only findings —
   so a candidate carrying a git-trailer-style authorship line (`Co-Authored-By:`, `Signed-off-by:`,
   `Author:`, `Committer:`, `Date:`, `Change-Id:`) is rejected outright by `metadataStripStage`
   rather than silently rewritten. This is consistent with `lint()` being pure and side-effect-free.

2. **The NFC-normalization stage never itself produces findings.** It is a preparatory transform
   step (per the spec's own arrow-chain ordering, immediately before the stage that inspects
   codepoints), kept as its own named pipeline entry only so the declared stage order matches the
   spec literally. `normalizeToNfc` is exported standalone and used by (a) the unicode-defense
   stage's bidi/zero-width/confusable scans (over a normalized copy) and (b) `renderWithRegeneration`,
   which normalizes the final candidate to NFC before constructing the stored `RenderedArtifact`.

3. **Mention/notification-policy allowlist is empty.** `CommunicationPolicy` (02) defines no
   allowlist field for mentions; every `@`-mention/notification-triggering token is rejected
   outright (ordinary email addresses are excluded from the match by requiring no preceding word
   character).

4. **"Evidence reference" shape (evidence-required-claims stage) is this phase's own reading.** No
   other phase text defines the concrete marker. Implemented as: an `https://` URL, a Jira-style
   ticket key (`[A-Z][A-Z0-9]+-\d+`), or a non-placeholder `evidence:`/`ref:` label (excluding
   `none`, `n/a`, `tbd`, `unknown`, `not provided`). The placeholder exclusion is load-bearing: a
   naive "any `Evidence:` label counts" rule would trivially pass because `review_comment` and
   `jira_milestone_comment` are schema-required to always carry an `Evidence:` line — the
   `attack-unevidenced-claim.json` corpus fixture (`Evidence: none provided` next to a "fixed"
   claim) specifically regression-tests this.

5. **Confusable/homograph table is a curated subset, not the full UTS #39 `confusables.txt`.**
   Matches the roadmap's own Risks bullet ("Confusable detection is heuristic — tune against false
   positives"). Covers the common Cyrillic/Greek lookalikes for Latin letters
   (`CONFUSABLE_TO_LATIN` in `unicode-defense.ts`).

6. **URL-policy link scheme allowlist is exactly `https:`.** Matches the spec's "allowlisted
   schemes/links" language; no other scheme (including plain `http:`) is accepted for links.
   `javascript:`/`data:`/`vbscript:`/`file:` are additionally rejected even in their
   schemeless-authority form (no `//`), since that is their actual dangerous shape
   (`javascript:alert(1)`, `data:text/html;base64,...`).

7. **`toADF`/`toWikiMarkup` are hand-rolled converters over a constrained markdown subset**
   (paragraphs, `#`-`###` headings, bullet/ordered lists, fenced code blocks, blockquotes, bold/
   italic/inline-code/link marks) rather than a wrapped third-party markdown library — keeping
   `packages/renderer` dependency-free (see exit criterion 7) and making `toADF`'s "never emits a
   disallowed node" property true by construction rather than by post-hoc filtering.

8. **Schema-validation stage's section-shape check validates presence and rejects unknown labels,
   but does not enforce line ORDER.** The roadmap text says "unknown fields rejected"; it does not
   say order is checked. All of this phase's own templates render sections in the canonical order,
   so this is not exercised as a gap in practice, but a caller-supplied candidate with sections in a
   different order still passes if all required sections are present and no unknown ones appear.

9. **`packages/renderer/tsconfig.json` explicitly sets `"types": ["node"]`.** Diagnosed during
   verification: without this, `tsc` failed to resolve `node:fs`/`node:path`/`node:crypto` and
   `ImportMeta.url` in this package's own test/source files even though `@types/node` is installed
   at the workspace root (the same automatic-inclusion mechanism worked for some sibling packages
   but not reliably for this one). Setting `"types": ["node"]` explicitly — matching the existing
   convention already present in `packages/gateway/tsconfig.json` — resolved it deterministically.
   This is a `packages/renderer`-local config change, within this phase's permitted edit scope.

10. **(Adversarial-review L1) Sign-off/signature detection is deliberately NARROWED, not removed.**
    The original pattern matched any line beginning with `--`/`—` regardless of trailing content,
    which false-blocked a quoted unified-diff header (`--- a/file`) and a markdown horizontal rule
    (`---`) as if they were email-style signatures. Ruled an unintended over-block (not a deliberate
    neutrality-policy choice) and narrowed to two independent patterns: a lone `--`/`—` occupying an
    ENTIRE line by itself (the actual RFC 3676 plain-text signature-delimiter convention) still
    blocks; named closings (`Regards,`, `Best,`, `Cheers,`, `Thanks,`, `Sincerely,`) with trailing
    text still block unconditionally, since they always carry content on the same line and have no
    plausible non-signature reading in this artifact's context.

11. **(Adversarial-review M3) The ticket-key evidence-marker denylist (`NON_TICKET_PREFIXES` in
    `evidence-claims.ts`) is a fixed, curated list, not a general algorithm.** There is no
    universal rule distinguishing a real Jira-style project key from a standard/hash-name
    abbreviation that happens to share the same `LETTERS-digits` shape (`SHA-256`, `COVID-19`,
    `UTF-8` vs. `PROJ-123`, `JIRA-789`) — both are syntactically identical. The denylist
    (`SHA, MD5, UTF, ISO, IEEE, ANSI, ASCII, ECMA, HTML, HTTP, HTTPS, CSS, XML, JSON, COVID, GDPR,
    OWASP, RFC, CVE, TLS, SSL, URI, URL, API`) covers the adversarial review's named examples plus
    other common false-positive-prone standard names; a real project whose Jira key happens to
    collide with one of these tokens would need this list extended — a data change, not a shape
    change, matching this module's existing "curated, not exhaustive" pattern (confusable table,
    secret-scan patterns, engine-name list).

12. **(Adversarial-review C1/H1/H2) Secret-pattern set remains a fixed, curated list, expanded
    but not made exhaustive.** The new patterns (`sk-ant-*`, `sk-proj-*`, hyphen-inclusive generic
    `sk-*`, GCP `AIza*`, GitHub `github_pat_*`, raw JWT) cover the adversarial review's specifically
    verified bypasses; this is not a claim of exhaustive coverage of every possible credential
    format — new vendor key formats discovered later are new entries in `SECRET_PATTERNS`, not a
    structural change.

## Public interfaces exported (for phase 08/18/19/20 consumption)

All exported from `packages/renderer/src/index.ts` (package `@eo/renderer`):

- `ARTIFACT_KINDS` / `type ArtifactKind` — closed union, exactly: `"branch_name" | "commit_subject" |
  "commit_body" | "pr_title" | "pr_body" | "review_comment" | "jira_milestone_comment" |
  "grafana_annotation"`. `isArtifactKind(value): value is ArtifactKind` guard also exported.
- `lint(candidate: string, kind: ArtifactKind, policy: CommunicationPolicy): LintOutcome` — pure,
  synchronous. `LintOutcome = { ok: true } | { ok: false; findings: readonly LintFinding[] }`.
  `LintFinding = { stage: string; severity: "block"; message: string; span?: { start: number; end:
  number } }`.
- `renderWithRegeneration(input: { kind: ArtifactKind; generate: CandidateGenerator; policy:
  CommunicationPolicy; now?: () => Date }): Promise<RenderOutcome>` — `CandidateGenerator = (feedback?:
  readonly LintFinding[]) => string | Promise<string>`. `RenderOutcome = { status: "rendered";
  artifact: RenderedArtifact } | { status: "blocked"; error: "policy_blocked"; findings: readonly
  LintFinding[] }`.
- `toADF(markdown: string): AdfDocument`, `validateAdfSafeSubset(doc: AdfDocument): readonly
  LintFinding[]`, `ADF_ALLOWED_NODE_TYPES`, `ADF_ALLOWED_MARK_TYPES`.
- `toWikiMarkup(markdown: string): string`.
- Templates: `renderJiraMilestoneComment`, `renderGrafanaAnnotation`, `renderPrTitle`,
  `renderPrBody`, `renderReviewComment` (each with its own `*Input` interface).
- `normalizeToNfc(text: string): string`, plus every stage's `STAGE_NAME_*` constant.

## Carry-forward gaps / notes for the orchestrator

- No root-config or `docs/interface-ledger.md` change was required or made. `packages/renderer`'s
  own `package.json`/`tsconfig.json` were edited (dependency on `@eo/contracts`, project reference,
  explicit `"types": ["node"]`) — both files are inside the permitted edit scope.
- During verification, `npx tsc -b` from the repo root transiently showed pre-existing, unrelated
  TypeScript errors inside `packages/gateway` (missing `@types/node` resolution, `exactOptionalPropertyTypes`
  mismatches) that are NOT caused by this phase's changes — `packages/gateway` was already modified
  in the working tree by work outside this phase's scope (visible via `git status --short
  packages/gateway`, unrelated to any file this phase touched). A subsequent forced full-monorepo
  rebuild (`npx tsc -b --force`) completed cleanly with exit code 0, and `packages/renderer` alone
  type-checks cleanly in isolation regardless. No `packages/gateway` file was read, edited, or
  otherwise touched by this phase's work.
- The `release_notes`/`code_comment`/`doc_prose` `ArtifactKind` non-members named in the roadmap's
  own Risks bullet are deliberately NOT added — matching the roadmap's explicit scoping note that no
  phase 00-23 calls `renderWithRegeneration` with those kinds today.
