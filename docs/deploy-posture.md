# Deploy posture — is crabgic certified deployable?

> **NO. Deployment is NOT certified.**
> **One blocking item: R7-P1 — the Read-tool sensitive-root exposure is unmeasured.**
> Owner ruling, 2026-08-05.
>
> ---
>
> **AMENDED 2026-08-05, after measurement (R7-P1, PR #96). The block is resolved as stated; the
> posture is now conditional, not blocked.**
>
> R7-P1 has been measured — 30 authorized engine turns, recorded in `docs/engine-baseline.md` §20 and
> `docs/evidence/phase-00/r7-p1-read-exposure-transcript.md`. **Two verdicts, not one:**
>
> - **As shipped: BINDING.** `Read` was refused on all three sensitive roots under the compiled
>   profile verbatim, attributably, with a positive control succeeding in every arm. **The exposure
>   this document blocked on does not exist in the shipped configuration.**
> - **The backstop: ABSENT.** The `Read(...)` deny triplets and the sandbox's `filesystem.denyRead`
>   are **not** what refuses them. One arm added `Read` to `permissions.allow` and changed nothing
>   else — sandbox enabled, all 26 deny entries and all 6 `denyRead` entries byte-identical — and the
>   worker read the control state file. The sole barrier is out-of-cwd `Read` matching no allow rule
>   under `dontAsk`: **defence-in-depth of depth one.**
>
> **Consequent posture: deployable for the trusted-operator, single-tenant case, with two named
> conditions** — (1) do **not** add a broad `Read`/`Grep`/`Glob` allow, which is precisely what
> `docs/claude-code-adaptation.md` Appendix B sketches and which removes the only working barrier;
> and (2) treat the `tenantAllowlist` row below as **partially discharged** — enforcement landed 2026-08-05 (PR #100) but binds only the tenant a mutation plan DECLARES, on the mutation path; reads are not tenant-checked and the remote's actual identity is not verified, so multi-tenant deployment still needs a judgement call rather than a green light deployment.
>
> ⚠️ **Not a clean bill of health.** A control that is trusted and inert is the failure mode this
> whole exercise exists to surface, and §20.2 is an instance of it.

This document is the **sole authority** on deploy certification. Dated rulings only; annotate,
never rewrite. It supersedes — **without editing** — the 2026-07-24 sign-off in
`docs/security-posture.md:35`, which is a phase-23 release-hardening verdict, correct in its own
scope and time, and which predates `docs/engine-baseline.md` §14.4 (2026-08-01).

---

## ⛔ The blocking condition — R7-P1, CRITICAL-class until measured

Read exposure of `~/.ssh`, `~/.aws` and the journal/control state is **unmeasured on both layers**.

### 🔓 Permission layer — nothing is known to bind

- The compiled profile emits **no `Read` allow rule at all**.
  `packages/engine-core/src/compiler/permission-profile.ts:115` is
  `allow: [...ownedPathAllow, ...bashAllow, gatewayAllow],` — owned-path `Edit`/`Write`, the
  four-literal `Bash` allowlist, and the gateway MCP wildcard. Nothing else. The engine grants
  read-only tools without needing a rule, so the allow side is not what stops a read.
- The path-scoped `Read(...)` DENY triplets over exactly these roots **do** exist —
  minted at `packages/engine-core/src/compiler/permission-profile.ts:62` and composed into the
  profile at `packages/engine-core/src/compiler/permission-profile.ts:116`.
- But `docs/engine-baseline.md:519` measured a path-scoped deny recording `insideDenied: false` —
  "**the deny rule did nothing**", in the same object and the same run where the allow-side control
  scoped correctly. `docs/engine-baseline.md:523` draws the production consequence outright: those
  sensitive-root denies "appear **inert on the permission layer**".

⇒ On this layer the denies are inert, and there is no allow rule doing the work instead.

### 📦 Sandbox layer — measured only on the wrong channel

- `filesystem.denyRead ~/.ssh` has only ever been probed through **Bash `cat`**. The probe row at
  `docs/engine-baseline.md:290` is entirely a `cat` transcript (ENOENT-masking, attempted-and-blocked);
  re-baselined 2026-07-24 at `docs/engine-baseline.md:312`. **The engine's own `Read` tool has never
  been driven at these paths.**
- And the sandbox is not known to constrain engine tools at all on this host:
  `docs/engine-baseline.md:545` records that `sandbox-write-tool` (bare `Write` plus the real
  compiled sandbox) "allowed all four" targets, "so the sandbox does not constrain the engine's
  `Write` tool at all on this host". The analogous `Read`-tool bypass is a live, untested possibility.
- The baseline says so itself. `docs/engine-baseline.md:528` lists the limits of §14: "It does not
  measure `Read`, `Edit`, `Bash`, or the `disallowedTools` channel." `docs/engine-baseline.md:566`
  repeats it: §14.2 "says nothing about `Read(...)`".

### Why this blocks rather than being a disclosed residual

Defence-in-depth means two controls each of which binds. Here **neither layer has been shown to
bind** for the `Read` tool: one is measured inert, the other measured only on a different channel.
**If nothing binds, this is an absent control, not defence-in-depth — which makes it CRITICAL-class
until measured.**

### What discharges it

The R7-P1 probe: drive **the engine's own `Read` tool** at `~/.ssh`, `~/.aws` and journal/control
markers under the compiled profile, on both sandbox arms, with the attempted-and-blocked assertion
discipline `docs/engine-baseline.md:308` established (an arm with zero attempts reports UNRESOLVED,
never PASS). That probe is **owner-gated and live**; it was not run by the pass that wrote this
document, and this document is not evidence that it was.

---

## ⚠️ Known residuals — disclosed; none of these is the blocker

| Residual                        | State                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bulk:<keys>` write-order       | Same-issue writes are now serialized (PR #84, 2026-08-04), but `bulk:` targets are still not serialized against their member issues; that needs multi-key acquisition in 16's `WriteSerializer`. Phase 18 criterion 10 stays unticked — `roadmap/18-jira-cloud-adapter.md:143`.                                                                                                                                                                                               |
| Gate registry never composed    | Nothing in production ever moves a run to `verifying`, `integrating` or `final_verifying`, so the criteria-seal gate and 15's perf gate fire nowhere. Measured below.                                                                                                                                                                                                                                                                                                         |
| Tenant-boundary **gates** inert | The two standing blocking-gate entries are tautological: `packages/gates/src/security-fixture-manifest.ts:172` and `packages/gates/src/security-fixture-manifest.ts:184` are the byte-identical `() => assertTenantBoundary("tenant-a", "tenant-b"),` — two literals, so the verdict is a constant. Deleting every tenant enforcement in both connector packages leaves both gates green. Phase 21 criterion 5 is UNMET — `roadmap/21-connector-evidence-integration.md:157`. |

> _Amended 2026-08-05 (PR #94):_ the tautological entries are **replaced** — the gate now drives phase 20's real `tenantBoundaryBreachScenario`, and deleting the org-allowlist check reddens it (4 failures where 247 tests previously stayed green). Per-push execution proved by job-log test count 16 → 21. **The residual moves one layer down:** nothing pins the scenario's own verdict — see `20-fault-injection-scenarios-have-unpinned-oracles.md`.
> | `tenantAllowlist` declared, inert | **🔴 Blocking for MULTI-TENANT deployment.** `packages/contracts/src/contracts/external-connection.ts:85` declares `tenantAllowlist`; nothing reads it. A repo-wide grep for any tenant equality or inclusion comparison over production source returns **zero hits** — there is no tenant comparison anywhere — and the tenant value actually used derives from `projectAllowlist`, never from this field. The **schema publishes** the field, so an operator who sets it reasonably concludes cross-tenant access is refused, and nothing refuses it. Filed 2026-08-05 as `21-tenant-allowlist-declared-not-enforced.md`; unfixed. Worse than an unimplemented feature, because the contract invites the belief. |
> _Amended 2026-08-05 (PR #100):_ **enforcement landed.** `refuseOutOfAllowlistTenant` fires as the first statement of `executeMutationPlan` — the sole issuer of mutation I/O (the only production `isWrite: true` in the repo) — refusing with `policy_blocked` **before** any journal write, deliberately, so a persisted `failed` record cannot poison the idempotencyKey against retry after a config fix. `[]` refuses all; `undefined` is unscoped. The field was **enforced rather than removed** because the schema is `.strict()` and the connection store re-parses every record on read — deleting the field makes any connection carrying it throw `ZodError` on next read (measured). ⚠️ **Scope, deliberately narrow:** it binds the tenant a plan **DECLARES**, on the mutation path only. Reads are not tenant-checked (pseudo-tenants `"oauth"`/`"doctor-probe"`/connection id are concurrency keys), and the remote's actual tenant identity is **not** verified. **It is not a guarantee that cross-tenant access is refused** — that wording is pinned in four places including the published schema description, and two probes prove neither the claim nor its residuals can be silently dropped. Remaining exposures an operator should assume: reads on a tenant-scoped connection; a plan declaring an in-allowlist tenant while its URL targets another tenant reachable with the same credential; and unbound remote identity.
> | ADF `href` secret-scan gap | `packages/connectors-jira/src/resource-client/adf-guard.ts:58-65` walks only `node.text` and `node.content`. A secret placed in a link mark's `href` attribute is never seen by the scan. |
> _Amended 2026-08-05 (PR #95):_ **closed.** The guard now additionally scans the document's whole JSON serialization — which on Cloud _is_ the outbound body — while keeping the extracted-text scan, since JSON escaping defeats the `\s`-bearing patterns. This also closed an **unknown-extra-member** smuggling path that `validateAdfSafeSubset`'s `type`/`marks`/`content` walk never visited, and Data Center's `[text|href]` wiki-markup path, pinned by its own apply-boundary test. False-positive risk measured at zero over 250 real URLs, 37 fixture JSONs and 1,000,000 synthetic high-entropy segments.
> | Live evidence: phases 00 and 06 | Neither has a closeout record (23 of 25 phases do). `engine-live.yml` has **zero runs ever**, and the repository has **no `CLAUDE_CODE_OAUTH_TOKEN` secret** — `gh secret list` returns only `NPM_TOKEN` (created 2026-07-26), verified 2026-08-05. CI dispatch of the live lane is therefore impossible today, and that is an owner action, not agent work. |

> _Amended 2026-08-07 (PRs #104, #121) — the "Gate registry never composed" row above:_ **partially
> closed; the measurement in "Measurement behind the gate-registry row" below, taken at `a7988c1`, is
> superseded.** The daemon's one production composition root now composes a gate registry
> (`packages/cli/src/daemon/compose-gate-registry.ts:113`) and the post-completion pipeline walks
> `running → verifying → integrating → final_verifying → published_local`
> (`packages/cli/src/daemon/post-completion-pipeline.ts:217`, `:288`, `:364`, `:454`). Since PR #121 the
> security-fixture manifest's gates — seven entries once PR #122's Jira tenant-boundary entry
> auto-registered through the derived list, with no edit — fire **blocking** at `final_verifying` for
> every run, and a failure names the fixture id in the refusal. Per-push proof, byte-compared under the
> one-space rule with the ANSI escapes stripped: `compose-gate-registry.test.ts` 7 → 10 cases in the
> `unit-test+coverage (ubuntu-latest)` job logs, with three control rows that correctly do not move.
> Transcript: `docs/evidence/phase-14/gate-composition-security-manifest-batchM.txt`, whose §12 is a
> dated self-correction worth reading here: in one adjacent suite those gates are **registered and fire
> zero times**, measured with an instrumented counter and two instrument controls rather than inferred
> from a green run. **Still inert, by measured necessity rather than omission:** 15's performance gate
> and 14's own tdd/coverage/flake/scanner/engine-conformance tranche have no production registration.
> The perf gate's measurement backend is missing in four independent places (transcript §9), and a
> registered handler without a backend either fails every run or fabricates. **Whether they fire in the
> daemon is an owner scope decision, not a maintenance task.**
>
> _Amended 2026-08-07 (PR #125) — the `bulk:<keys>` write-order row above:_ **closed.** 16's
> `WriteSerializer` gained multi-key acquisition (`runExclusiveMulti`), and both Jira apply clients now
> map a `bulk:<keys>` plan to its sorted member issue keys, so a bulk write serializes against
> single-issue writes of its members and against order-permuted bulk twins (`maxInFlight === 1`), while
> disjoint sets deliberately stay concurrent (`=== 2` controls, green both before and after the fix).
> Connector-level integration proof through the real `executeMutationPlan` and a real temp-dir journal,
> with the race observed on the wire as `expected 2 to be 1`:
> `docs/evidence/phase-18/bulk-write-order-batchC.txt`. `roadmap/18-jira-cloud-adapter.md:143` is ticked
> in the same pass. Nothing here evidences behaviour against a real Jira; every leg is a fake transport.
>
> _Added 2026-08-07 (PR #125) — a new residual row, beside the `tenantAllowlist` one above:_
> `ExternalConnection.folderAllowlist` — until now declared, published and read by **zero** code, the
> same declared-and-inert shape `tenantAllowlist` had — is **enforced at `executeMutationPlan`,
> mutations only**, via a provider `folderAttribution` hook with three answers (`folders` /
> `outside-folders` / `unknown`). Scope bound, stated verbatim from the change: it binds the folder the
> provider derives **from the plan**, never where the resource actually lives on the remote; it is not
> "writes outside these folders are impossible", it is "an operator can bound which folder a write may
> claim to land in." Reads are not folder-checked. **Ruling filling a spec silence: a provider that
> supplies no attribution is REFUSED, not waved through** — with a visible consequence, written into the
> published schema description: **setting `folderAllowlist` on a Jira connection refuses every Jira
> mutation on it**, because Jira has no folder concept and registers no hook; Grafana's `annotation`
> kind is `unknown` by construction and is likewise refused on a folder-scoped connection. There is no
> config-time signal for either; a connection-doctor warning is recorded as future work in the
> `16-folder-allowlist` defect record. Evidence:
> `docs/evidence/phase-16/folder-allowlist-batchC.txt`.
>
> _Amended 2026-08-07 (PR #118) — the "Live evidence: phases 00 and 06" row above:_ the CI-channel
> preconditions are landed. `engine-live.yml` now installs `@anthropic-ai/claude-code@2.1.218` (pinned
> in-range; `latest` is 2.1.223, outside it) and verifies the binary before the suite; the spawn case's
> three filed test defects are fixed and `test:live` bails on first failure. **The row's substance is
> unchanged:** zero runs ever, the `CLAUDE_CODE_OAUTH_TOKEN` secret is still unconfirmed, and dispatch
> remains an owner action. **Nothing in that change was verified against a live engine**, and this annotation is not evidence that it was.
>
> _Correction 2026-08-07 (closeout batch G) — five of this document's own `docs/engine-baseline.md`
> line anchors are stale by exactly +1, measured at `ed999b9`:_ the blocking-condition section above
> cites `:519`, `:523`, `:528`, `:545` and `:566`, and each quoted passage now sits one line lower —
> `:520`, `:524`, `:529`, `:546`, `:567`. Three of them (`:519`, `:523`, `:528`) currently land on a
> **blank line**, which is worse than landing on the wrong prose because it reads as a deleted claim.
> The anchors at `:290`, `:308` and `:312` still resolve to the text this document attributes to them
> and are untouched. **Nothing about the argument changes:** every quoted sentence is still present,
> verbatim, one line further down — the deny recording `insideDenied: false`, the "inert on the
> permission layer" consequence, §14's own Limits paragraph, the `sandbox-write-tool` result, and
> the "says nothing about `Read(...)`" caveat. Only the pointers moved, and one inserted line above
> §14 accounts for all five. The original text is left verbatim per this document's own convention.
> This was found while EOF-appending a §11 addendum to `docs/engine-baseline.md` in the same pass —
> that append cannot shift anything, and did not cause this; the drift predates it.

### Measurement behind the gate-registry row

Verified 2026-08-05 at `a7988c1`, because the claim is strong enough to deserve it:

- **No transition target anywhere.** `git grep -nE 'to: "(verifying|integrating|final_verifying)"'`
  over the whole repository — **tests included** — returns no source hit at all (the only match is
  prose inside a defect record).
- **The run driver stops at `running` on purpose.** `packages/cli/src/daemon/run-dispatcher.ts:740-765`'s
  `terminalStateFor` returns only `blocked`, `failed`, `cancelled` or `undefined`; its doc comment at
  `packages/cli/src/daemon/run-dispatcher.ts:735-736` says a completed DAG "has `verifying` as its successor, owned by the
  verification pipeline rather than invented here", and `packages/cli/src/daemon/run-dispatcher.ts:732` calls the missing
  wiring "the deferred `verifying` wiring".
- **Run creation stops at `running` too.**
  `packages/supervisor/src/run-lifecycle/create-run.ts:36` is
  `const LIFECYCLE_WALK = ["awaiting_approval", "ready", "running"] as const;`.
- **Two near-misses that are NOT transitions**, checked because a careless grep flags them:
  `packages/cli/src/intake/standing-approval.ts:61-68` (`APPROVED_STATES`) and
  `packages/cli/src/learning/ongoing-intake-refs.ts:32-38` (`ONGOING_INTAKE_STATES`) are read-only
  membership sets used to classify a state that already exists. Neither writes one.
  `packages/supervisor/src/intake/amendment.ts:123-128` is likewise a set of **source** states an
  amendment demotes **from**.

The defect is recorded in prose under the name `14-gate-registry-never-composed`; this measurement
was taken independently of it and agrees with it.

### Correction to a claim that has been repeated about the tenant row

The tenant-boundary **gate** is inert, but it is **not** true that real tenant enforcement has no
per-push net at all. `checkGrafanaConnectionDoctor`'s org-allowlist check is exercised by phase 20's
own package suites, which are inside the default `npm test` fan-out and therefore run on every push
via `.github/workflows/ci.yml`. What has no **per-push** net is the adapter-level scenario under
`e2e/matrix/connector/`: `e2e/` is not an npm workspace and is not in `vitest.config.ts`'s `projects`,
so no push-triggered job runs it. It is **not** unrun, though — `.github/workflows/release-e2e.yml:389`
runs it via `npm run test:e2e:release-evidence`, and that workflow is reachable two ways: manually
(`.github/workflows/release-e2e.yml:71`, `workflow_dispatch`) **and** as a called workflow (`.github/workflows/release-e2e.yml:85`,
`workflow_call`), which the tag-triggered `.github/workflows/publish.yml:64-66` invokes with
`scoring_mode: final` as the gate that must pass before anything is published. **So the connector e2e
lane does run, blocking, at every gated release — it simply does not run per push.** **The loss is the
standing blocking gate, not the enforcement's only test.** Stated this way so the residual is neither
inflated nor understated past what was measured.

---

## ✅ What is solid

Independently re-counted 2026-08-05, not copied from a summary:

- **23 of 25 phases** carry a per-criterion closeout record (missing: 00 and 06).
- **211 criteria** in total across all 25 phases, of which **169 are evidenced and ticked**.
- **29 defect records**, indexed. (An earlier summary said 30; that count included the index file
  itself. The index's own header says 29.)
- **Two production defects were found and fixed this wave**, each with a real remediation:
  - PR #84 — per-issue write order: same-issue writes of different kinds took different mutex keys
    and ran concurrently.
  - PR #85 — the shipped daemon composed no requirements registry, so seal verification resolved an
    empty set for every work unit.
- Owned-path **write** confinement is measured working — allow-scoping plus `dontAsk` auto-deny,
  `docs/engine-baseline.md:543-546`. The block above is about **reads**, not writes.

---

## Changing this document

Dated rulings, appended. Annotate; never rewrite. Only an owner ruling flips the certification line
at the top, and only measurement — not argument — discharges the blocking item.
