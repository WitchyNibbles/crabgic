import {
  CURRENT_SCHEMA_VERSION,
  ExternalConnectionSchema,
  type ExternalConnection,
  type RemoteMutationPlan,
} from "@crabgic/contracts";
import {
  GatewayHttpClient,
  IdempotencyKeyLock,
  executeMutationPlan,
  type HttpTransportRequest,
  type HttpTransportResponse,
  type MutationApplyClient,
  type MutationPipelineHandlers,
  type MutationPipelineOutcome,
} from "@crabgic/gateway";
import { AttachmentStagingRegistry } from "../attachments/attachment-staging.js";
import { JiraTokenManager } from "../auth/token-manager.js";
import { buildFieldMetadataIndex } from "../capability/field-metadata.js";
import { createJiraMutationApplyClient } from "../resource-client/jira-mutation-apply-client.js";
import { createJiraResourceClient } from "../resource-client/jira-resource-client.js";
import { JiraPlanPayloadRegistry } from "../resource-client/plan-payload-registry.js";
import type { JiraHttpContext } from "../resource-client/http-read-helper.js";

/**
 * Phase 18's tenant-boundary security fixture — the Jira twin of phase 20's
 * `tenantBoundaryBreachScenario`
 * (`packages/connectors-grafana/src/fixtures/fault-injection-matrix.ts`),
 * consumed by 21 work item 6 as a BLOCKING entry in 14's gate manifest
 * (`packages/gates/src/security-fixture-manifest.ts`).
 *
 * ── WHY THIS EXISTS, and what it is NOT.
 *
 * Defect `21-tenant-boundary-manifest-entries-tautological` recorded that both
 * tenant-boundary manifest entries were `assertTenantBoundary("tenant-a",
 * "tenant-b")` over two string literals — a compile-time constant verdict, so
 * deleting EVERY tenant enforcement in the repository left them green. The
 * Grafana half was replaced (#94) by driving 20's real connection doctor. The
 * Jira half was DROPPED instead of replaced, under an in-file ruling that a
 * Jira entry "returns only together with real Jira-side enforcement" — because
 * at that point nothing anywhere enforced a tenant boundary at all.
 *
 * Two things changed since. PR #100 added the enforcement
 * (`refuseOutOfAllowlistTenant`, consulted as the FIRST statement of
 * `@crabgic/gateway`'s `executeMutationPlan`), and this module adds the Jira
 * FIXTURE that drives it — with plans built by the REAL Jira plan builders and
 * applied through the REAL Jira `MutationApplyClient`.
 *
 * ⚠️ SCOPE, stated where the reader lands rather than only in a report. The
 * enforcement this fixture exercises is GATEWAY-owned and provider-agnostic;
 * what phase 18 owns is this fixture. And the enforcement itself binds only the
 * tenant a mutation plan DECLARES, on the mutation path: reads are not
 * tenant-checked (they carry pseudo-tenants used as concurrency keys) and the
 * remote's ACTUAL tenant identity is never verified. Per the wording pinned at
 * `packages/contracts/src/contracts/external-connection.ts:122`, this is "not a
 * guarantee that cross-tenant access is refused" — and no detail string this
 * module emits may say that it is. `./tenant-boundary-scenario.test.ts` S6/S7
 * assert exactly that, in both the pass and the fail worlds.
 *
 * ── HOW THE ORACLE IS PINNED (defect
 * `20-fault-injection-scenarios-have-unpinned-oracles`, applied from day one).
 *
 * A gate can only be as honest as the scenario it runs: attack G showed that
 * mutating a scenario's own `passed` expression left 83 files / 660 tests green.
 * So this scenario is built by a FACTORY whose every override defaults to the
 * real production dependency, and the module-level `JIRA_SECURITY_FIXTURE_MATRIX`
 * holds that factory's zero-argument product — there is no test-only copy: the
 * default-argument closure IS the object the gate executes. The overrides exist
 * so a test can construct a world in which this scenario OUGHT to fail, which
 * is what the previous generation of fixtures could not do.
 */

/** The tenant the fixture's `ExternalConnection` lists in `tenantAllowlist` — the positive control's world. Re-exported to `@crabgic/gates`, whose gate uses it to build its own control arm. */
export const JIRA_TENANT_BOUNDARY_IN_ALLOWLIST_TENANT = "tenant-fixture-in-allowlist";

/** The tenant the breach plan DECLARES — a worker-supplied string outside the connection's allowlist. */
export const JIRA_TENANT_BOUNDARY_FORGED_TENANT = "tenant-fixture-forged-by-worker";

const FIXTURE_BASE_URL = "https://jira-tenant-boundary-fixture.atlassian.invalid";
const FIXTURE_CONNECTION_ID = "00000000-0000-4000-8000-0000000018a0";
const FIXTURE_ENVELOPE_ID = "00000000-0000-4000-8000-0000000018a1";
/** TEST-NET-3 (RFC 5737). Not private, so 16's SSRF guard admits it; not routable, so a real socket could never be opened even if `sendRequest` were removed. */
const FIXTURE_HOST_ADDRESS = "203.0.113.240";

/** The one phrase that appears ONLY in the passing detail. Asserted by the gate and by S1/S7 so a detail match cannot be satisfied by the failing world too. */
const PASS_DETAIL_ANCHOR = "positive control: the in-allowlist plan was admitted";

/** The scope sentence every detail string carries — deliberately NOT "cross-tenant access is refused" (`external-connection.ts:114-115`, `:122`). */
const SCOPE_SENTENCE =
  "SCOPE: this binds the tenant a plan DECLARES, on the mutation path only — reads are not tenant-checked and the remote's actual tenant identity is not verified";

/** The self-verifying scenario shape, structurally identical to 20's `FaultInjectionScenario` so `@crabgic/gates` can drive both through one loop shape. Deliberately NOT imported from `@crabgic/connectors-grafana`: 18 does not depend on 20, and inverting that would contradict the roadmap's own dependency direction. */
export interface JiraSecurityScenarioResult {
  readonly passed: boolean;
  readonly detail: string;
}

export interface JiraSecurityScenario {
  readonly name: string;
  readonly category: "tenant-boundary";
  readonly run: () => Promise<JiraSecurityScenarioResult>;
}

export interface JiraTenantBoundaryScenarioOverrides {
  /**
   * Defaults to the REAL `executeMutationPlan` from `@crabgic/gateway` — the
   * sole issuer of mutation network I/O, and the function that consults
   * `refuseOutOfAllowlistTenant`. Injected only by the reverse probes in
   * `./tenant-boundary-scenario.test.ts`.
   */
  readonly executor?: typeof executeMutationPlan;
  /**
   * The `tenantAllowlist` the fixture's `ExternalConnection` declares.
   * Defaults to `[JIRA_TENANT_BOUNDARY_IN_ALLOWLIST_TENANT]`. `[]` is the
   * documented fail-closed state and makes the positive control fail — S8
   * uses it to rule out a refuse-everything enforcement WITHOUT injecting
   * anything.
   */
  readonly tenantAllowlist?: readonly string[];
  /**
   * The tenant the breach arm's plan declares. Defaults to
   * `JIRA_TENANT_BOUNDARY_FORGED_TENANT`. Setting it to an IN-allowlist value
   * is the gate's own positive control: the same machinery must then report
   * `passed: false`, which is what rules out a constant verdict.
   */
  readonly declaredTenant?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// The constructed world. Everything here is a fixture, and is named as one.
// ─────────────────────────────────────────────────────────────────────────────

type PipelineDeps = Parameters<typeof executeMutationPlan>[2];
type PipelineJournal = PipelineDeps["journal"];
type PipelineJournalEntryInput = Parameters<PipelineJournal["appendEntry"]>[0];

const ZERO_HASH = "0".repeat(64);

/**
 * The single throwing implementation shared by every `JournalStore`/`FsPort`
 * member the mutation pipeline never calls. ONE closure rather than a
 * per-member factory, deliberately: seventeen distinct never-called closures
 * would be seventeen uncovered functions reported against a security fixture,
 * and an unexercised branch inside one of those is precisely what this file
 * exists to stop hiding.
 */
function unreachableJournalMember(): never {
  throw new Error(
    "this JournalStore member is not reachable from the Jira tenant-boundary fixture — the mutation pipeline never calls it, and a call would mean this fixture's world drifted from the code it is pinning",
  );
}

/**
 * An in-memory stand-in for `@crabgic/journal`'s `JournalStore`, holding ONLY
 * the two members `executeMutationPlan` actually uses (`queryEntries`,
 * `appendEntry`) plus `config.clock`. Every other member throws, so a future
 * pipeline change that starts using one announces itself instead of being
 * silently satisfied.
 *
 * Why not a real temp-dir `JournalStore`: `@crabgic/journal` is a DEV
 * dependency of this package (the roadmap's 18→16→04 edge is transitive, via
 * `@crabgic/gateway`), and this module ships in `dist/`. The claim this
 * recorder bears is therefore "zero `appendEntry` calls", observed at the call
 * boundary — which is exactly what
 * `refuseOutOfAllowlistTenant`'s doc comment promises ("without journalling a
 * `RemoteOperationRecord`") — and NOT "zero bytes written to disk". The
 * on-disk half is `@crabgic/gateway`'s own
 * `mutation-pipeline.test.ts` to pin, and it does.
 *
 * Exported for `./tenant-boundary-scenario.test.ts`'s direct coverage of this
 * helper's own body — the same convention as 20's `neverCalledSend`
 * (`packages/connectors-grafana/src/fixtures/fault-injection-matrix.ts:27`).
 * It is NOT re-exported from the package barrel.
 */
export function createRecordingJournal(): {
  readonly journal: PipelineJournal;
  readonly appends: readonly PipelineJournalEntryInput[];
} {
  const appends: PipelineJournalEntryInput[] = [];
  const timestamp = new Date(0).toISOString();
  const journal: PipelineJournal = {
    appendEntry: async (input) => {
      appends.push(input);
      return {
        ...input,
        schemaVersion: CURRENT_SCHEMA_VERSION,
        seq: appends.length,
        prevHash: ZERO_HASH,
        hash: ZERO_HASH,
        timestamp,
      };
    },
    queryEntries: async function* (filter) {
      for (let seq = 0; seq < appends.length; seq += 1) {
        const input = appends[seq]!;
        if (filter?.type !== undefined && input.type !== filter.type) continue;
        yield {
          ...input,
          schemaVersion: CURRENT_SCHEMA_VERSION,
          seq: seq + 1,
          prevHash: ZERO_HASH,
          hash: ZERO_HASH,
          timestamp,
        };
      }
    },
    verifyJournal: unreachableJournalMember,
    repairJournal: unreachableJournalMember,
    writeSnapshot: unreachableJournalMember,
    loadLatestSnapshot: unreachableJournalMember,
    recover: unreachableJournalMember,
    gc: unreachableJournalMember,
    config: {
      segmentsDir: "<fixture: no segments dir>",
      snapshotsDir: "<fixture: no snapshots dir>",
      fs: {
        open: unreachableJournalMember,
        write: unreachableJournalMember,
        truncate: unreachableJournalMember,
        fsync: unreachableJournalMember,
        close: unreachableJournalMember,
        mkdir: unreachableJournalMember,
        rename: unreachableJournalMember,
        unlink: unreachableJournalMember,
        readFile: unreachableJournalMember,
        readdir: unreachableJournalMember,
        stat: unreachableJournalMember,
      },
      clock: () => new Date().toISOString(),
      segmentMaxBytes: 0,
      segmentMaxAgeMs: 0,
      dirMode: 0o700,
      fileMode: 0o600,
    },
  };
  return { journal, appends };
}

/** Counts every request that reaches the transport seam. A refusal that happens "before any network I/O" is exactly a run in which this stays at zero. */
function createTransportRecorder(): {
  readonly requests: readonly HttpTransportRequest[];
  readonly sendRequest: (req: HttpTransportRequest) => Promise<HttpTransportResponse>;
} {
  const requests: HttpTransportRequest[] = [];
  return {
    requests,
    sendRequest: async (req) => {
      requests.push(req);
      return { status: 201, headers: {}, bodyText: JSON.stringify({ id: "10100" }) };
    },
  };
}

function buildFixtureConnection(tenantAllowlist: readonly string[]): ExternalConnection {
  return ExternalConnectionSchema.parse({
    schemaVersion: CURRENT_SCHEMA_VERSION,
    id: FIXTURE_CONNECTION_ID,
    provider: "jira-cloud",
    deploymentType: "cloud",
    baseUrl: FIXTURE_BASE_URL,
    allowedRedirectOrigins: [],
    tenantAllowlist,
    allowedResources: ["issue"],
    allowedActions: ["read", "write"],
    discoveryTtlSeconds: 900,
    secretRef: { backend: "env", variable: "JIRA_TENANT_BOUNDARY_FIXTURE_TOKEN" },
  });
}

interface ArmObservation {
  readonly outcome: MutationPipelineOutcome;
  readonly httpRequests: number;
  readonly journalAppends: number;
}

/**
 * Runs ONE arm end to end: a real `RemoteMutationPlan` built by the real
 * `createJiraResourceClient` plan builders, applied through `executor` with
 * handlers assembled exactly the way production's
 * `packages/gateway/src/mcp/native-tools/mutation-apply-tool.ts:103-113`
 * assembles them from a `MutationApplyClient` — including the REAL `verify`
 * and `reconcileAmbiguous`, not stubs.
 *
 * `comment.create` is the chosen action deliberately: its read-back `verify`
 * takes the apply client's default branch (no second HTTP call), so the arm's
 * request COUNT is an unambiguous "did the pipeline reach the network at all"
 * signal rather than a number that depends on read-back shape.
 */
async function runArm(
  connection: ExternalConnection,
  declaredTenant: string | undefined,
  executor: typeof executeMutationPlan,
): Promise<ArmObservation> {
  const transport = createTransportRecorder();
  const { journal, appends } = createRecordingJournal();
  const httpClient = new GatewayHttpClient({
    allowlist: {
      allowedSchemes: ["https:"],
      allowedOrigins: [new URL(FIXTURE_BASE_URL).origin],
    },
    resolveHostAddresses: async () => [FIXTURE_HOST_ADDRESS],
    sendRequest: transport.sendRequest,
    sleep: async () => undefined,
  });
  const ctx: JiraHttpContext = {
    connection,
    httpClient,
    tokenManager: new JiraTokenManager({
      fetchToken: async () => ({
        accessToken: "fixture-token",
        expiresInSeconds: 3600,
        scopes: [],
      }),
    }),
  };
  const payloadRegistry = new JiraPlanPayloadRegistry();
  const resourceClient = createJiraResourceClient({
    ctx,
    fieldMetadataIndex: buildFieldMetadataIndex([]),
    payloadRegistry,
    // Omitted entirely on the control arm, so the tenant is DERIVED exactly as
    // production derives it: the whole `const tenant = …;` statement is
    // `../resource-client/jira-resource-client.ts:85-89`, and the clause that
    // makes the control arm in-allowlist is the distinctive
    // `ctx.connection.tenantAllowlist?.[0] ??` at that file's `:87` — the same
    // line `packages/gates/src/security-fixture-manifest.ts` anchors on. (The
    // span starts at `:85`, which is `const tenant =`; the comment block above
    // the statement ends at `:84`.) Supplied on the breach arm, which is the
    // documented shape of a worker-declared, unvalidated tenant string.
    ...(declaredTenant !== undefined ? { tenant: declaredTenant } : {}),
  });
  const applyClient: MutationApplyClient = createJiraMutationApplyClient({
    ctx,
    payloadRegistry,
    attachmentStaging: new AttachmentStagingRegistry(),
    // Consulted only on an AMBIGUOUS outcome, which neither arm produces (the
    // transport never throws). Present because the production bridge forwards
    // them; if a future change makes an arm ambiguous, these keep it decidable
    // rather than crashing.
    issueMarkerReconciler: { findByMarker: async () => undefined },
    commentMarkerReconciler: () => ({ findByMarker: async () => undefined }),
  });

  const plan: RemoteMutationPlan = resourceClient.comments.planCreate(
    "PROJ-1",
    { type: "doc", version: 1, content: [] },
    "jira-tenant-boundary-fixture-marker",
    FIXTURE_ENVELOPE_ID,
  );

  // The three `!== undefined` guards below are copied verbatim from
  // production's bridge, where they are live logic (a generic
  // `MutationApplyClient` need not define any of the three). For THIS apply
  // client all three are always defined
  // (`jira-mutation-apply-client.ts:367-369`), so their false arms are
  // constant-dead here and show up as uncovered branches. That is the
  // deliberate trade: byte-identical assembly to production beats a
  // fixture-local shortcut that could diverge from it silently.
  const verify = applyClient.verify;
  const serializationTarget = applyClient.serializationTarget;
  const reconcileAmbiguous = applyClient.reconcileAmbiguous;
  const handlers: MutationPipelineHandlers = {
    provider: connection.provider,
    buildRequest: (p) => applyClient.buildRequest(p),
    parseResponse: (p, r) => applyClient.parseResponse(p, r),
    verify: verify !== undefined ? (p, a) => verify(p, a) : async () => true,
    ...(serializationTarget !== undefined
      ? { serializationTarget: (p: RemoteMutationPlan) => serializationTarget(p) }
      : {}),
    ...(reconcileAmbiguous !== undefined
      ? {
          reconcileAmbiguous: (p: RemoteMutationPlan, cause: unknown) =>
            reconcileAmbiguous(p, cause),
        }
      : {}),
  };

  const outcome = await executor(plan, handlers, {
    journal,
    httpClient,
    lock: new IdempotencyKeyLock(),
    // The production wiring, verbatim: the operator's own field, handed to the
    // pipeline from the `ExternalConnection` in hand
    // (`mutation-apply-tool.ts:130`).
    tenantAllowlist: connection.tenantAllowlist,
  });

  return { outcome, httpRequests: transport.requests.length, journalAppends: appends.length };
}

/**
 * Builds the scenario. Two arms, both through the same executor:
 *
 *  - BREACH — a plan whose declared tenant is outside the connection's
 *    `tenantAllowlist`. Must be refused with the canonical `policy_blocked`
 *    kind, with ZERO transport requests and ZERO journal appends. Checking the
 *    two counters as well as the kind is what distinguishes "refused by the
 *    admission check" from "refused later, after doing work" — the criterion
 *    the enforcement's own doc comment states.
 *  - CONTROL — the same plan shape with the tenant DERIVED from the same
 *    connection, i.e. in-allowlist. Must NOT be refused by the admission check,
 *    and must reach the transport. Without this arm an enforcement that refused
 *    every mutation would satisfy the breach arm perfectly.
 */
export function makeJiraTenantBoundaryBreachScenario(
  overrides: JiraTenantBoundaryScenarioOverrides = {},
): JiraSecurityScenario {
  const executor = overrides.executor ?? executeMutationPlan;
  const tenantAllowlist = overrides.tenantAllowlist ?? [JIRA_TENANT_BOUNDARY_IN_ALLOWLIST_TENANT];
  const declaredTenant = overrides.declaredTenant ?? JIRA_TENANT_BOUNDARY_FORGED_TENANT;
  return {
    name: "a Jira mutation plan declaring an out-of-allowlist tenant is refused before any network I/O or journal write",
    category: "tenant-boundary",
    run: async () => {
      const connection = buildFixtureConnection(tenantAllowlist);
      const breach = await runArm(connection, declaredTenant, executor);
      const control = await runArm(connection, undefined, executor);

      const breachRefused =
        breach.outcome.status === "failed" &&
        breach.outcome.errorKind === "policy_blocked" &&
        breach.httpRequests === 0 &&
        breach.journalAppends === 0;
      if (!breachRefused) {
        return {
          passed: false,
          detail: `the plan declaring tenant "${declaredTenant}" was NOT refused as an out-of-allowlist declaration: status=${breach.outcome.status} kind=${breach.outcome.errorKind ?? "none"} transportRequests=${breach.httpRequests} journalAppends=${breach.journalAppends}. ${SCOPE_SENTENCE}.`,
        };
      }

      const controlAdmitted =
        control.outcome.errorKind !== "policy_blocked" &&
        control.httpRequests >= 1 &&
        control.journalAppends >= 1;
      if (!controlAdmitted) {
        return {
          passed: false,
          detail: `positive control broken — an in-allowlist plan was not admitted, so the refusal above proves nothing: status=${control.outcome.status} kind=${control.outcome.errorKind ?? "none"} transportRequests=${control.httpRequests} journalAppends=${control.journalAppends}. ${SCOPE_SENTENCE}.`,
        };
      }

      return {
        passed: true,
        detail: `refused as expected: an out-of-allowlist declared tenant was rejected with kind=policy_blocked before any network I/O (${breach.httpRequests} transport requests) and before any journal write (${breach.journalAppends} appends); ${PASS_DETAIL_ANCHOR} (${control.httpRequests} transport request(s), ${control.journalAppends} journal append(s), status=${control.outcome.status}). ${SCOPE_SENTENCE}.`,
      };
    },
  };
}

const jiraTenantBoundaryBreachScenario: JiraSecurityScenario =
  makeJiraTenantBoundaryBreachScenario();

/**
 * The matrix `@crabgic/gates` selects from. Its single member is the factory's
 * ZERO-ARGUMENT product — the default-argument closure IS the object the gate
 * executes, so there is no test-only copy that could drift from it.
 */
export const JIRA_SECURITY_FIXTURE_MATRIX: readonly JiraSecurityScenario[] = [
  jiraTenantBoundaryBreachScenario,
];
