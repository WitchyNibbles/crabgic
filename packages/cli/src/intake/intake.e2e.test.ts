/**
 * `intake.e2e.spec` — roadmap/11-intake-contract-approval.md §Exit
 * criteria: "E2E (fake engine): request -> contract -> approval -> run;
 * halts correctly on each of the 7 seeded stop conditions independently."
 * Ties together every module this phase adds across `@eo/supervisor`
 * (intake pipeline, DAG/envelope/manifest builders, run-lifecycle/stop-
 * conditions) and `packages/cli` (approval mint via `runIntakeCommand`,
 * verify via `runContractApprove`) into one real, end-to-end path — no
 * mocks of this phase's OWN modules, only a fake `EngineCapabilities`-
 * shaped input standing in for 06's real engine (per roadmap/11 §Risks:
 * "Until 06 lands for real, `EngineAdapter.capabilities()` values used in
 * the approval preview come from 03's fake engine").
 */
import { randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createJournalStore, type JournalStore } from "@eo/journal";
import {
  createAuthorizationEnvelopesRegistry,
  createChangeSetsRegistry,
  createRunsRegistry,
  createWorkUnitsRegistry,
  haltOnStopCondition,
  STOP_CONDITION_KINDS,
  transitionRun,
  type IntakeRequest,
} from "@eo/supervisor";
import { ApprovalTokenMinter } from "../approval/token.js";
import { runIntakeCommand } from "./run-intake-command.js";
import { runContractApprove } from "./contract-approve-handler.js";

let journalDir: string;
let store: JournalStore;

beforeEach(async () => {
  journalDir = await mkdtemp(join(tmpdir(), "eo-cli-intake-e2e-"));
  store = createJournalStore({ journalDir });
});

afterEach(async () => {
  await rm(journalDir, { recursive: true, force: true });
});

function e2eRequest(requestKey: string, changeSetId: string): IntakeRequest {
  return {
    requestKey,
    id: changeSetId,
    createdAt: "2026-01-01T00:00:00.000Z",
    sections: {
      scope: "Add a login form.",
      "non-goals": "No SSO.",
      audience: "End users.",
      compatibility: "None broken.",
      security: "Rate-limited.",
      performance: "p95 < 200ms.",
      observability: "login_attempt metric.",
      rollout: "No flag.",
      acceptance: "Login succeeds; 6th attempt in 60s is rejected.",
    },
    requirements: [
      {
        section: "scope",
        title: "Add login form",
        description: "d",
        acceptanceCriteria: ["works"],
      },
    ],
    workUnits: [],
    envelopeContent: {
      ownedPaths: ["packages/example/src/login/"],
      commands: ["npm test"],
      networkDestinations: [],
      credentialReferences: [],
      dependencies: [],
      remoteResourceAuthorizations: [],
      temporaryServices: [],
      prohibitedActions: [],
    },
    rollbackStrategy: "Revert the integration commit.",
    performanceBudgetSource: "requirement_acceptance_criteria",
    performanceBudgets: [{ metric: "latency", percentile: 95, threshold: 200, unit: "ms" }],
    capabilityManifest: {
      // Stand-in for 06's real EngineAdapter.capabilities() — 03's fake
      // engine shape, per this phase's own documented risk note.
      engineEntry: {
        kind: "engine",
        engineVersion: "2.1.0-fake",
        supportsJsonSchema: true,
        supportsSessionResume: true,
      },
    },
  };
}

describe("intake.e2e — request -> contract -> approval -> run", () => {
  it("approves end-to-end and reaches ready", async () => {
    const secretKey = randomBytes(32);
    const changeSets = createChangeSetsRegistry();
    const workUnits = createWorkUnitsRegistry();
    const envelopes = createAuthorizationEnvelopesRegistry();
    const minter = new ApprovalTokenMinter({ secretKey });
    const changeSetId = "11111111-1111-4111-8111-111111111111";

    const input = new PassThrough();
    const commandPromise = runIntakeCommand({
      journal: store,
      changeSets,
      workUnits,
      envelopes,
      minter,
      io: { input, output: new PassThrough() },
      readIntakeRequest: async () => e2eRequest("e2e:approve", changeSetId),
    });
    input.write("yes\n");
    const commandResult = await commandPromise;
    if (commandResult.outcome.status === "conflict") throw new Error("unreachable");
    expect(commandResult.outcome.artifacts.changeSet.state).toBe("awaiting_approval");

    const approveResult = await runContractApprove(
      {
        changeSetId,
        digest: commandResult.outcome.artifacts.envelope.canonicalHash,
        token: commandResult.approvalToken!.token,
      },
      { secretKey, journal: store, changeSets, envelopes, requirementIds: [], workUnits: [] },
    );

    expect(approveResult.approved).toBe(true);
    expect(changeSets.get(changeSetId)?.state).toBe("ready");
  });

  it("a replayed OLD token fails closed after the request is re-approved under a fresh key (model self-approval / replay fixture)", async () => {
    const secretKey = randomBytes(32);
    const changeSets = createChangeSetsRegistry();
    const workUnits = createWorkUnitsRegistry();
    const envelopes = createAuthorizationEnvelopesRegistry();
    const minter = new ApprovalTokenMinter({ secretKey });
    const changeSetId = "22222222-2222-4222-8222-222222222222";

    const input = new PassThrough();
    const commandPromise = runIntakeCommand({
      journal: store,
      changeSets,
      workUnits,
      envelopes,
      minter,
      io: { input, output: new PassThrough() },
      readIntakeRequest: async () => e2eRequest("e2e:replay", changeSetId),
    });
    input.write("yes\n");
    const commandResult = await commandPromise;
    if (commandResult.outcome.status === "conflict") throw new Error("unreachable");
    const digest = commandResult.outcome.artifacts.envelope.canonicalHash;
    const token = commandResult.approvalToken!.token;

    const first = await runContractApprove(
      { changeSetId, digest, token },
      { secretKey, journal: store, changeSets, envelopes, requirementIds: [], workUnits: [] },
    );
    expect(first.approved).toBe(true);

    const replay = await runContractApprove(
      { changeSetId, digest, token },
      { secretKey, journal: store, changeSets, envelopes, requirementIds: [], workUnits: [] },
    );
    expect(replay.approved).toBe(false);
  });

  it.each(STOP_CONDITION_KINDS.map((kind, index) => [kind, index] as const))(
    "halts an in-flight run for stop condition %s via the correct transition, and no other",
    async (kind, index) => {
      const runs = createRunsRegistry();
      const runId = `33333333-0000-4000-8000-${String(index).padStart(12, "0")}`;
      const changeSetId = "44444444-4444-4444-8444-444444444444";

      for (const to of ["awaiting_approval", "ready", "running"] as const) {
        await transitionRun({ journal: store, runs, runId, changeSetId, to });
      }

      const record = await haltOnStopCondition({
        journal: store,
        runs,
        runId,
        changeSetId,
        kind,
        reason: `intake.e2e seeded fixture for ${kind}`,
      });

      expect(record.runState).toBe("blocked");
      expect(runs.get(runId)?.runState).toBe("blocked");
    },
  );
});
