# 21 — the two tenant-boundary entries in the security-fixture manifest are tautological, and 20's real tenant-boundary fixture is not registered

**Phase:** 21 — Connector evidence integration & drift CI (`roadmap/21-connector-evidence-integration.md`), exit criterion 5

**Criterion (verbatim):**

> 16/18/20's security fixtures (forged admin/delete, tenant boundary, redaction) are present as blocking entries in 14's gate manifest; removing one fails the manifest-completeness test. Evidence: manifest-completeness test.

**Found:** 2026-08-02, criteria-closeout pass batch 4, against `main` @ `30f931eab97b8360102498d4b766513be67241d0`.

## Gap

`SECURITY_FIXTURE_MANIFEST` (`packages/gates/src/security-fixture-manifest.ts:119`) has seven entries, all `blocking: true`, across all three named categories, and `security-fixture-manifest.test.ts:49-54` proves that removing any one of the seven fails the completeness check. The second clause of the criterion is satisfied. The first is not, for the tenant-boundary category.

**Five entries do what the criterion says.** They re-exercise real primitives that 16/18/20 already ship and export:

| entry                         | calls                                                                    |
| ----------------------------- | ------------------------------------------------------------------------ |
| `jira-forged-admin-delete`    | 18's `assertAllowedJiraOperation("issue.delete")`                        |
| `grafana-forged-admin-delete` | 20's `createGrafanaProviderAdapter`, then inspects its surface           |
| `jira-redaction`              | 18's `containsSecretShapedContent` over a real `ConnectorError.toData()` |
| `grafana-redaction`           | 20's `redactSecretBearingObject`                                         |
| `gateway-redaction`           | 16's `mapHttpStatusToConnectorError`                                     |

**The two tenant-boundary entries do not.** Both are:

```
packages/gates/src/security-fixture-manifest.ts:172   (jira-tenant-boundary)
        () => assertTenantBoundary("tenant-a", "tenant-b"),
packages/gates/src/security-fixture-manifest.ts:184   (grafana-tenant-boundary)
        () => assertTenantBoundary("tenant-a", "tenant-b"),
```

byte-identical calls, on two string literals, into a guard this phase wrote itself:

```
packages/gates/src/security-fixture-manifest.ts:31-32
export function assertTenantBoundary(planTenant: string, callerTenant: string): void {
  if (planTenant !== callerTenant) {
```

`"tenant-a" !== "tenant-b"` is a compile-time constant, so the guard always throws, so `verdictFromAssertion` always returns `pass`. **The verdict cannot change.** Deleting every tenant-boundary enforcement from `packages/connectors-jira` and `packages/connectors-grafana` would leave both of these standing, blocking gates green. Neither entry touches Jira or Grafana at all; nothing distinguishes the "jira" one from the "grafana" one except its id.

This is the vacuity pattern the closeout brief warns about, in its plainer form: the fixture never sets up the state the assertion describes, so no tenant boundary is ever crossed and no enforcement is ever consulted.

**And 20's real fixture exists, is exported, and names this phase.** `packages/connectors-grafana/src/fixtures/fault-injection-matrix.ts:61-74`:

```
const tenantBoundaryBreachScenario: FaultInjectionScenario = {
  name: "a token bound to an out-of-allowlist org is refused before any resource access",
  category: "tenant-boundary",
  run: async () => {
    const result = await checkGrafanaConnectionDoctor({
      fetchTokenInfo: async () => ({ orgId: 999, role: "Admin" }),
      orgAllowlist: ["7"],
```

It drives real connector code and would go red if that code stopped refusing. It is on 20's public barrel (`packages/connectors-grafana/src/index.ts:185`, `export { FAULT_INJECTION_MATRIX } from "./fixtures/fault-injection-matrix.js";`), and its own file-level comment says it exists "consumed by 21 work item 6" and is self-verifying "so 21/23 can drive this matrix directly without re-deriving each scenario's assertion". `security-fixture-manifest.ts` imports six symbols from `@crabgic/connectors-grafana`; `FAULT_INJECTION_MATRIX` is not among them.

The consequence is exactly what the criterion exists to prevent: for the tenant-boundary category, 20's fixture is still a one-off phase-exit test, and the standing gate that was supposed to replace it is inert.

### Search trail

- `docs/evidence/phase-21/README.md` §"Exit criterion → evidence mapping", fifth bullet, and §Deviations item 4 — which discloses the substitution and justifies it as "neither connector package exported a dedicated tenant-boundary assertion function of its own prior to this phase". True of an _assertion function_; 20 exported a self-verifying _scenario_, which is what the criterion asks to be registered.
- Read `packages/gates/src/security-fixture-manifest.ts` (254 lines) and `security-fixture-manifest.test.ts` (127 lines) in full.
- `grep -rn "tenant.boundary\|tenantBoundary" packages/connectors-jira/src packages/connectors-grafana/src packages/gateway/src` — the only hits outside phase 21 are `fault-injection-matrix.ts` and `fault-injection.test.ts`.
- `grep -rn "FAULT_INJECTION_MATRIX" packages e2e` (excluding `dist/`) — its own module, 20's barrel, and 20's own test. No consumer in `packages/gates`.
- Local scoped run: `docs/evidence/phase-21/closeout-c5-security-fixture-manifest.txt` — 16/16 green, including the two entries this record declines.

## Severity

**blocking-guarantee.** A blocking gate that cannot fail is worse than an absent one: `registry.list("security")` reports tenant-boundary coverage that does not exist, and the manifest-completeness test protects the _presence_ of the entry rather than its _content_, so no existing check would notice. Two of seven standing security gates are affected.

The other five entries and the completeness/removal machinery are sound and are cited in `docs/evidence/criteria-closeout/phase-21.json` criterion 5.

## Proposed remedy

1. **Replace both tenant-boundary `verify` handlers with real checks.** For Grafana, import 20's `FAULT_INJECTION_MATRIX`, select `category === "tenant-boundary"`, and adapt its `run()` result into a `GateVerdict` — that is what the matrix was built and exported for, and it removes a duplicated copy rather than adding one. For Jira, there is no equivalent scenario at `30f931e`, so either (a) add one in `packages/connectors-jira` alongside its existing preflight guards, exercising a real cross-tenant `RemoteMutationPlan` against the real apply client, and register that; or (b) drop `jira-tenant-boundary` from `REQUIRED_SECURITY_FIXTURE_IDS` and say plainly in the roadmap that the tenant-boundary category is Grafana-only until 18 ships one. Option (b) is honest and cheap; option (a) is what the criterion actually asks for.
2. **Add an anti-tautology guard to the manifest suite.** The existing `it.each` only asserts each `verify` passes. Add its negative twin: for every entry, an assertion that the handler's verdict is _derived from_ something — e.g. each entry declares the exported symbol it exercises and the test asserts that symbol is imported from a connector package, or each `verify` is additionally run against a deliberately-broken injected dependency and must then fail. Without this, the same defect can be reintroduced silently.
3. **Annotate Deviation 4** in `docs/evidence/phase-21/README.md` — do not edit it in place — recording that 20's `tenantBoundaryBreachScenario` was exported and available and was not used. Annotation is that file's own established convention: `d0a6520` added a dated header to it on the principle that "this is an evidence file: the original text stays verbatim and the mapping lives here." Same annotation block as the sibling defect's step 3, which corrects the "Journal excerpt" heading; do them together.

**Effort sizing: S** for the Grafana half plus step 3 (import an already-exported, already-self-verifying scenario). **M** overall if step 1(a) is chosen and a genuine Jira tenant-boundary scenario has to be written, and for step 2's anti-tautology guard, which needs a small design decision about how an entry declares what it exercises. No live system, no owner subscription; CI minutes only.

**Ticket-ready:** yes.

## Remedied 2026-08-07 — remedy option (a), and the chain that got there

Option (a) was taken: a real cross-tenant scenario in `packages/connectors-jira`, exercising a real
`RemoteMutationPlan` against the real apply client, registered as a seventh manifest entry. The
chain, so no single PR is credited with the whole thing: PR #94 replaced the Grafana entry with 20's
real breach scenario, PR #112 pinned the fault-injection scenarios' own oracles (the layer this
record's class hides in), and PR #122 added the Jira fixture and the seventh entry — with the oracle
pinned from day one rather than retrofitted, and with a second gate-level control born from the
first run of its own probe B2.

The measurement that answers this record's actual question — is the replacement another tautology? —
is in `docs/evidence/phase-21/fix-21c5-jira-tenant-boundary-probe-batchH.txt` §2: deleting the real
tenant refusal from the gateway mutation pipeline takes the suite from **5 failures src-only to 13
after a workspace build**, and the 8 rows that appear only under the rebuild are exactly the ones
the new entry adds. The mutation is deliberately kept compiling, because a non-compiling one leaves
every cross-package leg measuring the previous `dist/`. The Grafana half's equivalent is
`docs/evidence/phase-21/fix-c5-tenant-boundary-probe.txt`. Cite the transcripts for the coupling;
the unit assertions alone cannot carry it.

**Kept open: nothing** — but two things must not be read into the fix. The entry does **not** make
the enforcement Jira-side: it stays gateway-owned and provider-agnostic, so phase 18 owns the
fixture and not the check. And it does not touch the multi-tenant scope question carried by
`21-tenant-allowlist-declared-not-enforced` — reads are still unchecked and remote identity is still
unverified.
