/**
 * `dispatchCommand`'s conditional routing for `run` (roadmap/11-intake-
 * contract-approval.md) — when `deps.intake` IS supplied, `run` hits the
 * real intake -> contract -> approval backend rather than
 * `NOT_IMPLEMENTED`. `./cli.commands.schema.test.ts`'s own pre-existing
 * suite (09, unmodified by this phase) proves the other half: without
 * `deps.intake`, `run` still returns the exact typed `NOT_IMPLEMENTED`
 * shape — mirrors `./installer-dispatch.test.ts`'s identical structure for
 * `install`/`upgrade`/`uninstall`.
 */
import { randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createJournalStore, type JournalStore } from "@eo/journal";
import {
  createChangeSetsRegistry,
  createWorkUnitsRegistry,
  createAuthorizationEnvelopesRegistry,
  type IntakeRequest,
} from "@eo/supervisor";
import { EXIT_OK } from "../exit-codes.js";
import { ApprovalTokenMinter } from "../approval/token.js";
import { dispatchCommand } from "./dispatch.js";
import type { CliDependencies } from "./types.js";

let journalDir: string;
let store: JournalStore;

beforeEach(async () => {
  journalDir = await mkdtemp(join(tmpdir(), "eo-intake-dispatch-"));
  store = createJournalStore({ journalDir });
});

afterEach(async () => {
  await rm(journalDir, { recursive: true, force: true });
});

function baseDeps(): Pick<CliDependencies, "connectClient" | "journal" | "projectHash"> {
  return {
    connectClient: () => {
      throw new Error("not needed for this test");
    },
    journal: {
      queryEntries: async function* () {
        /* no entries */
      },
      verifyJournal: async () => ({ ok: true, entries: 0 }) as never,
    },
    projectHash: "test-hash",
  };
}

function fixtureRequest(): IntakeRequest {
  return {
    requestKey: "repo:dispatch-test",
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
  };
}

describe("dispatchCommand — run, real backend when deps.intake is supplied", () => {
  it("run --json returns NOT_IMPLEMENTED when deps.intake is absent (unchanged roadmap/09 default)", async () => {
    const result = await dispatchCommand(
      { command: "run", json: true },
      baseDeps() as CliDependencies,
    );
    const parsed = JSON.parse(result.stdout!) as { status: string };
    expect(parsed.status).toBe("NOT_IMPLEMENTED");
  });

  it("run --json runs the real intake backend when deps.intake is present", async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const deps: CliDependencies = {
      ...baseDeps(),
      intake: {
        journal: store,
        changeSets: createChangeSetsRegistry(),
        workUnits: createWorkUnitsRegistry(),
        envelopes: createAuthorizationEnvelopesRegistry(),
        minter: new ApprovalTokenMinter({ secretKey: randomBytes(32) }),
        readIntakeRequest: async () => fixtureRequest(),
        io: { input, output },
      },
    };

    const resultPromise = dispatchCommand({ command: "run", json: true }, deps);
    input.write("yes\n");
    const result = await resultPromise;

    expect(result.exitCode).toBe(EXIT_OK);
    const parsed = JSON.parse(result.stdout!) as { outcome: { status: string } };
    expect(parsed.outcome.status).toBe("created");
  });
});
