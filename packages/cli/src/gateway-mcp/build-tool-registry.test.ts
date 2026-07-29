import { mkdtempSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  InMemoryExternalConnectionStore,
  ProviderRegistry,
  type GenericProviderClient,
  type MutationApplyClient,
} from "@crabgic/gateway";
import { createJournalStore } from "@crabgic/journal";
import { createInMemoryRegistry } from "@crabgic/supervisor";
import { ApprovalTokenMinter } from "@crabgic/contracts";
import type {
  AuthorizationEnvelope,
  ChangeSet,
  EvidenceRecord,
  IntentContract,
  WorkUnit,
} from "@crabgic/contracts";
import { createCapabilityStore } from "@crabgic/detect";
import { registerJiraCloudProvider } from "@crabgic/connectors-jira";
import { registerRoutedGrafanaProvider } from "@crabgic/connectors-grafana";
import { buildRealCliDependencies, buildRealGatewayToolRegistry } from "../bootstrap.js";
import {
  buildProductionGatewayToolRegistry,
  type ProductionGatewayToolRegistryDeps,
} from "./build-tool-registry.js";

let home: string;

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "eo-gateway-registry-"));
});

afterEach(async () => {
  await rm(home, { recursive: true, force: true });
});

function realRegistry() {
  return buildRealGatewayToolRegistry({
    xdgEnv: { HOME: home },
    projectHash: "registry-hash",
  });
}

/**
 * The non-provider half of `ProductionGatewayToolRegistryDeps`, wired to
 * throwaway in-memory state — every provider-dispatch test below varies
 * only `connections`/`providers`/`mutationApplyClients`.
 */
function stubDeps(): Omit<ProductionGatewayToolRegistryDeps, "providers" | "mutationApplyClients"> {
  const journal = createJournalStore({ journalDir: join(home, "journal") });
  const minter = new ApprovalTokenMinter({ secretKey: Buffer.alloc(32, 7), journal });
  const store = createCapabilityStore(join(home, "capability-store"));
  return {
    journal,
    connections: new InMemoryExternalConnectionStore(),
    supervisorSocketPath: join(home, "control.sock"),
    approvalSigningKey: Buffer.alloc(32, 7),
    changeSets: createInMemoryRegistry<ChangeSet>(),
    workUnits: createInMemoryRegistry<WorkUnit>(),
    envelopes: createInMemoryRegistry<AuthorizationEnvelope>(),
    intentContracts: createInMemoryRegistry<IntentContract>(),
    capability: { store },
    approvalTokenVerifier: minter,
    resolveCapabilityStoreKey: () => undefined,
    reviewFindingsPath: join(mkdtempSync(join(tmpdir(), "eo-reg-review-")), "review-findings.json"),
    reviewStateHome: mkdtempSync(join(tmpdir(), "eo-reg-state-")),
    reviewCalibrationPath: join(
      mkdtempSync(join(tmpdir(), "eo-reg-calib-")),
      "review-calibration.json",
    ),
  };
}

/**
 * The eight families interface-ledger Gap 1 counts, and the leaf names each
 * contributes. Asserted against the REAL production builder — the whole
 * point of this file is that the shipped `gateway mcp` server is populated,
 * which it was not until 2026-07-25: `cli-entry.ts` booted an empty
 * registry, so every one of these was unreachable from the binary.
 */
const EXPECTED_TOOL_NAMES = [
  // 16 native — tracker (7)
  "tracker.search",
  "tracker.get",
  "tracker.plan_create",
  "tracker.plan_update",
  "tracker.plan_transition",
  "tracker.plan_comment",
  "tracker.apply",
  // 16 native — observability (6)
  "observability.search",
  "observability.get",
  "observability.query",
  "observability.plan_create",
  "observability.plan_update",
  "observability.apply",
  // 16 native — evidence (2), result (1), forwarded run.* (2)
  "evidence.attach",
  "evidence.get",
  "result.submit",
  "run.status",
  "run.cancel",
  // 11 (2)
  "project.inspect",
  "contract.approve",
  // 12 (2)
  "capability.audit",
  "capability.approve",
  // Ledger Gap 20 (1) — the staged review pipeline's only write surface for a
  // reviewer. Listed here because this assertion is the repository's record of
  // what the shipped binary exposes, and a tool that reaches production
  // without appearing in it is a surface nobody decided to ship.
  "review.submit",
  // Ledger Gap 20's disclosed residual (1) — where the owner's judgement about
  // the blocking/advisory classifier goes. `recordCalibrationSample` shipped
  // tested and unreachable, so an empty corpus was a property of the product
  // rather than a project's starting state.
  "review.calibrate",
];

describe("buildRealGatewayToolRegistry", () => {
  it("registers every family the shipped binary is supposed to expose", () => {
    expect([...realRegistry().toolNames].sort()).toEqual([...EXPECTED_TOOL_NAMES].sort());
  });

  it("gives every registered tool a real, invocable handler — never a descriptor-only stub", () => {
    for (const tool of realRegistry().list()) {
      expect(typeof tool.handler, `${tool.name} has no handler`).toBe("function");
      expect(tool.description.length, `${tool.name} has no description`).toBeGreaterThan(0);
    }
  });

  /**
   * `project.inspect` is the one family leaf that needs no external
   * connection and no pre-minted token, so it is the honest end-to-end
   * proof that a handler reaches real subsystems: it reads 04's journal and
   * the durable ChangeSet registry, and degrades gracefully before either
   * has content rather than throwing.
   */
  it("INVOKES project.inspect against the real journal and ChangeSet registry", async () => {
    const result = await realRegistry().get("project.inspect")!.handler({});
    const report = JSON.parse(result.content[0]!.text) as {
      changeSets: unknown[];
      degraded: string[];
    };

    expect(report.changeSets).toEqual([]);
    expect(report.degraded.length).toBeGreaterThan(0);
  });

  /**
   * `contract.approve` must refuse before it ever reaches token
   * verification when the ChangeSet is unknown — the fail-closed path a
   * caller hits with a fabricated id.
   */
  it("refuses contract.approve for an unknown ChangeSet without consulting the token", async () => {
    const result = await realRegistry()
      .get("contract.approve")!
      .handler({
        changeSetId: "00000000-0000-4000-8000-000000000000",
        digest: "a".repeat(64),
        token: "not-a-real-token",
      });

    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain("unknown ChangeSet");
  });

  /** A tracker call with no connector configured must map to a typed connector error, not an unhandled throw. */
  it("answers a tracker call with a typed error when no connection is configured", async () => {
    const result = await realRegistry().get("tracker.search")!.handler({
      connectionId: "missing-connection",
      params: {},
    });

    expect(result.isError).toBe(true);
  });
});

/**
 * WP5 (2026-07-25) — provider-dispatch population.
 *
 * `buildProductionGatewayToolRegistry` used to construct two EMPTY
 * `ProviderRegistry` instances inline, so `tracker.*`/`observability.*`
 * resolved to `UnknownProviderError` for a correctly-configured Jira or
 * Grafana connection: the tools were registered, but nothing was ever
 * registered BEHIND them. These tests assert the registries are now
 * supplied by the caller and actually carry the two connector providers.
 */
describe("buildProductionGatewayToolRegistry — provider dispatch", () => {
  it("carries the jira-cloud and grafana provider keys, not an empty registry", () => {
    const providers = new ProviderRegistry<GenericProviderClient>();
    const mutationApplyClients = new ProviderRegistry<MutationApplyClient>();
    registerJiraCloudProvider({ providers, mutationApplyClients });
    registerRoutedGrafanaProvider({ providers, mutationApplyClients });

    buildProductionGatewayToolRegistry({ ...stubDeps(), providers, mutationApplyClients });

    expect([...providers.registeredProviders].sort()).toEqual(["grafana", "jira-cloud"]);
    expect([...mutationApplyClients.registeredProviders].sort()).toEqual(["grafana", "jira-cloud"]);
  });

  /**
   * The behavioural claim WP5 makes: for a REAL, stored Jira connection,
   * dispatch no longer answers "no such provider" — it answers the typed
   * per-connection error, which is strictly more honest.
   */
  it("a tracker call on a stored jira-cloud connection no longer reports an unknown provider", async () => {
    const providers = new ProviderRegistry<GenericProviderClient>();
    const mutationApplyClients = new ProviderRegistry<MutationApplyClient>();
    registerJiraCloudProvider({ providers, mutationApplyClients });

    const connections = new InMemoryExternalConnectionStore();
    const connection = await connections.create({
      provider: "jira-cloud",
      baseUrl: "https://example.atlassian.net",
      secretRef: { backend: "env", variable: "JIRA_TOKEN" },
      allowedRedirectOrigins: [],
      allowedResources: ["issue"],
      allowedActions: ["get"],
      discoveryTtlSeconds: 900,
    });

    const registry = buildProductionGatewayToolRegistry({
      ...stubDeps(),
      connections,
      providers,
      mutationApplyClients,
    });

    const result = await registry.get("tracker.search")!.handler({
      connectionId: connection.id,
      params: { connectionId: connection.id, resource: "issue" },
    });

    expect(result.isError).toBe(true);
    const error = JSON.parse(result.content[0]!.text) as { message: string };
    expect(error.message).not.toContain("no client registered for provider");
    expect(error.message).toContain("never registered");
  });

  it("an observability call on a stored grafana connection reports the per-connection error too", async () => {
    const providers = new ProviderRegistry<GenericProviderClient>();
    const mutationApplyClients = new ProviderRegistry<MutationApplyClient>();
    registerRoutedGrafanaProvider({ providers, mutationApplyClients });

    const connections = new InMemoryExternalConnectionStore();
    const connection = await connections.create({
      provider: "grafana",
      baseUrl: "https://grafana.example.com",
      secretRef: { backend: "env", variable: "GRAFANA_TOKEN" },
      allowedRedirectOrigins: [],
      allowedResources: ["dashboard"],
      allowedActions: ["list"],
      discoveryTtlSeconds: 900,
    });

    const registry = buildProductionGatewayToolRegistry({
      ...stubDeps(),
      connections,
      providers,
      mutationApplyClients,
    });

    const result = await registry.get("observability.search")!.handler({
      connectionId: connection.id,
      params: { connectionId: connection.id, resourceKind: "dashboard" },
    });

    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain("never registered");
  });

  /**
   * The real bootstrap wiring must populate them — not just the unit-level
   * composition above. The proof is behavioural, because the registry
   * object deliberately does not expose its providers: a REAL connection,
   * stored through the real durable connection store, must dispatch past
   * provider lookup and reach the per-connection error.
   *
   * ADVERSARIAL-REVIEW FIX (2026-07-25): this test used to exercise only
   * the GRAFANA half despite its title, and its Jira half was pinned by
   * nothing — deleting `registerJiraCloudProvider` from
   * `bootstrap.ts`'s `buildProviderDispatchWiring` left the entire
   * packages/cli suite green while `e2e/live/src/knownDeferredAllowlist.ts`
   * asserted, as gate-visible evidence, that bootstrap calls BOTH
   * registrars. Both arms now run against the same real wiring.
   */
  it("buildRealGatewayToolRegistry populates both provider registries end to end", async () => {
    const overrides = { xdgEnv: { HOME: home }, projectHash: "registry-hash" } as const;
    const deps = buildRealCliDependencies(overrides);
    const grafana = await deps.connection!.repository.create({
      provider: "grafana",
      baseUrl: "https://grafana.example.com",
      secretRef: { backend: "env", variable: "GRAFANA_TOKEN" },
      allowedRedirectOrigins: [],
      allowedResources: ["dashboard"],
      allowedActions: ["list"],
      discoveryTtlSeconds: 900,
    });
    const jira = await deps.connection!.repository.create({
      provider: "jira-cloud",
      baseUrl: "https://example.atlassian.net",
      secretRef: { backend: "env", variable: "JIRA_TOKEN" },
      allowedRedirectOrigins: [],
      allowedResources: ["issue"],
      allowedActions: ["get"],
      discoveryTtlSeconds: 900,
    });

    const registry = buildRealGatewayToolRegistry(overrides);

    const observability = await registry.get("observability.search")!.handler({
      connectionId: grafana.id,
      params: { connectionId: grafana.id, resourceKind: "dashboard" },
    });
    expect(observability.isError).toBe(true);
    expect(observability.content[0]!.text).toContain("never registered");
    expect(observability.content[0]!.text).not.toContain("no client registered for provider");

    // The Jira arm, asserted the same way: "never registered" is the
    // per-CONNECTION error that proves the provider key IS present, and
    // the negative assertion is what distinguishes it from the
    // `UnknownProviderError` an unpopulated registry produces.
    const tracker = await registry.get("tracker.search")!.handler({
      connectionId: jira.id,
      params: { connectionId: jira.id, resource: "issue" },
    });
    expect(tracker.isError).toBe(true);
    expect(tracker.content[0]!.text).toContain("never registered");
    expect(tracker.content[0]!.text).not.toContain("no client registered for provider");
  });
});

/**
 * The gate-decidable criteria are DERIVED here, and the caller's claim to them is
 * discarded before it can reach the closure rule.
 *
 * This is the half of ledger Gap 20 that was still open: a manager could not
 * assert that a stage was closable, but it could assert the inputs the closure
 * rule reads, which is the same thing one level down. These tests drive the real
 * production registry rather than the pure handler, because the subtraction lives
 * in the composition root and a unit test of the handler cannot see it.
 */
describe("review.submit — server-derived exit criteria", () => {
  function verdictDoc(stage: string) {
    return {
      schemaVersion: 1,
      id: "22222222-2222-4222-8222-222222222222",
      createdAt: "2026-07-29T00:00:00.000Z",
      stage,
      artifactRef: "changeset:abc",
      lens: "correctness",
      verdict: "approve",
      round: 1,
      findings: [],
    };
  }

  async function submit(
    deps: Omit<ProductionGatewayToolRegistryDeps, "providers" | "mutationApplyClients">,
    changeSetId: string,
    args: Record<string, unknown>,
  ) {
    const registry = buildProductionGatewayToolRegistry({
      ...deps,
      providers: new ProviderRegistry<GenericProviderClient>(),
      mutationApplyClients: new ProviderRegistry<MutationApplyClient>(),
    });
    const result = await registry.get("review.submit")!.handler({
      stage: "implement",
      changeSetId,
      verdict: verdictDoc("implement"),
      ...args,
    });
    return JSON.parse(result.content[0]!.text) as {
      ok: boolean;
      unmetCriteria?: string[];
      stageClosable?: boolean;
    };
  }

  /**
   * `stubDeps` puts the finding store and the state root in two unrelated temp
   * dirs, which the store's own containment check refuses — correctly, and it is
   * the check rounds 30-32 added. These tests write findings for real, so they
   * need a state root that actually contains the store.
   */
  function reviewDeps(): Omit<
    ProductionGatewayToolRegistryDeps,
    "providers" | "mutationApplyClients"
  > {
    const stateHome = mkdtempSync(join(tmpdir(), "eo-reg-derive-"));
    return {
      ...stubDeps(),
      reviewStateHome: stateHome,
      reviewFindingsPath: join(stateHome, "review-findings.json"),
      reviewCalibrationPath: join(stateHome, "review-calibration.json"),
    };
  }

  function registerChangeSet(
    deps: Omit<ProductionGatewayToolRegistryDeps, "providers" | "mutationApplyClients">,
  ): string {
    const changeSetId = "55555555-5555-4555-8555-555555555555";
    deps.changeSets.put({ id: changeSetId } as unknown as ChangeSet);
    return changeSetId;
  }

  /**
   * The claim with nothing behind it. Every gate-decidable criterion is asserted
   * and no gate has ever fired, so all of them must come back unmet — "gates that
   * never ran are not gates that passed".
   */
  it("refuses a claimed implement-gates-pass and implement-tests-first with no gate evidence", async () => {
    const deps = reviewDeps();
    const changeSetId = registerChangeSet(deps);

    const report = await submit(deps, changeSetId, {
      metCriteria: [
        "implement-gates-pass",
        "implement-tests-first",
        "implement-task-done-criteria-met",
      ],
    });

    expect(report.ok).toBe(true);
    expect(report.unmetCriteria).toContain("implement-gates-pass");
    expect(report.unmetCriteria).toContain("implement-tests-first");
    // The judged criterion still passes through — no tool can decide it, and
    // pretending otherwise would be the opposite error.
    expect(report.unmetCriteria).not.toContain("implement-task-done-criteria-met");
    expect(report.stageClosable).toBe(false);
  });

  /**
   * The same submission with real evidence behind it. Nothing about the CALL
   * changes — the difference is entirely in what the journal holds, which is the
   * property being asserted.
   */
  it("derives both from journaled gate evidence, and closes the stage on it", async () => {
    const deps = reviewDeps();
    const changeSetId = registerChangeSet(deps);

    let evidenceSeq = 0;
    const evidence = (gateTag: string, capturedAt: string): EvidenceRecord => ({
      schemaVersion: 1,
      id: `44444444-4444-4444-8444-${String(++evidenceSeq).padStart(12, "0")}`,
      changeSetId,
      command: `npm run gate:${gateTag}`,
      exitStatus: 0,
      toolchainFingerprint: "node24",
      capturedAt,
      artifactDigests: [],
      objectId: "candidate-object",
      gateTag,
      gateVerdict: "passed",
    });

    // A red baseline first — the record that used to make implement-gates-pass
    // permanently underivable for any ChangeSet that did TDD properly. It carries
    // NO gateVerdict, because a pre-dispatch capture is not a firing.
    const redBaseline: EvidenceRecord = {
      schemaVersion: 1,
      id: "44444444-4444-4444-8444-000000000099",
      changeSetId,
      command: "npm run gate:tdd",
      exitStatus: 1,
      toolchainFingerprint: "node24",
      capturedAt: "2026-07-29T00:00:00.000Z",
      artifactDigests: [],
      objectId: "base-object",
      gateTag: "tdd",
    };
    await deps.journal.appendEntry({
      type: "evidence_pointer",
      changeSetId,
      payload: redBaseline,
    });
    await deps.journal.appendEntry({
      type: "evidence_pointer",
      changeSetId,
      payload: evidence("tdd", "2026-07-29T01:00:00.000Z"),
    });
    await deps.journal.appendEntry({
      type: "evidence_pointer",
      changeSetId,
      payload: evidence("coverage", "2026-07-29T01:00:00.000Z"),
    });

    const report = await submit(deps, changeSetId, {
      metCriteria: ["implement-task-done-criteria-met"],
    });

    expect(report.unmetCriteria).not.toContain("implement-gates-pass");
    expect(report.unmetCriteria).not.toContain("implement-tests-first");
    // no-open-debt-in-touched-paths derives clean too (no findings, no writes),
    // so with the judged criterion supplied the stage genuinely closes.
    expect(report.unmetCriteria).toEqual([]);
    expect(report.stageClosable).toBe(true);
  });
});

/**
 * `review.calibrate`, driven through the real production registry.
 *
 * The point of asserting this HERE rather than only against the pure handler is
 * that the defect was never in the logic. `scoreCalibration` and
 * `recordCalibrationSample` were both correct and both tested; nothing called the
 * latter, so the corpus could not be filled by any means the product offered.
 * A unit test of the handler would have passed throughout that entire period.
 */
describe("review.calibrate — the corpus is fillable through the shipped surface", () => {
  function registry(
    deps: Omit<ProductionGatewayToolRegistryDeps, "providers" | "mutationApplyClients">,
  ) {
    return buildProductionGatewayToolRegistry({
      ...deps,
      providers: new ProviderRegistry<GenericProviderClient>(),
      mutationApplyClients: new ProviderRegistry<MutationApplyClient>(),
    });
  }

  function calibrationDeps(): Omit<
    ProductionGatewayToolRegistryDeps,
    "providers" | "mutationApplyClients"
  > {
    const stateHome = mkdtempSync(join(tmpdir(), "eo-reg-calibrate-"));
    return {
      ...stubDeps(),
      reviewStateHome: stateHome,
      reviewFindingsPath: join(stateHome, "review-findings.json"),
      reviewCalibrationPath: join(stateHome, "review-calibration.json"),
    };
  }

  async function call(
    deps: Omit<ProductionGatewayToolRegistryDeps, "providers" | "mutationApplyClients">,
    args: Record<string, unknown>,
  ) {
    const result = await registry(deps).get("review.calibrate")!.handler(args);
    return {
      isError: result.isError === true,
      body: JSON.parse(result.content[0]!.text) as {
        ok?: boolean;
        error?: string;
        calibration?: { sampleSize: number; verdictReason: string };
        candidates?: { findingId: string }[];
        candidatesTotal?: number;
      },
    };
  }

  /** A fresh project: the honest empty state, reported with a reason rather than a bare zero. */
  it("reports an empty corpus and nothing to ask about before any review has happened", async () => {
    const { isError, body } = await call(calibrationDeps(), {});
    expect(isError).toBe(false);
    expect(body.calibration?.sampleSize).toBe(0);
    expect(body.calibration?.verdictReason).toMatch(/nobody has classified/i);
    expect(body.candidatesTotal).toBe(0);
  });

  /**
   * The whole loop, end to end and through the real stores: a reviewer submits a
   * finding, the owner disagrees with how it was classified, and the corpus moves
   * off zero for the first time.
   */
  it("records the owner's call against a finding the reviewer actually submitted", async () => {
    const deps = calibrationDeps();
    const changeSetId = "66666666-6666-4666-8666-666666666666";
    deps.changeSets.put({ id: changeSetId } as unknown as ChangeSet);

    const submitted = await registry(deps)
      .get("review.submit")!
      .handler({
        stage: "implement",
        changeSetId,
        verdict: {
          schemaVersion: 1,
          id: "77777777-7777-4777-8777-777777777777",
          createdAt: "2026-07-29T00:00:00.000Z",
          stage: "implement",
          artifactRef: "changeset:abc",
          lens: "security",
          verdict: "revise",
          round: 1,
          findings: [
            {
              id: "88888888-8888-4888-8888-888888888888",
              claim: "the state path is not checked for a symlinked component",
              evidence: {
                reproduction: "ln -s /etc ~/.local/state/crabgic/x",
                observed: "followed",
                expected: "refused",
              },
              verification: "confirmed",
              classification: "advisory",
              paths: ["packages/cli/src/doctor"],
            },
          ],
        },
      });
    expect(submitted.isError).toBeUndefined();

    // The reviewer called it advisory. The owner says it should have blocked —
    // and the classifier's half of that comparison is read from the store, never
    // taken from this call.
    const { body } = await call(deps, {
      findingId: "88888888-8888-4888-8888-888888888888",
      ownerClassification: "blocking",
    });

    expect(body.ok).toBe(true);
    expect(body.calibration?.sampleSize).toBe(1);
    // Still uncalibrated, and now for the right reason: not "nobody has looked"
    // but "one sample is not a measurement".
    expect(body.calibration?.verdictReason).toMatch(/more classified findings/i);
    expect(body.candidatesTotal).toBe(0);
  });

  it("refuses a judgement about a finding no reviewer ever submitted", async () => {
    const { isError, body } = await call(calibrationDeps(), {
      findingId: "99999999-9999-4999-8999-999999999999",
      ownerClassification: "blocking",
    });
    expect(isError).toBe(true);
    expect(body.error).toMatch(/unknown finding/);
  });
});
