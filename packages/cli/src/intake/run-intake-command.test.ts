import { randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createJournalStore, type JournalStore } from "@crabgic/journal";
import {
  createChangeSetsRegistry,
  createWorkUnitsRegistry,
  createAuthorizationEnvelopesRegistry,
  createIntentContractsRegistry,
  type IntakeRequest,
} from "@crabgic/supervisor";
import { ApprovalTokenMinter } from "../approval/token.js";
import { runIntakeCommand } from "./run-intake-command.js";

const secretKey = randomBytes(32);

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
      ownedPaths: [],
      commands: [],
      networkDestinations: [],
      credentialReferences: [],
      dependencies: [],
      remoteResourceAuthorizations: [],
      temporaryServices: [],
      prohibitedActions: [],
    },
    rollbackStrategy: "Revert the integration commit.",
    performanceBudgetSource: "ecosystem_research",
    performanceBudgets: [],
    ...overrides,
  };
}

describe("runIntakeCommand", () => {
  it("runs intake then completes approval in-process on an explicit 'yes' — ChangeSet reaches ready, no token in the result", async () => {
    const changeSets = createChangeSetsRegistry();
    const workUnits = createWorkUnitsRegistry();
    const envelopes = createAuthorizationEnvelopesRegistry();
    const intentContracts = createIntentContractsRegistry();
    const minter = new ApprovalTokenMinter({ secretKey });
    const input = new PassThrough();
    const output = new PassThrough();

    const resultPromise = runIntakeCommand({
      journal: store,
      changeSets,
      workUnits,
      envelopes,
      intentContracts,
      minter,
      secretKey,
      io: { input, output },
      readIntakeRequest: async () => fixtureRequest(),
    });
    input.write("yes\n");
    const result = await resultPromise;

    expect(result.outcome.status).toBe("created");
    expect(result.approval?.approved).toBe(true);
    expect(result.declined).toBeUndefined();
    if (result.outcome.status === "conflict") throw new Error("unreachable");
    // The whole point of in-process completion: the ChangeSet is READY, and
    // the spent token appears nowhere in the result (Gap 18's courier fix).
    expect(changeSets.get(result.outcome.artifacts.changeSet.id)?.state).toBe("ready");
    expect(JSON.stringify(result)).not.toContain('"token"');
  });

  it("runs intake then records a decline on anything other than 'yes' — never mints", async () => {
    const changeSets = createChangeSetsRegistry();
    const workUnits = createWorkUnitsRegistry();
    const envelopes = createAuthorizationEnvelopesRegistry();
    const intentContracts = createIntentContractsRegistry();
    const minter = new ApprovalTokenMinter({ secretKey });
    const input = new PassThrough();
    const output = new PassThrough();

    const resultPromise = runIntakeCommand({
      journal: store,
      changeSets,
      workUnits,
      envelopes,
      intentContracts,
      minter,
      secretKey,
      io: { input, output },
      readIntakeRequest: async () => fixtureRequest(),
    });
    input.write("no\n");
    const result = await resultPromise;

    expect(result.declined).toBe(true);
    expect(result.approval).toBeUndefined();
    // "Never mints" stopped being observable from the result once the token
    // left it, so the ChangeSet's own state is what proves nothing was
    // approved (adversarial review, 2026-07-29).
    if (result.outcome.status === "conflict") throw new Error("unreachable");
    expect(changeSets.get(result.outcome.artifacts.changeSet.id)?.state).toBe("awaiting_approval");
  });

  it("never reaches the approval prompt for a conflict outcome", async () => {
    const changeSets = createChangeSetsRegistry();
    const workUnits = createWorkUnitsRegistry();
    const envelopes = createAuthorizationEnvelopesRegistry();
    const intentContracts = createIntentContractsRegistry();
    const minter = new ApprovalTokenMinter({ secretKey });

    const firstInput = new PassThrough();
    const firstResult = runIntakeCommand({
      journal: store,
      changeSets,
      workUnits,
      envelopes,
      intentContracts,
      minter,
      secretKey,
      io: { input: firstInput, output: new PassThrough() },
      readIntakeRequest: async () => fixtureRequest(),
    });
    firstInput.write("yes\n");
    await firstResult;

    const output = new PassThrough();
    let wrote = false;
    output.on("data", () => {
      wrote = true;
    });

    const result = await runIntakeCommand({
      journal: store,
      changeSets,
      workUnits,
      envelopes,
      intentContracts,
      minter,
      secretKey,
      io: { input: new PassThrough(), output },
      readIntakeRequest: async () => fixtureRequest({ rollbackStrategy: "A different strategy." }),
    });

    expect(result.outcome.status).toBe("conflict");
    expect(wrote).toBe(false);
  });

  it("rethrows a non-decline error from the approval flow rather than swallowing it", async () => {
    const changeSets = createChangeSetsRegistry();
    const workUnits = createWorkUnitsRegistry();
    const envelopes = createAuthorizationEnvelopesRegistry();
    const intentContracts = createIntentContractsRegistry();
    const boomMinter = {
      mint: async () => {
        throw new Error("boom");
      },
    } as unknown as ApprovalTokenMinter;
    const input = new PassThrough();

    const resultPromise = runIntakeCommand({
      journal: store,
      changeSets,
      workUnits,
      envelopes,
      intentContracts,
      minter: boomMinter,
      secretKey,
      io: { input, output: new PassThrough() },
      readIntakeRequest: async () => fixtureRequest({ requestKey: "repo:boom" }),
    });
    input.write("yes\n");

    await expect(resultPromise).rejects.toThrow("boom");
  });
});
