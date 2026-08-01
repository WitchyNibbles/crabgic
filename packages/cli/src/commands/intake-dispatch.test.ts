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
import { EXIT_GENERAL_ERROR, EXIT_OK } from "../exit-codes.js";
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

/** Records every op the command sends to the supervisor, and answers `run.dispatch` with a minted run id. */
function recordingClient(): {
  readonly calls: { op: string; params: Record<string, unknown> }[];
  readonly connectClient: CliDependencies["connectClient"];
} {
  const calls: { op: string; params: Record<string, unknown> }[] = [];
  return {
    calls,
    connectClient: () =>
      Promise.resolve({
        request: (op: string, params: Record<string, unknown>) => {
          calls.push({ op, params });
          return Promise.resolve({ accepted: true, runId: "44444444-4444-4444-8444-444444444444" });
        },
        close: () => Promise.resolve(),
      } as never),
  };
}

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

function fixtureRequest(overrides: { readonly ownedPaths?: string[] } = {}): IntakeRequest {
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
      ownedPaths: overrides.ownedPaths ?? [],
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

  it("run --json runs the real intake backend when deps.intake is present — and never renders a token", async () => {
    const secretKey = randomBytes(32);
    const input = new PassThrough();
    const output = new PassThrough();
    const supervisor = recordingClient();
    const deps: CliDependencies = {
      ...baseDeps(),
      connectClient: supervisor.connectClient,
      intake: {
        journal: store,
        changeSets: createChangeSetsRegistry(),
        workUnits: createWorkUnitsRegistry(),
        envelopes: createAuthorizationEnvelopesRegistry(),
        intentContracts: createIntentContractsRegistry(),
        requirements: createRequirementsRegistry(),
        minter: new ApprovalTokenMinter({ secretKey }),
        secretKey,
        readIntakeRequest: async () => fixtureRequest(),
        io: { input, output },
        loadPolicy: () => ({
          status: "loaded" as const,
          policy: EnvelopePolicySchema.parse({
            maxWorkerTurnsPerAttempt: 40,
            schemaVersion: 1,
            id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
            createdAt: "2026-01-01T00:00:00.000Z",
            allowedPathPrefixes: ["src"],
          }),
          digest: "sha256:fixture",
        }),
      },
    };

    const result = await dispatchCommand({ command: "run", json: true }, deps);

    expect(result.exitCode).toBe(EXIT_OK);
    const parsed = JSON.parse(result.stdout!) as {
      outcome: { status: string };
      standing?: { status: string };
      dispatch?: { accepted: boolean };
    };
    expect(parsed.outcome.status).toBe("created");
    expect(parsed.standing?.status).toBe("approved");
    expect(parsed.dispatch?.accepted).toBe(true);
    // Ledger Gap 18's audit: `run --json` printing the minted token made the
    // model the courier for a human-approval token. The rendered output must
    // never contain one again.
    expect(result.stdout).not.toContain('"token"');
    // An approved change set is DISPATCHED, not parked in `ready` waiting for
    // a second command nobody was told to run.
    expect(supervisor.calls).toEqual([
      { op: "run.dispatch", params: { changeSetId: "11111111-1111-4111-8111-111111111111" } },
    ]);
  });

  /**
   * The routine path (ledger Gap 18). With a policy that covers the envelope,
   * `run` must reach `ready` WITHOUT writing a prompt or reading a keystroke —
   * that is the whole product direction: "the user types no Crabgic command."
   */
  it("approves a policy-covered change set with no prompt and no token, naming the authorizing digest", async () => {
    const secretKey = randomBytes(32);
    const input = new PassThrough();
    const output = new PassThrough();
    let prompted = false;
    output.on("data", () => {
      prompted = true;
    });
    const changeSets = createChangeSetsRegistry();
    const supervisor = recordingClient();
    const deps: CliDependencies = {
      ...baseDeps(),
      connectClient: supervisor.connectClient,
      intake: {
        journal: store,
        changeSets,
        workUnits: createWorkUnitsRegistry(),
        envelopes: createAuthorizationEnvelopesRegistry(),
        intentContracts: createIntentContractsRegistry(),
        requirements: createRequirementsRegistry(),
        minter: new ApprovalTokenMinter({ secretKey }),
        secretKey,
        readIntakeRequest: async () => fixtureRequest(),
        io: { input, output },
        loadPolicy: () => ({
          status: "loaded",
          policy: EnvelopePolicySchema.parse({
            maxWorkerTurnsPerAttempt: 40,
            schemaVersion: 1,
            id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
            createdAt: "2026-01-01T00:00:00.000Z",
            allowedPathPrefixes: ["src"],
          }),
          digest: "sha256:standing",
        }),
      },
    };

    // No `input.write` anywhere: nothing may be waiting on a keystroke.
    const result = await dispatchCommand({ command: "run", json: false }, deps);

    expect(result.exitCode).toBe(EXIT_OK);
    expect(result.stdout).toContain("standing approval policy");
    expect(result.stdout).toContain("sha256:standing");
    expect(result.stdout).toContain("dispatched as run 44444444-4444-4444-8444-444444444444");
    expect(prompted).toBe(false);
    expect(changeSets.list().every((changeSet) => changeSet.state === "ready")).toBe(true);
    // THE WHOLE POINT: request in, work started, nobody asked anything.
    expect(supervisor.calls.map((call) => call.op)).toEqual(["run.dispatch"]);
  });

  /**
   * The critic that runs where nobody reads. Wired at the command level rather
   * than asserted only on the pure function, because a critic nothing calls is
   * the failure mode this repository has paid for repeatedly.
   */
  it("notes authority the plan never uses when the standing policy auto-approves", async () => {
    const secretKey = randomBytes(32);
    const supervisor = recordingClient();
    const deps: CliDependencies = {
      ...baseDeps(),
      connectClient: supervisor.connectClient,
      intake: {
        journal: store,
        changeSets: createChangeSetsRegistry(),
        workUnits: createWorkUnitsRegistry(),
        envelopes: createAuthorizationEnvelopesRegistry(),
        intentContracts: createIntentContractsRegistry(),
        requirements: createRequirementsRegistry(),
        minter: new ApprovalTokenMinter({ secretKey }),
        secretKey,
        // Grants `src`, and the fixture declares no work units at all -- so the
        // whole grant is unused.
        readIntakeRequest: async () => fixtureRequest({ ownedPaths: ["src"] }),
        io: { input: new PassThrough(), output: new PassThrough() },
        loadPolicy: () => ({
          status: "loaded",
          policy: EnvelopePolicySchema.parse({
            maxWorkerTurnsPerAttempt: 40,
            schemaVersion: 1,
            id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
            createdAt: "2026-01-01T00:00:00.000Z",
            allowedPathPrefixes: ["src"],
          }),
          digest: "sha256:standing",
        }),
      },
    };

    const result = await dispatchCommand({ command: "run", json: false }, deps);

    // Approved and dispatched -- the note never blocks anything.
    expect(result.exitCode).toBe(EXIT_OK);
    expect(result.stdout).toContain("dispatched as run");
    expect(result.stdout).toContain("no work unit uses");
    expect(result.stdout).toContain("src");
    expect(result.stdout).toContain("nothing is blocked");
  });

  it("reports a refused dispatch WITHOUT losing the approval — the change set stays ready and retryable", async () => {
    const secretKey = randomBytes(32);
    const changeSets = createChangeSetsRegistry();
    const deps: CliDependencies = {
      ...baseDeps(),
      // The daemon is unreachable. The approval already happened durably, so
      // this is a retryable start failure, not a lost approval.
      connectClient: () => Promise.reject(new Error("simulated: no such socket")),
      intake: {
        journal: store,
        changeSets,
        workUnits: createWorkUnitsRegistry(),
        envelopes: createAuthorizationEnvelopesRegistry(),
        intentContracts: createIntentContractsRegistry(),
        requirements: createRequirementsRegistry(),
        minter: new ApprovalTokenMinter({ secretKey }),
        secretKey,
        readIntakeRequest: async () => fixtureRequest(),
        io: { input: new PassThrough(), output: new PassThrough() },
        loadPolicy: () => ({
          status: "loaded",
          policy: EnvelopePolicySchema.parse({
            maxWorkerTurnsPerAttempt: 40,
            schemaVersion: 1,
            id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
            createdAt: "2026-01-01T00:00:00.000Z",
            allowedPathPrefixes: ["src"],
          }),
          digest: "sha256:standing",
        }),
      },
    };

    const result = await dispatchCommand({ command: "run", json: false }, deps);

    expect(result.exitCode).toBe(EXIT_GENERAL_ERROR);
    expect(result.stderr).toContain("approved and ready");
    expect(result.stderr).toContain("simulated: no such socket");
    // The approval survived: re-authoring an intake request must NOT be the remedy.
    expect(changeSets.list().every((changeSet) => changeSet.state === "ready")).toBe(true);
  });

  it("escalates an out-of-policy envelope WITHOUT prompting, naming the escape and the approve command", async () => {
    const secretKey = randomBytes(32);
    const input = new PassThrough();
    const output = new PassThrough();
    let prompted = false;
    output.on("data", () => {
      prompted = true;
    });
    const changeSets = createChangeSetsRegistry();
    let dispatched = false;
    const deps: CliDependencies = {
      ...baseDeps(),
      standingPolicyPath: "/state/crabgic/hash/envelope-policy.json",
      connectClient: () => {
        dispatched = true;
        throw new Error("must not dispatch an unapproved change set");
      },
      intake: {
        journal: store,
        changeSets,
        workUnits: createWorkUnitsRegistry(),
        envelopes: createAuthorizationEnvelopesRegistry(),
        intentContracts: createIntentContractsRegistry(),
        requirements: createRequirementsRegistry(),
        minter: new ApprovalTokenMinter({ secretKey }),
        secretKey,
        readIntakeRequest: async () => fixtureRequest({ ownedPaths: ["infra/secrets"] }),
        io: { input, output },
        loadPolicy: () => ({
          status: "loaded",
          policy: EnvelopePolicySchema.parse({
            maxWorkerTurnsPerAttempt: 40,
            schemaVersion: 1,
            id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
            createdAt: "2026-01-01T00:00:00.000Z",
            allowedPathPrefixes: ["src"],
          }),
          digest: "sha256:standing",
        }),
      },
    };

    const result = await dispatchCommand({ command: "run", json: false }, deps);

    // A refusal is a non-zero exit, and the reason is what the operator reads.
    expect(result.exitCode).toBe(EXIT_GENERAL_ERROR);
    expect(result.stderr).toContain("infra/secrets");
    // THE REMEDY IS THE POLICY (2026-07-30). This used to lead with
    // `crabgic approve <digest>` — a ceremony that cannot succeed for a
    // standing-policy escalation: approval flips the ChangeSet ready and the
    // daemon's containment-only gate refuses the identical envelope again.
    // The message must lead with the edit that works, name the file, and
    // say plainly that approve records consent but grants no authority.
    expect(result.stderr).toContain("Grant it by editing the standing policy");
    expect(result.stderr).toContain("envelope-policy.json");
    expect(result.stderr).toContain("cannot ");
    expect(result.stderr).toMatch(/crabgic approve .*records consent/s);
    // No prompt is rendered, and nothing is dispatched or half-granted.
    expect(prompted).toBe(false);
    expect(dispatched).toBe(false);
    expect(changeSets.list().every((changeSet) => changeSet.state === "awaiting_approval")).toBe(
      true,
    );
  });

  it("exits non-zero for a refusal under --json too, so a caller can tell it from an approval", async () => {
    const secretKey = randomBytes(32);
    const deps: CliDependencies = {
      ...baseDeps(),
      intake: {
        journal: store,
        changeSets: createChangeSetsRegistry(),
        workUnits: createWorkUnitsRegistry(),
        envelopes: createAuthorizationEnvelopesRegistry(),
        intentContracts: createIntentContractsRegistry(),
        requirements: createRequirementsRegistry(),
        minter: new ApprovalTokenMinter({ secretKey }),
        secretKey,
        readIntakeRequest: async () => fixtureRequest({ ownedPaths: ["infra/secrets"] }),
        io: { input: new PassThrough(), output: new PassThrough() },
        loadPolicy: () => ({
          status: "loaded",
          policy: EnvelopePolicySchema.parse({
            maxWorkerTurnsPerAttempt: 40,
            schemaVersion: 1,
            id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
            createdAt: "2026-01-01T00:00:00.000Z",
            allowedPathPrefixes: ["src"],
          }),
          digest: "sha256:standing",
        }),
      },
    };

    const result = await dispatchCommand({ command: "run", json: true }, deps);
    expect(result.exitCode).toBe(EXIT_GENERAL_ERROR);
    const parsed = JSON.parse(result.stdout!) as { standing: { status: string; reason: string } };
    expect(parsed.standing.status).toBe("escalate");
    expect(parsed.standing.reason).toContain("infra/secrets");
  });
});
