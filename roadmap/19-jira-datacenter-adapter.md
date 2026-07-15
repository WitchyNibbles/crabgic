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
- **DC fixture set** — `packages/connectors-jira/fixtures/datacenter/{10.3,11.3}/` (cassettes) and `docker/jira-datacenter/{10.3,11.3}/` (container recipes + teardown scripts). Consumed by 23 work item 1 (disposable-environment tooling).
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

- [ ] Parameterized conformance suite green on both `cloud` and `datacenter` (10.3 and 11.3) fixture-backed runs — CI job artifact.
- [ ] DC-only unsupported actions/fields return typed `unsupported` — fixture-proven cassette test, zero raw-fallback occurrences.
- [ ] `DcEditionFeatureMatrix` resolves capability discovery correctly for both known editions (10.3, 11.3) and falls back to typed `unsupported` for an unrecognized edition — fixture-proven, no raw fallback.
- [ ] `wikiMarkupRenderProfile` output passes 17's blocking-artifact-lint corpus — golden-file diff test, zero exceptions.
- [ ] Custom-CA/self-signed connection succeeds against a disposable self-signed test server, exercised library-level (16's transport invoked directly) — integration test artifact.
- [ ] Basic-auth guard rejects without `allowBasicAuth: true` and accepts with it while emitting a non-blocking doctor finding — unit + integration test.
- [ ] DC 10.3 and 11.3 container recipes boot and pass a smoke test in CI, reusable unmodified by 23's disposable-environment tooling — CI artifact.

## Risks & open questions

- Jira DC support windows shift over a multi-year OSS lifetime; refresh 10.3/11.3 fixture versions before v1.0.0 if Atlassian's supported-version window has moved by then (23 already carries this as its own release-time risk).
- `MAX_MCP_OUTPUT_TOKENS` is unconfirmed (adaptation §10); DC payload shapes differ from Cloud's but rely on the same mitigation already established for 18 — gateway-side result-size budget enforcement (16), not engine-level MCP truncation. No new spike needed here.
- DC operators sometimes front Jira with SSO reverse proxies that don't fit the PAT/basic-auth binary; mitigated by typed `authentication`/`unsupported` canonical errors and an actionable doctor finding rather than a silent hang. No proxy-specific support is in scope.
- 21 (connector evidence integration) does not depend on 19 — confirmed against the README dependency graph and 21's own declared dependencies (14, 18, 20). Any DC-specific evidence/drift-CI coverage beyond what 18 already provides is currently unowned by any phase. Flagged here as a structural observation, not resolved — closing it would require adding a dependency edge or scope this phase doesn't own.
- This phase asserts no CLI flag names (e.g. a `--deployment`/basic-auth-opt-in flag on `connection add jira`) as settled — that surface belongs to 09/23. Whoever wires the CLI should read `JiraConnectionConfig` (this phase) as the contract to expose, not invent a parallel shape.
