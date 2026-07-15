# Phase 17 — Shared-text renderer & blocking artifact lint

| | |
|---|---|
| **Depends on** | 02 (`renderer-core` module in `packages/contracts`, `CommunicationPolicy`) |
| **Unlocks** | 08 (PR/commit/branch text + terminal PR artifacts), 18, 20 (provider-payload templates + lint), 23 (release-gate corpus) |
| **Sources** | original plan "Concise communication policy" + "Blocking renderer and linter"; adaptation §8 ("stays exactly as planned" list), §9 (Neutrality test-matrix item) |
| **Primary package** | `packages/renderer` |

## Goal

Every shared artifact (Git text, PRs, Jira, Grafana, release notes, docs) passes one blocking pipeline: render → validate → sanitize → attribution/length policy → evidence checks — regenerate once, else block. PR/review-comment renders are terminal handoff copy for a human operator to paste into their own VCS-host workflow after choosing to push the already-published local branch — no VCS-host connector exists or is planned; the orchestrator never calls a PR/hosting API.

## In scope

- **`lint()` pipeline stages**, one ordered pass, each returning typed findings: action-specific schema validation (unknown fields rejected) → strip caller-supplied authorship/history metadata → Unicode NFC normalization → reject bidi overrides, unexpected controls, zero-width chars, suspicious confusables → secret/token/private-key/connection-string/credential-URL scan → URL policy (no raw HTML, no script/data URLs, no embedded remote images, allowlisted schemes/links) → ADF safe-node/mark subset (Jira Cloud) → attribution-neutral language (no I/we, no signatures, no engine names, no generated-by/assisted-by/co-authored-by) → whitespace/line/length limits per `ArtifactKind` (read from `CommunicationPolicy`, 02, at call time — never hardcoded) → evidence-required claims (fixed/resolved/verified/working/completed must carry an evidence reference) → mention/notification policy.
- **`renderWithRegeneration()` orchestration**: calls a caller-supplied candidate generator, runs `lint()` on the result; on failure, calls the generator exactly once more with the findings as feedback; a second failure returns `policy_blocked` (02 canonical error) without writing anything anywhere — 17 never performs the downstream git commit/push or provider API call itself (08, and the connector adapters 18/19/20 whose outbound calls run through 16, own those writes).
- **Templates** (length/section enforcement pulled from `CommunicationPolicy`, 02): Jira milestone comment (Outcome/Evidence/Risk/Next/Ref), Grafana annotation `<state> | <service> | <change> | evidence=<ref>`, PR title (≤72 chars, `type(scope): outcome` — same convention as the commit subject, 08), PR body (Outcome/Validation/Risk/Tracking ≤12 lines), review comment (one finding, evidence, action, ≤6 lines).
- **Markdown→ADF converter** (`toADF`, Jira Cloud) with safe-subset node/mark whitelist; plain-text/wiki-markup fallback (`toWikiMarkup`, phase 19's DC profile).
- **Golden + property corpus** at `packages/renderer/fixtures/corpus/`: the plan's neutral-communication test list (branches, commits, PRs, Jira, Grafana, release notes, code comments, docs, Unicode attacks, secret leakage, attribution, length limits) — re-executed by phase 23 as release-gate evidence.

## Out of scope

- Opening a pull request or posting a review comment to any VCS host — no GitHub/GitLab/Bitbucket connector exists or is planned; PR-title/PR-body/review-comment output is copy-paste handoff evidence only, by design, permanently.
- Attaching rendered `RenderedArtifact`s to the ChangeSet evidence bundle, and surfacing them via `evidence <change-set-id>` — phase 08 (attach) and phase 09 (surface), backed by 04/14's `EvidenceRecord` mechanism. `review_comment` groups with `pr_title`/`pr_body` under 08 for this purpose — it is not tied to 13/14's gate-failure/repair-dispatch pipeline.
- Performing the actual git branch/commit/publish operations — phase 08.
- Performing the actual Jira/Grafana API calls that deliver rendered text — phases 18/19 (Jira) and 20 (Grafana), transported by 16.
- Source-diff security scanning (SAST, dependency/secret scanning of code) — phase 14. This phase's secret/credential-pattern stage covers rendered outbound text only; the two pattern sets are maintained independently, with no dependency edge between 14 and 17.
- Defining `CommunicationPolicy` constants, the `renderer-core` counters/attribution-scanner primitives, and the `RenderedArtifact`/canonical-error schemas — phase 02 owns the shapes; 17 consumes them and produces instances.
- Journaling render/lint decisions — `packages/renderer` is a stateless, non-journaling library; a caller that needs an audit trail (16's `RemoteOperationRecord`, 08's CAS/rebuild loop) journals its own call.

## Interfaces produced

- **Package** `packages/renderer`.
- **`ArtifactKind`** *(name introduced here — closed union)*: `branch_name | commit_subject | commit_body | pr_title | pr_body | review_comment | jira_milestone_comment | grafana_annotation`. Consumed by: 08 (the first six), 18 (`jira_milestone_comment`, plus `toADF`), 19 (`jira_milestone_comment` via `toWikiMarkup` — transitively, since 19 depends on 18 which depends on 17; no new phase-graph edge), 20 (`grafana_annotation`).
- **`lint(candidate, kind: ArtifactKind, policy): LintOutcome`** — pure, synchronous, single pass over the stage pipeline. `LintOutcome` is `{ ok: true } | { ok: false, findings: LintFinding[] }`. `LintFinding` is `{ stage: string, severity: "block", message: string, span?: { start: number, end: number } }` — one entry per violation, never a bare boolean, so a caller-side regeneration prompt can quote the exact offending span back to its content generator.
- **`renderWithRegeneration({ kind, generate, policy }): Promise<RenderOutcome>`** — the regenerate-once contract. `RenderOutcome` is `{ status: "rendered", artifact: RenderedArtifact } | { status: "blocked", error: "policy_blocked", findings: LintFinding[] }`.
- **`toADF(markdown): AdfDocument`** — Jira Cloud safe-subset converter; consumed by 18. `AdfDocument`'s node/mark whitelist: `paragraph`, `text`, `heading` (≤3), `bulletList`/`orderedList`/`listItem`, `codeBlock`, `blockquote`, `hardBreak`, `link` mark, `strong`/`em`/`code` marks — no `layout*`, `panel`, `media*`, `mention`, `status`, `emoji`, or `table*` nodes without a separate reviewed extension to the whitelist.
- **`toWikiMarkup(markdown): string`** — Jira DC fallback profile; consumed by 19.
- **`RenderedArtifact` instances** (schema owned by 02) — 17 is the phase whose pipeline actually constructs values of this type; every successful `renderWithRegeneration` call returns one.
- **PR-title/PR-body/review-comment `RenderedArtifact`s**, specifically — handed to 08, which attaches them to the ChangeSet's evidence bundle (04/14 `EvidenceRecord` mechanism), surfaced via 09's `evidence <change-set-id>` command. 17's responsibility ends at returning a lint-passed artifact; attachment and surfacing are 08's/09's.
- **Golden/property corpus** at `packages/renderer/fixtures/corpus/` — byte-stable fixtures + fast-check property suite; re-executed (not forked or copied) by 23's "Neutral communication" E2E matrix bullet as release-gate evidence.

## Interfaces consumed

All from phase 02 (`packages/contracts`) — the sole dependency:

- **`CommunicationPolicy` constants**: branch ≤64; commit subject ≤72 (`type(scope): outcome`); commit body ≤5 lines; PR title ≤72; PR body ≤12 lines/4 sections (Outcome/Validation/Risk/Tracking); Jira summary ≤120; Jira comment ≤800 chars/6 lines + milestone template; Grafana annotation ≤240; review comment ≤6 lines (one finding, evidence, action); prohibited-content categories (attribution, first-person, signatures, mentions, secrets, unsafe links).
- **`renderer-core` module**, inside `packages/contracts` (not a standalone package): length/line counters and the attribution-token scanner primitives that the `lint()` stages call into.
- **`RenderedArtifact` schema** (zod + JSON Schema) — 17 populates instances; shape owned by 02.
- **Canonical connector errors** closed union — specifically `policy_blocked`, returned (never thrown) on a second lint failure.

## Work items

1. Stage-pipeline skeleton: `ArtifactKind` union, `LintFinding`/`LintOutcome` types, ordered stage runner wired to `renderer-core` (02) counters. Failing-first: a runner-order fixture that fails before any stage has real logic.
2. Unicode defense stage: NFC normalization; bidi-override detection (U+202A–U+202E, U+2066–U+2069 — the "Trojan Source"/CVE-2021-42574 vector); zero-width/invisible detection (U+200B, U+200C, U+200D, U+FEFF, U+2060); confusables via the Unicode UTS #39 `confusables.txt` mapping plus a mixed-script heuristic (e.g. Cyrillic а U+0430 inside an otherwise-Latin domain). Failing-first: seeded bidi-override commit-body, zero-width-joiner Jira-comment, and confusable-domain-in-link fixtures.
3. Secret/URL-policy stage: credential patterns (AWS-style access key `AKIA[0-9A-Z]{16}`, generic PEM private-key header `-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----`, DB connection-string schemes `postgres://`/`mysql://`/`mongodb://` with embedded credentials, bearer/PAT-shaped tokens); scheme/link allowlist (no raw HTML, no `javascript:`/`data:` URLs, no embedded remote images). Failing-first: an AWS-style key in a review comment; a `<script>` tag in a PR body; a `data:` URL in a Grafana annotation.
4. Attribution-neutral-language stage on `renderer-core` counters: first-person, signature, engine-name, generated-by/co-authored-by detector. Failing-first: the seeded "Generated with…"/"Co-Authored-By" fixture (shared with 08's belt-and-suspenders assertion; implements adaptation §9's Neutrality test-matrix item).
5. ADF safe-subset converter (`toADF`) + node/mark whitelist; wiki-markup fallback (`toWikiMarkup`). Failing-first: a disallowed ADF node (e.g. `layoutSection`) must be rejected before the whitelist exists.
6. Templates: Jira milestone comment, Grafana annotation, PR title, PR body, review comment — lengths/sections read from `CommunicationPolicy` (02) at call time, never hardcoded. Failing-first: one over-length fixture per template.
7. Evidence-required-claims stage: fixed/resolved/verified/working/completed require an evidence reference. Failing-first: a seeded unevidenced "fixed" claim in a review comment.
8. `renderWithRegeneration` orchestration + `policy_blocked` on second failure. Failing-first: a scripted fail-then-pass generator must render; a scripted always-fails generator must block on attempt 2, never attempt 3.
9. Golden + property corpus at `packages/renderer/fixtures/corpus/`, wired as a CI job (`renderer-corpus`) that 23 re-invokes directly rather than re-deriving its own copy. Failing-first: the corpus harness fails to run until every prior stage exists (aggregation gate).

## Test plan

- **Unit**: one red-then-green fixture per stage — bidi override (U+202E), zero-width smuggling (U+200B/U+2060), confusable domain (Cyrillic/Latin homograph), secret/credential pattern (AWS-style key, PEM header, connection-string), script/data URL, disallowed ADF node, over-length template, unevidenced claim.
- **Property**: fast-check fuzz over Unicode categories (bidi-control range, zero-width range, confusable-lookalike table) proving the sanitizer never returns clean for a flagged codepoint; NFC-normalization idempotency (`normalize(normalize(x)) === normalize(x)`).
- **Golden**: byte-stable snapshot per `ArtifactKind` × valid-input pair, diffed across two consecutive builds (mirrors 02's own JSON-Schema byte-stability convention).
- **Integration**: `renderWithRegeneration` against scripted fail-then-pass and always-fail generators; `toADF` output checked against the same safe-subset whitelist 18 validates incoming payloads with; `toWikiMarkup` output checked against 19's own stated exit criterion ("wiki rendering passes the 17 lint corpus").
- **Conformance**: the full corpus at `packages/renderer/fixtures/corpus/` is the artifact 23's "Neutral communication" E2E bullet re-executes as release-gate evidence.
- **Security**: secret/credential leak corpus (AWS/GCP-style keys, PATs, PEM private-key blocks, DB connection strings) caught pre-render across every `ArtifactKind`; confusable-domain/homograph corpus; bidi/zero-width smuggling corpus; engine-name/attribution-leak corpus — directly implements adaptation §9's Neutrality test-matrix item ("lint still catches engine-name leakage in artifact text"), run jointly against the fixture 08 also asserts at the settings level.

## Exit criteria

- [ ] Every attack in `packages/renderer/fixtures/corpus/` is blocked: bidi/zero-width smuggling, confusable domain, secret/credential leak, remote image, HTML/script/data-URL injection, attribution/engine-name leak, over-length payload, unevidenced completion claim — proven by the corpus suite passing red-then-green.
- [ ] Every valid `ArtifactKind` × fixture pair renders byte-identical across two consecutive CI builds (empty golden diff).
- [ ] Regenerate-once proven: fail-then-pass generator yields a `status: "rendered"` `RenderedArtifact`; always-fail generator returns `status: "blocked"`/`policy_blocked` on exactly the second attempt.
- [ ] `toADF` output validates against the safe-subset whitelist for every ADF fixture; zero disallowed nodes/marks appear in any snapshot.
- [ ] `toWikiMarkup` output passes the same corpus subset phase 19 names as its own exit criterion.
- [ ] PR-title template enforces ≤72 chars and `type(scope): outcome`, golden-proven against 08's commit-subject convention.
- [ ] `packages/renderer`'s `package.json` carries no HTTP-client or VCS-host SDK dependency — a static manifest check proving the Goal's "never calls a PR/hosting API" claim structurally, not just by test absence.

## Risks & open questions

- Confusable detection is heuristic — tune against false positives on legitimate non-Latin content; allow explicit per-connection language allowances.
- `renderWithRegeneration` takes a caller-supplied `generate` callback rather than owning content generation itself, because `packages/renderer` has no model/engine access of its own — content generation stays with whichever phase already holds that capability (a worker via 06, the manager session via 10/11). This keeps the renderer a dependency-free, deterministically testable library; it also means the "one regeneration" retry is enforced by 17's orchestration loop even though the actual re-drafting happens in the caller's process.
- ADF safe-subset drift if Atlassian changes allowed nodes/marks: mitigated by a version-pinned whitelist plus a golden re-run whenever 18's Cloud API fixtures move.
- `CommunicationPolicy` limits are read programmatically, never hardcoded, so a 02 constant change can't silently desync a golden fixture without failing CI — but it still requires regenerating the affected golden snapshot; no drift detection exists beyond that CI failure.
- Engine fidelity: this phase asserts no Claude Code engine fact — no flags, settings keys, hook events, permission-rule forms, SDK options, or sandbox fields — confirmed against adaptation §8's "stays exactly as planned" list. No `docs/engine-baseline.md` citation or verify-at-build-time spike applies here.
- Scoping note: `ArtifactKind` deliberately excludes `release_notes`/`code_comment`/`doc_prose` as named members with a calling phase; the golden/property corpus still exercises the stage pipeline against fixtures shaped like these classes for regression coverage (matching the original plan's neutral-communication test list), but no phase 00–23 calls `renderWithRegeneration` with those kinds today. Adding a real caller later is a new `ArtifactKind` member plus a producer/consumer edit here, not an implicit inclusion.
- Reconciliation check: 08's own header "Depends on" row already names 17 explicitly (`ArtifactKind`, `lint()`/`renderWithRegeneration()`), and 08's own Risks section confirms this was "closed on this side by adding 17 to Depends on above." README.md's phase-index table row for 08 also already lists "02, 07, 17", matching the mermaid graph's `P17 --> P08` edge — header, table, and graph are fully consistent; no outstanding README-side action.
- Reconciliation check: 02's threat-model bullet now enumerates STRIDE surfaces as "UDS, worker runtime, envelope compiler, installer, gateway, connectors, capability quarantine, renderer, learning store" — the renderer's surfaces (secret leakage, injection, homograph spoofing) are explicitly covered, and 02's own Risks section confirms this addition was made "closing gaps flagged by 12 and 17 respectively." Consistent with 23's scope text naming 03/16/17 as security-review keystones; no outstanding action on 02's side.
