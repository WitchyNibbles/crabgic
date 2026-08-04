# Phase 19 — Jira Data Center adapter

| | |
|---|---|
| **Depends on** | 18 |
| **Unlocks** | 23 |
| **Sources** | original plan Jira Data Center section (PAT/bearer, basic-auth opt-in, REST v2 + Agile, 10.3/11.3 fixtures); adaptation §0 (v1 scope: full plan incl. Jira Data Center), §7 (Jira/Grafana connector notes: gateway-only MCP exposure, gateway-side result-size budgets), §8 (connector architecture stays exactly as planned) |
| **Primary package** | `packages/connectors-jira` |

## Goal

When this phase is done, every Jira capability phase 18 built against Jira Cloud — resources, prohibited-operation matrix, high-impact-capability gating, and the safety properties the artifact lint enforces — works identically against Jira Data Center 10.3 and 11.3 through the same `packages/connectors-jira` package: selected by a `deploymentType` discriminator, authenticated by PAT (or explicitly opted-in basic auth) instead of OAuth, rendered as wiki markup instead of ADF, and proven by one conformance suite parameterized over both deployment types rather than a forked second implementation.

## In scope

- `JiraDeploymentType` (`"cloud" | "datacenter"`) — new discriminator on this package's own `JiraConnectionConfig` shape, nested under P02's provider-neutral `ExternalConnection`; no change to `ExternalConnection` itself.
- **Auth:** PAT/bearer via gateway secret references (16) is the default (`authMode: "pat"`); basic auth exists only behind an explicit `allowBasicAuth` opt-in on the config. A `datacenter` connection carrying a basic-auth secret reference with `allowBasicAuth` unset (default `false`) is rejected pre-network with canonical `authentication` (P02).
- **API differences:** REST v2 + Agile routes, implementing the same resource-client contract 18 establishes for Cloud (typed IO against `RemoteResource`, P02 canonical-error-mapped). Field-metadata differences are resolved through a `DcEditionFeatureMatrix` (new — maps queried edition/version to available fields/actions) feeding capability discovery (`CapabilitySnapshot`, P02). Unrecognized fields or actions return typed `unsupported` (P02) — never guessed, never a raw-endpoint fallback.
- **Rate limits:** DC deployments typically have no Cloud-style quota/burst headers; the gateway's cross-worker throttling (16, reused from 18) still serializes writes, but this phase's fixtures must not assert a `Retry-After` contract DC doesn't make — conformance parameterization (below) treats rate-limit-header presence as a per-deployment-type fixture property, not a shared assertion.

  > **Correction, 2026-08-04 (criteria-closeout pass, phase 19).** "still serializes writes" is
  > only true per canonical target, and Data Center inherits phase 18's per-issue write-ordering
  > defect verbatim. This phase's DC resource client reuses 18's plan builders unmodified
  > (`packages/connectors-jira/src/resource-client/datacenter/jira-datacenter-resource-client.ts:7-29`),
  > and those builders mint per-**kind** canonical targets from the shared
  > `resource-client/canonical-target.ts`, while the gateway's mutation pipeline serializes on
  > `plan.canonicalTarget` and is deployment-agnostic. Measured on Data Center for the first time by
  > this pass: a concurrent `issue.update` + `comment.create` on the same issue mint
  > `issue:PROJ-1` and `issue:PROJ-1:comment`, and **overlap on the wire — `maxInFlight = 2`**,
  > with both `/rest/api/2/` requests open before either closes. The control, two `issue.update`s
  > sharing `issue:PROJ-1`, serializes correctly at `maxInFlight = 1`, so the pipeline works and the
  > defect is in the per-kind target minting. Data Center has **no write-order test at all**, so
  > nothing was claiming otherwise and nothing needed retracting. No phase-19 exit criterion covers
  > write ordering, which is why this is a dated annotation rather than a defect record. The
  > measurement is committed at `docs/evidence/phase-19/closeout-write-order-probe-dc.txt`
  > (deliberately RED, probe source included); the fix is owned by a separate pass on branch
  > `fix/jira-per-issue-write-order`, and the Cloud-side defect record filed by phase 18's closeout
  > is the diagnosis of record. This bullet's own text is left verbatim, per annotate-never-rewrite.

  > **Second line, 2026-08-04 (same pass, later the same day).** PR #84 merged at 17:03Z —
  > after the HEAD this closeout is pinned to (15:02Z) and after the probe above ran
  > (16:11Z) — and fixes it. `jira-mutation-apply-client-dc.ts` now declares
  > `serializationTarget: (plan) => writeSerializationTarget(plan.canonicalTarget)`, so
  > every issue-scoped Data Center write serializes on `issue:<key>` regardless of kind,
  > and `packages/connectors-jira/src/testkit/write-order.integration.test.ts` is the DC
  > write-order test whose absence the first line reports. So "Data Center has no
  > write-order test at all" is true of this record's HEAD and **stale on main**; the
  > committed transcript carries the same correction as a dated postscript. This pass
  > measured the defect and did not write, review or verify the fix.

- **Rendering:** `wikiMarkupRenderProfile` — DC has no ADF, so `RenderedArtifact` (P02/17) content is serialized to Jira wiki markup instead; built here, golden-corpus tested, required to pass 17's blocking-artifact lint unchanged.
- **Same resource/prohibition/high-impact-capability matrix as 18** — assignment, reporter change, closing transitions, sprint completion, attachments, bulk mutations, issue creation (P02's canonical labels) — reused verbatim, not redefined here.
- **Conformance:** 18's Cloud-only suite generalized into one suite parameterized over `JiraDeploymentType`; identical assertions, both values.
- **Custom CA / self-hosted TLS:** exercised via 16's gateway-level custom-CA path (DC deployments are typically internal, often self-signed) — no new TLS mechanism, only DC-shaped fixtures against the existing path.
- **Fixtures:** DC 10.3 and 11.3 cassettes + containerized instances, packaged for reuse by 23's live E2E matrix.

## Out of scope

- Jira Cloud OAuth, the REST v3 client, ADF rendering, the intake/milestone-sync engine, transition mapper, and revision comparator — owned by 18. This phase supplies a second resource-client implementation behind 18's existing contract, not a second sync engine; the sync engine runs unmodified against either implementation.
- Grafana anything — owned by 20.
- Gateway transport, secret storage, the custom-CA mechanism itself, gateway-side result-size budget enforcement, the canonical connector-error taxonomy — owned by 16. This phase only exercises them against DC-shaped traffic.
- `RenderedArtifact` schema, `CommunicationPolicy` constants, the blocking-artifact-lint engine itself — owned by 02/17. This phase only supplies DC-specific serialized content that must pass through them.
- Connector evidence integration, drift CI, exact-revision verification wiring — owned by 21. Note: 21's declared dependencies are 14, 18, 20 — not 19 — so this phase's DC-specific behavior is not itself wired into 21's evidence pipeline. That is a structural fact of the current dependency graph, not something this phase can close; see Risks.
- The `connection add jira` / `connection doctor <id>` CLI command shape — owned by 09 (`packages/cli`), which is not in this phase's dependency chain (neither directly nor transitively through 16/17/18). This phase exports backend functions and config types only; it ships no CLI code and asserts no CLI flag names as settled.
- Live-sandbox provisioning/teardown automation at release scale — owned by 23. This phase produces the container recipes and cassette fixtures 23 invokes, not the release-time harness itself.

## Interfaces produced

Everything below lives in `packages/connectors-jira`. Per the dependency graph, 23 is the only phase depending on 19, so it is the consumer of record for all of it — directly, or via the CLI-wiring work 23 does per 09's existing `NOT_IMPLEMENTED`-until-wired convention for connector-backed commands.

- **`JiraDeploymentType`** = `"cloud" | "datacenter"` — new closed union; no prior phase names it.
- **`JiraConnectionConfig`** — new fields on the Jira connection config: `deploymentType: JiraDeploymentType`, `authMode: "oauth" | "pat" | "basic"`, `allowBasicAuth: boolean` (default `false`). Extends whatever bare `authMode: "oauth"`-only config 18 defines.
- **DC resource-client implementation** (REST v2 + Agile routes) — a second, `datacenter`-selected implementation of 18's resource-client contract, alongside 18's `cloud` one. Dispatches through 16's existing plan→validate→journal→apply→read-back pipeline, unchanged.
- **`DcEditionFeatureMatrix`** — new: maps a discovered DC edition/version to its available fields/actions, feeding `CapabilitySnapshot` (P02); the source of every DC-only typed `unsupported` result.
- **`wikiMarkupRenderProfile`** — new: `RenderedArtifact` → Jira wiki-markup serializer, plus its golden corpus.
- **Parameterized Jira conformance suite** — generalizes 18's Cloud-only suite to run identical assertions over both `JiraDeploymentType` values.
- **DC fixture set** — `packages/connectors-jira/fixtures/datacenter/{10.3,11.3}/` (cassettes) and `docker/jira-datacenter/{10.3,11.3}/` (container recipes + teardown scripts). Consumed by 23 work item 2 (disposable-environment tooling).
- **Doctor-check functions** — PAT-validity probe, basic-auth-active finding (non-blocking), connection-reachability probe exercising 16's custom-CA path. Plain functions returning structured findings; consumed by this phase's own test suite directly and, later, by 23's CLI-wiring work behind `connection doctor <id>`.

## Interfaces consumed

- **From 18** (sole declared dependency):
  - the resource-client contract Cloud's REST v3 clients implement (typed IO against `RemoteResource`, P02 canonical-error-mapped) — this phase provides its second (`datacenter`) implementation;
  - the intake/milestone-sync engine, transition mapper, and revision comparator (18 work item 4) — reused unmodified, since the DC client conforms to the same contract;
  - the Cloud-only conformance-suite baseline this phase generalizes;
  - the `packages/testkit` fake-Jira harness (18 work item 6) — extended here with DC (v2/Agile) responses;
  - the high-impact-capability envelope-flag wiring — same 7 P02 members, reused, not redefined.
- **Via 18, originating in 02** (`packages/contracts` — already wired into `packages/connectors-jira` by 18; no new dependency edge): `ExternalConnection`, `CapabilitySnapshot`, `RemoteMutationPlan`, `RemoteOperationRecord`, `RemoteResource`; `CommunicationPolicy` constants; the canonical connector-error union (specifically `unsupported`, `authentication`, `validation`, `transient` here); the `HighImpactCapabilityFlag` enum's 7 Jira-side members, using P02's canonical labels (`closing transitions`, `bulk mutations`, among others).
- **Via 18, originating in 16** (`packages/gateway` — already wired into `packages/connectors-jira` by 18; no new dependency edge): the transport/secret-reference mechanism; the custom-CA path; gateway-side result-size budget enforcement (32 KiB item / 256 KiB result); the plan→validate→journal→apply→read-back pipeline backing `RemoteOperationRecord`; cross-worker rate-limit serialization.
- **Via 18, originating in 17** (`packages/renderer` — already wired into `packages/connectors-jira` by 18; no new dependency edge): the `RenderedArtifact` schema and the blocking-artifact-lint pipeline this phase's wiki-markup output must pass, unchanged.

## Work items

1. Auth modes: PAT/bearer default, `allowBasicAuth` opt-in guard, doctor-check functions. Failing test first: a `datacenter` config with a basic-auth secret reference and `allowBasicAuth: false` is asserted to reject pre-network with canonical `authentication` before the guard exists.
2. `JiraDeploymentType` + `JiraConnectionConfig` + DC resource-client implementation (REST v2 + Agile) behind 18's shared contract. Failing test first: a resource-by-resource contract test (project/board/sprint/epic/issue/comment/link/worklog/attachment) run against the unimplemented DC client fails before REST v2/Agile calls are wired.
3. `DcEditionFeatureMatrix` populating `CapabilitySnapshot` per discovered edition/version. Failing test first: a query against an unrecognized edition/version asserts typed `unsupported` before the matrix has any entries to consult (i.e. the safe-default path is proven before real data lands).
4. `wikiMarkupRenderProfile` + golden corpus. Failing test first: a `RenderedArtifact` golden fixture run through the not-yet-built profile fails 17's lint corpus before the serializer strips prohibited content/attribution correctly.
5. Generalize 18's conformance suite into one suite parameterized over `JiraDeploymentType`. Failing test first: invoking the suite with a `datacenter` parameter value fails (unsupported parameterization) before the refactor; after, `cloud` and `datacenter` pass identical assertions.
6. DC 10.3/11.3 cassette capture (items 2–5 exercised against real instances). Failing test first: the parameterized suite (item 5) run in cassette-replay mode against `datacenter` fails for lack of recordings before capture.
7. DC 10.3/11.3 container recipes + teardown, reusable by 23. Failing test first: the CI smoke-test job for the recipe fails (recipe doesn't exist) before the recipe is authored.

## Test plan

Every vector below is written failing-first against library-level calls into `packages/connectors-jira` — no CLI invocation exists yet (see Out of scope; CLI wiring is phase 23's).

- **Unit:** PAT auth-header construction; `allowBasicAuth` guard (rejects when unset, accepts + emits a doctor finding when set); `JiraDeploymentType`-based client selection; wiki-markup serializer escaping on individual node types.
- **Property:** `RenderedArtifact` → wiki-markup → re-parse preserves structural limits (length, section boundaries) under fuzzed input; capability discovery never emits a guessed field/action under fuzzed field-metadata responses — always typed `unsupported` for anything unrecognized.
- **Integration:** parameterized conformance suite (item 5) on the extended `testkit` fake-Jira — board→sprint→epic→issue→link→worklog→attachment, identical assertions to 18's Cloud run; cassette replay against 10.3 and 11.3 recordings; fault matrix (401/403/409/429, malformed pages, ambiguous timeouts) parameterized the same way 18 tests it.
- **Conformance:** shared suite green on both DC fixture versions; unsupported-on-DC actions return typed `unsupported`, fixture-proven; wiki rendering passes 17's lint corpus unchanged.
- **Security:** forged delete/admin/impersonation calls fail before network I/O (DC variant of 18's equivalent test); basic auth refused without `allowBasicAuth: true`; custom-CA/self-signed TLS connection verified against a disposable self-signed test server; canonical-error redaction confirmed on DC-specific error bodies (no provider payload leakage); PAT stored and referenced only via gateway secret references, never in worker-visible state; self-hosted target flexibility (internal/private base URLs are expected for DC) does not bypass 16's existing SSRF/redirect protections — same mechanism, exercised against a DC-shaped target.

## Exit criteria

**Closeout pass 2026-08-04:** 2/7 ticked against recorded evidence. Four of the five unticked boxes
are open defects (criteria 1, 2, 3, 4), each with its own record under
`docs/evidence/criteria-closeout/defects/19-*.md` and its own per-box note below; the fifth
(criterion 7) is a ready-but-never-run CI channel, not a defect. Machine-readable index:
`docs/evidence/criteria-closeout/phase-19.json`.

Shared citations reused by the ticked boxes below. **`CI` run
[30922070286](https://github.com/WitchyNibbles/crabgic/actions/runs/30922070286)**, green at
`3dec9bf` — its `unit-test+coverage (ubuntu-latest)` job
([92034932036](https://github.com/WitchyNibbles/crabgic/actions/jobs/92034932036)), step "test with
80% line+branch coverage gate", executed 625 test files / 6215 tests (job-log lines 1032–1033) and
names each of this phase's 18 Data-Center suites on its own line (job-log lines 360–406). Each box
cites the specific line for the suite it rests on, so a green workflow that never ran the named
suite could not stand in. Scoped local re-runs and every mutation probe, captured verbatim at this
commit with their command lines and exit statuses, are committed as
`docs/evidence/phase-19/closeout-*.txt`.

Method note, because four boxes turn on it. Every bearer this pass considered ticking was attacked
by deleting the thing it claims to enforce and measuring which suites redden — not by reading test
names. That is what produced three of the four defects: the unrecognized-edition fallback's
canonical kind can be changed from `unsupported` to `validation` with 625 files / 6216 tests still
green (probe P3b); the production `discovery → resolveDcEditionFeatures → client` join can be
replaced with `undefined` with the same result (probe P3); and fourteen of the seventeen
action-gate call sites can each be deleted individually with the package suite green (probe P2a).
Two probes came back the *other* way and are what cleared criteria 5 and 6: removing `customCaPem`
reddens with a real TLS verification error, and deleting the basic-auth guard reddens four suites
across three layers.

Citation re-resolution, round 2. A resolver was built and run on this record before it was first
pushed; it reported zero problems and **it was wrong**. It verified that each quoted fragment
*exists* in the cited file and never that the `:NN` marker written beside it is *the line the text
is on*, nor that the marker falls inside the declared span — two checks, not one. Adversarial review
found 19 defects of exactly that shape. The resolver now line-anchors every fragment, and on the
corrected record: **54 resolvable citations, 7 `ci-run`, 190 quoted fragments (195 with no minimum
length), 190 found in their source, 157 carrying a line marker, 157 markers naming the correct line,
190 within their declared span, zero problems.** It is mutation-tested in three directions — a
marker shifted by one line, a span narrowed around a correct marker, and a flipped assertion — all
caught. Round 1's own first pass had already found 9 defects (7 backslash-escaped apostrophes, a
fabricated quote, a wrong job-log line); those are fixed too. A second checker cross-reads the
committed transcripts against this record — 41 `git grep -n` output lines verified against the
commit each transcript's own RULING-3 header pins, zero disagreements — because a transcript and a
record written in the same PR disagreeing about one line number is a free detector this pass had and
did not use the first time.

This branch merges `main` @ `1ba27b9` (#84, #85, #88, #89). #84 landed after the pass ran and touched
`packages/connectors-jira/src/resource-client/datacenter/jira-mutation-apply-client-dc.ts`, shifting
one cited line. The record's `pass.headSha` therefore names the merge commit, so every citation
resolves against the tree this branch actually lands as; every *measurement* was taken at
`3dec9bf`, which each committed transcript pins in its own header, and the `ci-run` citations name
the commit their run executed at. Criterion 2's emptiness proof was re-run against post-#84 `main`
rather than assumed — it holds unchanged — and criterion 3's two probes were re-cut compile-clean
and with `npm run build` between mutation and test run, reaching the same result.
(#85, #88 and #89 were merged for the same reason and measured first: none of them touches any of
the 34 files this record cites, so no citation needed re-resolving.) The criterion-3 re-cut itself
went through a withdrawn draft, disclosed in the transcript rather than quietly patched: it
reported `625 files / 6216 tests` under a header claiming the post-merge sha, when 625/6216 are the
`3dec9bf` tree's totals — the commands had run in the pre-merge worktree while the header was
written from the branch tip, and four test files have been added since (625 + 4 = 629). Caught by
adversarial review. Re-cut in the merged tree, with its unmutated baseline recorded alongside, and
both probes are green there at the full 629 / 6258.

One more check was added after that round, because the correction of a line number in the JSON
record had left the PROSE copy of the same reference stale in this file. A sweeper now resolves
every `path:NN` reference written into prose — this annotation and the four defect records — against the merged tree: **11 references, all resolving, zero problems**, mutation-tested both
ways (a line past EOF, and an identifier that occurs nowhere in the cited file). Correcting a line
number now means grepping the old value across the record, this file, the defect records and the
transcripts, not just the one that reported it.

Correction to `docs/evidence/phase-19/README.md`, recorded here rather than by editing that file
(2026-08-04). Its criterion-2 row cites `isActionSupportedForDcEdition`'s property test as the
"never guesses" proof. That function has **zero production callers** — replacing its body with
`return true` reddens only its own test file. The real gate is client-internal
`assertActionSupported`. The same row also does not mention the criterion's "cassette test"
conjunct, which has no bearer, nor that the fields path throws `validation` attributed to
`jira-cloud`. The README's claims are not rewritten; this is the dated correction beside them.

- [ ] Parameterized conformance suite green on both `cloud` and `datacenter` (10.3 and 11.3) fixture-backed runs — CI job artifact. — **UNMET (2026-08-04), defect filed:** `docs/evidence/criteria-closeout/defects/19-conformance-suite-not-edition-fixture-backed.md`. Four conjuncts; three hold and the parenthetical one has no bearer at all. Green on both deployment types is real — `packages/connectors-jira/src/testkit/parameterized-conformance.integration.test.ts:53` `describe.each(["cloud", "datacenter"] …)` drives the full board→sprint→epic→issue→link→comment→worklog→attachment chain, a server-resolved transition and a 412 conflict through 16's real `executeMutationPlan` and a real temp-dir journal, and the harness genuinely selects the DC client pair (`conformance-harness.ts:88-123`); CI job-log line 368 (`6 tests`). What does not exist is `(10.3 and 11.3) fixture-backed`: the suite has no cassette code path at all (`git grep -nE "cassette|Cassette"` over both files is `exit=1`), the harness pins its DC run to `edition: "10.3"` (`conformance-harness.ts:93`, the file's only `edition:` line) with no 11.3 variant of any kind, and the only DC cassettes are a 7-call **read** scenario that is **byte-identical between the two editions** (md5 `0494d8e13d9ccf60d938d3faa2d4cf6c` for both) — so nothing in the tree distinguishes 10.3 from 11.3 on the wire. §Work items item 6 names the intended channel in its own words ("the parameterized suite (item 5) run in cassette-replay mode against `datacenter`"), and that mode does not exist in code, so reading the parenthetical down to what exists would lose a guarantee — `UNMET`, not a wording fix. Scope finding recorded alongside: substituting Cloud's client pair for the DC one leaves the whole package green (47/47 files, 456/456 tests), so this suite proves *contract* conformance, not DC-ness — the latter is carried by `reads-dc.test.ts:36-43`. Transcript: `docs/evidence/phase-19/closeout-c1-conformance-fixture-backing.txt`. Remedy is M-sized and needs a licensed live Data Center instance for the capture half.
- [ ] DC-only unsupported actions/fields return typed `unsupported` — fixture-proven cassette test, zero raw-fallback occurrences. — **UNMET (2026-08-04), defect filed:** `docs/evidence/criteria-closeout/defects/19-unsupported-fields-and-cassette-conjuncts.md`. Four conjuncts; the **actions** and **zero-raw-fallback** halves hold, the **fields** and **cassette** halves do not. Actions: `packages/connectors-jira/src/resource-client/datacenter/jira-datacenter-resource-client.test.ts:129-144` asserts `kind === "unsupported"` against the production gate at `…/jira-datacenter-resource-client.ts:83-94`; CI job-log line 364. Fields: measured, not read — driving `customfield_99999` through the **real** DC client returns `kind="validation"` and `provider="jira-cloud"` on all three write entry points, because the shared gate `capability/field-metadata.ts:67,74` throws `ConnectorError.validation` with the hardcoded Cloud provider name. Both diverge from this phase's own §In scope wording ("Unrecognized fields or actions return typed `unsupported`"), and no DC-context test exercises a field rejection at all; `DcEditionEntry.availableFields` is the literal `"discovered-only"` with no production branch on it. Cassette: no bearer — the only DC cassettes are the happy-path read scenario, and `git grep` for a `unsupported` kind assertion anywhere in `src/testkit/` is `exit=1`. Zero raw-fallback does hold: all ten request paths in `jira-mutation-apply-client-dc.ts` are literals under `/rest/api/2/` or `/rest/agile/1.0/`, nothing builds a path from plan data, and `jira-mutation-apply-client-dc.ts:345` re-checks 18's closed allowlist whose forged table includes `"raw.request"`. Bound on the actions tick, stated so it is not over-read: of the 17 `gate(…)` call sites, deleting each individually reddens for only **3** (`board.create`, `sprint.create`, `worklog.create`) — the mechanism is proven, per-action coverage is not. Transcript: `docs/evidence/phase-19/closeout-c2-unsupported-actions-and-fields.txt`. Remedy is S for the fields half (a production kind/provider fix plus one test), M once the cassette capture is included.
- [ ] `DcEditionFeatureMatrix` resolves capability discovery correctly for both known editions (10.3, 11.3) and falls back to typed `unsupported` for an unrecognized edition — fixture-proven, no raw fallback. — **UNMET (2026-08-04), defect filed:** `docs/evidence/criteria-closeout/defects/19-unrecognized-edition-fallback-kind-unproven.md`. Five conjuncts; four hold. Both known editions resolve correctly from scripted `serverInfo`/`mypermissions` fixtures through a real `GatewayHttpClient` — `packages/connectors-jira/src/capability/discovery-datacenter.test.ts:32-45` (10.3, `isReadOnly: false`, `apiFamilies ["rest-v2","agile-1.0"]`) and `:47-55` (11.3); CI job-log line 397. The conjunct that fails is `falls back to typed unsupported for an unrecognized edition`, and it fails on two independent measurements. (i) The canonical **kind** of that branch is asserted by nothing: `jira-datacenter-resource-client.test.ts:146-160` asserts only `.toThrow(ConnectorError)`, and downgrading the `dcFeatures === undefined` branch from `ConnectorError.unsupported` to `ConnectorError.validation` leaves 625 test files / 6216 tests green repository-wide. (ii) The only production path that *produces* that condition — `jira-datacenter-connection-registry.ts:87-93`'s `discovery → resolveDcEditionFeatures → client` join — can be replaced with `undefined` with the same repo-wide green, because the registry test registers an empty response script and `.catch(() => undefined)` swallows the failure. What *is* proven is a safe snapshot for an unrecognized version (`discovery-datacenter.test.ts:57-66`: `edition "unknown"`, `isReadOnly: true`, `actions: []`) — a real guarantee, and a different one from the typed error this criterion names, so reading it down would lose the typed-error guarantee. Transcript: `docs/evidence/phase-19/closeout-c3-discovery-fallback-probe.txt`. Remedy is S-sized, roughly 30 lines of test across two existing files, and needs nothing — no live instance, no container, no engine.
- [ ] `wikiMarkupRenderProfile` output passes 17's blocking-artifact-lint corpus — golden-file diff test, zero exceptions. — **UNMET (2026-08-04), defect filed:** `docs/evidence/criteria-closeout/defects/19-wikimarkup-output-never-linted-against-17s-corpus.md`. Neither of the two substantive conjuncts is met. All three `lint()` calls in `packages/connectors-jira/src/resource-client/datacenter/wiki-markup-render-profile.test.ts` (`:105`, `:168`, `:389`) lint the **input** candidate string and then convert; the converted output only ever meets `toContain` and the suite's own metacharacter helpers. Tree-wide, `git grep -nE "lint\(\s*(adfDocumentToWikiMarkup|toWikiMarkup|wiki|wikiMarkup)" -- packages/ e2e/` is `exit=1`: **no test anywhere lints either converter's output**, against 17's corpus or any other. 17's own `packages/renderer/src/wiki-markup.test.ts` still calls `lint()` zero times, and the corpus at `packages/renderer/fixtures/corpus/` (33 fixtures) has exactly two consumers, both of which lint inputs. No golden **file** is diffed either — `GOLDEN_CORPUS` (`:44-62`) is a 7-item in-file array proving byte-parity with 17's `toWikiMarkup`, which is a real parity proof but is neither a golden file nor lint conformance. Because that parity pins this serializer's output to `toWikiMarkup`'s, the criterion reduces to the exact check the merged phase-17 defect record documents as absent and explicitly deferred to this closeout. The DC-specific `{code}`-fence breakout is separately **fixed and well tested** (`:286-404`) and is not re-filed. CI job-log line 360 (`34 tests`). Transcript: `docs/evidence/phase-19/closeout-c4-wiki-lint-corpus-search.txt`. Remedy is S-sized and needs nothing.
- [x] Custom-CA/self-signed connection succeeds against a disposable self-signed test server, exercised library-level (16's transport invoked directly) — integration test artifact. — **Evidence (2026-08-04):** all three conjuncts, and the load-bearing one is measured rather than asserted. `packages/connectors-jira/src/testkit/custom-ca-self-signed.integration.test.ts:49-112` starts a **real** `node:https` server on a generated disposable self-signed cert (`:54-66`), builds 16's own `GatewayHttpClient` with `customCaPem: cert.certPem` (`:96-101`) and this phase's real PAT auth-header provider (`:94`), and performs a **real dial** pinned to 127.0.0.1 (`:31-33`, mirroring the gateway's own reachability-probe pattern), asserting the parsed `serverInfo` at `:111` — that is library-level with 16's transport invoked directly, not a mock. Negative control at `:114-141`: a wrong PAT still fails closed with `kind: "authentication"`. Vacuity attack: deleting `customCaPem` from the success case turns it RED with `Error: self-signed certificate`, so the custom-CA path is load-bearing and TLS verification is genuinely on. The address pinning does not weaken it — `git grep rejectUnauthorized` over `packages/` and `e2e/` finds one hit, in an unrelated owner-gated `@live` attestation test, and `packages/gateway/src/transport/http-transport.ts:86` keeps SNI `servername` set to the real hostname so the certificate is still validated against it. CI job-log line 379 (`2 tests`). Transcript: `docs/evidence/phase-19/closeout-c5-c6-tls-and-basic-auth.txt`.
- [x] Basic-auth guard rejects without `allowBasicAuth: true` and accepts with it while emitting a non-blocking doctor finding — unit + integration test. — **Evidence (2026-08-04):** all four conjuncts, across unit, doctor and registration layers. Unit rejection: `packages/connectors-jira/src/auth/jira-datacenter-auth.test.ts:65-82` asserts the canonical `kind === "authentication"` pre-network, and `packages/connectors-jira/src/provider/jira-connection-config.test.ts:147-157` asserts the same for `assertBasicAuthPermitted` itself, with `:174-185` proving the thrown message never leaks the secret references. Unit acceptance: `jira-datacenter-auth.test.ts:106-120`. The non-blocking doctor finding is asserted by behaviour, not by name — `auth/connection-doctor-datacenter.test.ts:34-57` proves the probe is **never called** when basic auth is disallowed (`:55` `expect(probeCalled).toBe(false)`), and `:59-79` proves that when it is allowed the result is `ok: true` **and** `basicAuthActive: true` (`:77-78`), i.e. present and non-blocking. Integration: `provider/jira-datacenter-connection-registry.test.ts:56-84` asserts positively that no HTTP client was built (`:83` `expect(httpClientBuilt).toBe(false)`), and `provider/register-datacenter.test.ts:186-213` proves the same through the routed provider registration with a throwing `buildHttpClient`; production ordering is documented at `jira-datacenter-connection-registry.ts:77-80`. Vacuity attack: deleting the `assertBasicAuthPermitted(config)` call at `auth/jira-datacenter-auth.ts:90` reddens **four** suites — auth, doctor, registry and registration. Scope note so the "integration" conjunct is not over-read: the doctor's probe is an injected seam and no wire-level basic-auth round trip exists anywhere; the integration half is carried by the registry/registration boundary, which is exactly what §In scope promises ("rejected pre-network"). CI job-log lines 378, 386, 392, 371, 370. Transcript: `docs/evidence/phase-19/closeout-c5-c6-tls-and-basic-auth.txt`.
- [ ] DC 10.3 and 11.3 container recipes boot and pass a smoke test in CI, reusable unmodified by 23's disposable-environment tooling — CI artifact. — **Left unticked 2026-08-04, no defect — the channel exists and has simply never been run:** `.github/workflows/jira-datacenter-smoke.yml` has **zero runs**. `gh run list --workflow=jira-datacenter-smoke.yml` returns an empty list while the same query against `ci.yml` returns runs, so this is a real emptiness and not a broken query; the workflow is `workflow_dispatch`-only (`:14`) and no other workflow chains it. The recipes (`docker/jira-datacenter/{10.3,11.3}/docker-compose.yml`), `smoke-test.sh` and the two-edition matrix all exist and need no secret by the workflow's own design — the gate is authorisation, not credentials, and this closeout pass is not authorised to dispatch it or to boot a container. So `10.3 boots and passes`, `11.3 boots and passes` and `CI artifact` have no evidence, and the image tags `atlassian/jira-software:10.3` / `:11.3` have never been validated by anything. The `reusable unmodified by 23` conjunct **is** evidenced without booting anything: `e2e/provisioning/test/jira-datacenter-wiring.test.ts` parses both compose files at the exact paths this phase shipped and asserts the service name, the edition-pinned image tag, the healthcheck and the named volume 23's harness drives, and it executed in the v1.5.0 release-gate run [30581930006](https://github.com/WitchyNibbles/crabgic/actions/runs/30581930006) — job 91004033370, job-log line 626 (`5 tests`) — with both the recipes and that test file byte-unchanged between that run's commit `6b9dd7b` and this one. Classified `EVIDENCE-NEEDS-CI`. Remedy: the owner (or an authorised pass) dispatches the workflow; both matrix jobs must reach `RUNNING`; then cite both job logs. Transcript: `docs/evidence/phase-19/closeout-c7-smoke-workflow-unrun.txt`.

## Risks & open questions

- Jira DC support windows shift over a multi-year OSS lifetime; refresh 10.3/11.3 fixture versions before v1.0.0 if Atlassian's supported-version window has moved by then (23 already carries this as its own release-time risk).
- `MAX_MCP_OUTPUT_TOKENS` is unconfirmed (adaptation §10); DC payload shapes differ from Cloud's but rely on the same mitigation already established for 18 — gateway-side result-size budget enforcement (16), not engine-level MCP truncation. No new spike needed here.
- DC operators sometimes front Jira with SSO reverse proxies that don't fit the PAT/basic-auth binary; mitigated by typed `authentication`/`unsupported` canonical errors and an actionable doctor finding rather than a silent hang. No proxy-specific support is in scope.
- 21 (connector evidence integration) does not depend on 19 — confirmed against the README dependency graph and 21's own declared dependencies (14, 18, 20). Any DC-specific evidence/drift-CI coverage beyond what 18 already provides is currently unowned by any phase. Flagged here as a structural observation, not resolved — closing it would require adding a dependency edge or scope this phase doesn't own.
- This phase asserts no CLI flag names (e.g. a `--deployment`/basic-auth-opt-in flag on `connection add jira`) as settled — that surface belongs to 09/23. Whoever wires the CLI should read `JiraConnectionConfig` (this phase) as the contract to expose, not invent a parallel shape.
