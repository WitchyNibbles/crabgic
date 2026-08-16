import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createJournalStore, type JournalStore } from "@crabgic/journal";
import {
  createChangeSetsRegistry,
  createWorkUnitsRegistry,
  createAuthorizationEnvelopesRegistry,
  createIntentContractsRegistry,
  createRequirementsRegistry,
  type IntakeRequest,
} from "@crabgic/supervisor";
import { EnvelopePolicySchema } from "@crabgic/contracts";
import type { LoadPolicyResult } from "../policy/policy-store.js";
import { runIntakeCommand } from "./run-intake-command.js";
import type { StageCompletionRecord } from "@crabgic/contracts";

let journalDir: string;
let store: JournalStore;

beforeEach(async () => {
  journalDir = await mkdtemp(join(tmpdir(), "eo-cli-run-intake-command-"));
  store = createJournalStore({ journalDir });
});

afterEach(async () => {
  await rm(journalDir, { recursive: true, force: true });
});

function fixtureRequest(overrides: Partial<IntakeRequest> = {}): IntakeRequest {
  return {
    requestKey: "repo:example",
    id: "11111111-1111-4111-8111-111111111111",
    createdAt: "2026-01-01T00:00:00.000Z",
    sections: {
      scope: "s",
      "non-goals": "n",
      audience: "a",
      compatibility: "c",
      security: "sec",
      performance: "p",
      observability: "o",
      rollout: "r",
      acceptance: "acc",
    },
    requirements: [],
    workUnits: [],
    envelopeContent: {
      ownedPaths: ["src/login"],
      commands: [],
      networkDestinations: [],
      credentialReferences: [],
      dependencies: [],
      remoteResourceAuthorizations: [],
      temporaryServices: [],
      prohibitedActions: [],
    },
    rollbackStrategy: "Revert the integration commit.",
    ...overrides,
  };
}

const STANDING_POLICY: LoadPolicyResult = {
  status: "loaded",
  policy: EnvelopePolicySchema.parse({
    maxWorkerTurnsPerAttempt: 40,
    schemaVersion: 1,
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    createdAt: "2026-01-01T00:00:00.000Z",
    allowedPathPrefixes: ["src"],
  }),
  digest: "sha256:fixture",
};

function deps(
  changeSets: ReturnType<typeof createChangeSetsRegistry>,
  request: () => Promise<IntakeRequest>,
  loadPolicy: () => LoadPolicyResult = () => STANDING_POLICY,
  // R8: these suites assert POST-gate behaviour; the gate has its own suite
  // in packages/supervisor/src/intake/readiness-gate.test.ts.
  /**
   * R8: defaults to a PASSING design gate, because these cases assert what the
   * intake command does once the gate is behind it. The refusal has its own
   * suite in `packages/supervisor/src/intake/readiness-gate.test.ts`; a default
   * of `[]` here would silently convert every case in this file into a test of
   * that refusal.
   */
  loadStageCompletions: () => Promise<readonly StageCompletionRecord[]> = () =>
    Promise.resolve([
      {
        schemaVersion: 1,
        changeSetId: "11111111-1111-4111-8111-111111111111",
        stage: "design-gate",
        round: 1,
        artifactRef: "design-record:test",
        closedAt: "2026-08-16T00:00:00.000Z",
      },
    ]),
) {
  return {
    loadStageCompletions,
    journal: store,
    changeSets,
    workUnits: createWorkUnitsRegistry(),
    envelopes: createAuthorizationEnvelopesRegistry(),
    intentContracts: createIntentContractsRegistry(),
    requirements: createRequirementsRegistry(),
    readIntakeRequest: request,
    loadPolicy,
  };
}

describe("runIntakeCommand", () => {
  it("approves a policy-covered request with no prompt and no token, leaving the ChangeSet ready", async () => {
    const changeSets = createChangeSetsRegistry();
    const result = await runIntakeCommand(deps(changeSets, async () => fixtureRequest()));

    expect(result.outcome.status).toBe("created");
    expect(result.standing?.status).toBe("approved");
    if (result.outcome.status === "conflict") throw new Error("unreachable");
    expect(changeSets.get(result.outcome.artifacts.changeSet.id)?.state).toBe("ready");
    // Gap 18's courier fix: nothing token-shaped is returned, because nothing
    // is minted on this path at all.
    expect(JSON.stringify(result)).not.toContain('"token"');
  });

  it("escalates an out-of-policy request WITHOUT prompting, leaving the ChangeSet awaiting_approval", async () => {
    const changeSets = createChangeSetsRegistry();
    const result = await runIntakeCommand(
      deps(
        changeSets,
        async () => fixtureRequest({ requestKey: "repo:escalate" }),
        () => ({
          status: "loaded",
          policy: EnvelopePolicySchema.parse({
            maxWorkerTurnsPerAttempt: 40,
            schemaVersion: 1,
            id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
            createdAt: "2026-01-01T00:00:00.000Z",
            allowedPathPrefixes: ["docs"],
          }),
          digest: "sha256:narrow",
        }),
      ),
    );

    expect(result.standing?.status).toBe("escalate");
    if (result.outcome.status === "conflict") throw new Error("unreachable");
    expect(changeSets.get(result.outcome.artifacts.changeSet.id)?.state).toBe("awaiting_approval");
  });

  it("escalates when no policy exists, rather than assuming an approval", async () => {
    const changeSets = createChangeSetsRegistry();
    const result = await runIntakeCommand(
      deps(
        changeSets,
        async () => fixtureRequest({ requestKey: "repo:nopolicy" }),
        () => ({
          status: "absent",
        }),
      ),
    );
    expect(result.standing?.status).toBe("escalate");
  });

  it("never reaches the approval decision for a conflict outcome", async () => {
    const changeSets = createChangeSetsRegistry();
    const first = deps(changeSets, async () => fixtureRequest());
    await runIntakeCommand(first);

    const result = await runIntakeCommand({
      ...first,
      readIntakeRequest: async () => fixtureRequest({ rollbackStrategy: "A different strategy." }),
    });
    expect(result.outcome.status).toBe("conflict");
    expect(result.standing).toBeUndefined();
  });
});
