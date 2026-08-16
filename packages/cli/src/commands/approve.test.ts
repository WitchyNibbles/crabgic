/**
 * `approve <digest>` — the terminal half of ledger Gap 18's escalation path,
 * and the real command the `/eo:approve` skill delegates to (it referenced a
 * command that did not exist from 1.0.0 through 1.4.0). The security shape
 * under test: human-only (interactive-terminal gate), server-side digest →
 * ChangeSet resolution, in-process mint → verify (no token ever rendered).
 */
import { randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createJournalStore, type JournalStore } from "@crabgic/journal";
import {
  createAuthorizationEnvelopesRegistry,
  createChangeSetsRegistry,
  createIntentContractsRegistry,
  createRequirementsRegistry,
  createWorkUnitsRegistry,
} from "@crabgic/supervisor";
import { buildAuthorizationEnvelope, buildChangeSet, buildIntentContract } from "@crabgic/testkit";
import { EXIT_GENERAL_ERROR, EXIT_OK, EXIT_USAGE_ERROR } from "../exit-codes.js";
import { ApprovalTokenMinter } from "../approval/token.js";
import { dispatchCommand } from "./dispatch.js";
import type { CliDependencies, IntakeDependencies } from "./types.js";
import type { StageCompletionRecord } from "@crabgic/contracts";
/**
 * A closed `design-gate` — owner ruling R8.
 *
 * These suites assert what the approval commands do once the gate is behind
 * them; the refusal has its own suite in
 * `packages/supervisor/src/intake/readiness-gate.test.ts`. Keyed to the
 * ChangeSet actually under test, so it is a real pass rather than a blanket one.
 */
function designGateClosed(changeSetId: string): StageCompletionRecord[] {
  return [
    {
      schemaVersion: 1,
      changeSetId,
      stage: "design-gate",
      round: 1,
      artifactRef: "design-record:test",
      closedAt: "2026-08-16T00:00:00.000Z",
    },
  ];
}

const secretKey = randomBytes(32);

let journalDir: string;
let store: JournalStore;

beforeEach(async () => {
  journalDir = await mkdtemp(join(tmpdir(), "eo-cli-approve-command-"));
  store = createJournalStore({ journalDir });
});

afterEach(async () => {
  await rm(journalDir, { recursive: true, force: true });
});

/** Records supervisor ops and answers `run.dispatch` with a minted run id. */
function recordingClient(): {
  readonly calls: string[];
  readonly connectClient: CliDependencies["connectClient"];
} {
  const calls: string[] = [];
  return {
    calls,
    connectClient: () =>
      Promise.resolve({
        request: (op: string) => {
          calls.push(op);
          return Promise.resolve({ accepted: true, runId: "55555555-5555-4555-8555-555555555555" });
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

interface SeededIntake {
  readonly intake: IntakeDependencies;
  readonly input: PassThrough;
  readonly changeSetId: string;
}

/** Seeds one ChangeSet awaiting approval whose stored envelope carries `digest`, with a resolvable contract — the state `approve` exists to act on. */
function seededIntake(
  digest: string,
  options: {
    readonly interactive?: boolean;
    readonly state?: "awaiting_approval" | "ready";
    readonly envelope?: Partial<Parameters<typeof buildAuthorizationEnvelope>[0]>;
  } = {},
): SeededIntake {
  const changeSets = createChangeSetsRegistry();
  const envelopes = createAuthorizationEnvelopesRegistry();
  const intentContracts = createIntentContractsRegistry();
  const requirements = createRequirementsRegistry();
  const workUnits = createWorkUnitsRegistry();

  const envelope = buildAuthorizationEnvelope({
    id: randomUUID(),
    canonicalHash: digest,
    ...(options.envelope ?? {}),
  });
  envelopes.put(envelope);
  const contract = buildIntentContract({ id: randomUUID(), requirementIds: [] });
  intentContracts.put(contract);
  const changeSet = buildChangeSet({
    id: randomUUID(),
    state: options.state ?? "awaiting_approval",
    authorizationEnvelopeId: envelope.id,
    intentContractId: contract.id,
  });
  changeSets.put(changeSet);

  const input = new PassThrough();
  return {
    input,
    changeSetId: changeSet.id,
    intake: {
      // R8: post-gate behaviour; the gate has its own suite in readiness-gate.test.ts.
      loadStageCompletions: () =>
        Promise.resolve(changeSets.list().flatMap((cs) => designGateClosed(cs.id))),
      journal: store,
      changeSets,
      workUnits,
      envelopes,
      intentContracts,
      requirements,
      minter: new ApprovalTokenMinter({ secretKey }),
      secretKey,
      readIntakeRequest: () => {
        throw new Error("approve never reads an intake request");
      },
      loadPolicy: () => {
        throw new Error("approve never reads the standing policy");
      },
      io: { input, output: new PassThrough() },
      resolveTerminal: () =>
        (options.interactive ?? true)
          ? { allowed: true }
          : { allowed: false, reason: "no interactive terminal (test fixture)" },
    },
  };
}

describe("dispatchCommand — approve", () => {
  it("returns typed NOT_IMPLEMENTED when deps.intake is absent (roadmap/09 default)", async () => {
    const result = await dispatchCommand(
      { command: "approve", digest: "sha256:x", json: true },
      baseDeps() as CliDependencies,
    );
    const parsed = JSON.parse(result.stdout!) as { status: string };
    expect(parsed.status).toBe("NOT_IMPLEMENTED");
  });

  it("refuses to prompt without an interactive terminal — the scripted non-interactive path stays closed", async () => {
    const digest = "sha256:approve-no-tty";
    const seeded = seededIntake(digest, { interactive: false });
    let prompted = false;
    (seeded.intake.io!.output as PassThrough).on("data", () => {
      prompted = true;
    });

    const result = await dispatchCommand({ command: "approve", digest, json: false }, {
      ...baseDeps(),
      intake: seeded.intake,
    } as CliDependencies);

    expect(result.exitCode).toBe(EXIT_USAGE_ERROR);
    expect(result.stderr).toContain("refused");
    expect(result.stderr).toContain("no interactive terminal");
    expect(prompted).toBe(false);
    expect(seeded.intake.changeSets.get(seeded.changeSetId)?.state).toBe("awaiting_approval");
  });

  it("errors when no pending ChangeSet carries the digest", async () => {
    const seeded = seededIntake("sha256:some-other-digest");
    const result = await dispatchCommand(
      { command: "approve", digest: "sha256:absent", json: false },
      { ...baseDeps(), intake: seeded.intake } as CliDependencies,
    );
    expect(result.exitCode).toBe(EXIT_GENERAL_ERROR);
    expect(result.stderr).toContain("no ChangeSet awaiting approval");
  });

  it("treats an already-ready ChangeSet as not pending", async () => {
    const digest = "sha256:approve-already-ready";
    const seeded = seededIntake(digest, { state: "ready" });
    const result = await dispatchCommand({ command: "approve", digest, json: false }, {
      ...baseDeps(),
      intake: seeded.intake,
    } as CliDependencies);
    expect(result.exitCode).toBe(EXIT_GENERAL_ERROR);
    expect(result.stderr).toContain("no ChangeSet awaiting approval");
  });

  it("refuses an ambiguous digest shared by two pending ChangeSets, naming both", async () => {
    const digest = "sha256:approve-ambiguous";
    const seeded = seededIntake(digest);
    // A second pending ChangeSet with its own envelope carrying the SAME digest.
    const envelope2 = buildAuthorizationEnvelope({ id: randomUUID(), canonicalHash: digest });
    seeded.intake.envelopes.put(envelope2);
    const second = buildChangeSet({
      id: randomUUID(),
      state: "awaiting_approval",
      authorizationEnvelopeId: envelope2.id,
      intentContractId: randomUUID(),
    });
    seeded.intake.changeSets.put(second);

    const result = await dispatchCommand({ command: "approve", digest, json: false }, {
      ...baseDeps(),
      intake: seeded.intake,
    } as CliDependencies);
    expect(result.exitCode).toBe(EXIT_GENERAL_ERROR);
    expect(result.stderr).toContain("ambiguous digest");
    expect(result.stderr).toContain(seeded.changeSetId);
    expect(result.stderr).toContain(second.id);
  });

  it("declines cleanly on anything but 'yes' — the ChangeSet stays awaiting_approval", async () => {
    const digest = "sha256:approve-decline";
    const seeded = seededIntake(digest);

    const resultPromise = dispatchCommand({ command: "approve", digest, json: false }, {
      ...baseDeps(),
      intake: seeded.intake,
    } as CliDependencies);
    seeded.input.write("no\n");
    const result = await resultPromise;

    expect(result.exitCode).toBe(EXIT_OK);
    expect(result.stdout).toContain("approval declined");
    expect(seeded.intake.changeSets.get(seeded.changeSetId)?.state).toBe("awaiting_approval");
  });

  it("approves on 'yes': mint and verification complete in-process, the ChangeSet reaches ready, and no token is ever rendered", async () => {
    const digest = "sha256:approve-happy";
    const seeded = seededIntake(digest);

    const supervisor = recordingClient();
    const resultPromise = dispatchCommand({ command: "approve", digest, json: true }, {
      ...baseDeps(),
      connectClient: supervisor.connectClient,
      intake: seeded.intake,
    } as CliDependencies);
    seeded.input.write("yes\n");
    const result = await resultPromise;

    expect(result.exitCode).toBe(EXIT_OK);
    const parsed = JSON.parse(result.stdout!) as {
      approved: boolean;
      changeSetId: string;
      state: string;
      dispatch: { accepted: boolean; runId?: string };
    };
    expect(parsed.approved).toBe(true);
    expect(parsed.changeSetId).toBe(seeded.changeSetId);
    expect(parsed.state).toBe("ready");
    // `approve` finishes the job it interrupted: the human authorized the
    // work, so the work starts -- no second command to look up.
    expect(parsed.dispatch.accepted).toBe(true);
    expect(supervisor.calls).toEqual(["run.dispatch"]);
    expect(seeded.intake.changeSets.get(seeded.changeSetId)?.state).toBe("ready");
    expect(result.stdout).not.toContain('"token"');
  });

  it("on a dispatch REFUSAL, says consent grants no authority and points at the policy edit", async () => {
    // Review S5 (2026-07-30): approve completes the awaiting_approval → ready
    // consent, but the daemon's containment-only gate can still refuse an
    // out-of-policy envelope at dispatch. The refusal output must not leave
    // the owner thinking a re-approval would help — it must name the working
    // remedy (edit the policy) and say approval grants no authority.
    const digest = "sha256:approve-refused";
    const seeded = seededIntake(digest);
    const refusingClient: CliDependencies["connectClient"] = () =>
      Promise.resolve({
        request: () =>
          Promise.resolve({
            accepted: false,
            reason:
              "this change set needs authority the standing policy does not grant: " +
              'owned path "infra/secrets" is not at or below any allowed path prefix',
          }),
        close: () => Promise.resolve(),
      } as never);

    const resultPromise = dispatchCommand({ command: "approve", digest, json: false }, {
      ...baseDeps(),
      connectClient: refusingClient,
      intake: seeded.intake,
    } as CliDependencies);
    seeded.input.write("yes\n");
    const result = await resultPromise;

    expect(result.exitCode).toBe(EXIT_GENERAL_ERROR);
    expect(result.stderr).toContain("approved and ready, but dispatch was refused");
    expect(result.stderr).toContain("infra/secrets");
    // The load-bearing correction: consent ≠ authority, edit the policy.
    expect(result.stderr).toContain("cannot grant authority");
    expect(result.stderr).toMatch(/edit the standing policy/i);
    // Consent still landed: the ChangeSet is durably `ready`, not lost.
    expect(seeded.intake.changeSets.get(seeded.changeSetId)?.state).toBe("ready");
  });

  // MAJOR (adversarial review, 2026-07-29): `canonicalHash` identifies envelope
  // CONTENT and excludes the ChangeSet id, so a bare digest is an opaque string
  // the human cannot evaluate — they would be consenting to whatever a model
  // told them it meant. The authority itself must be on screen.
  it("renders the granted authority — change set, paths, commands, network, credentials — before the digest prompt", async () => {
    const digest = "sha256:approve-consent";
    const seeded = seededIntake(digest, {
      envelope: {
        ownedPaths: ["src/login"],
        commands: ["npm test"],
        networkDestinations: ["https://registry.npmjs.org"],
        credentialReferences: ["env:JIRA_TOKEN"],
      },
    });
    const rendered: string[] = [];
    (seeded.intake.io!.output as PassThrough).on("data", (chunk: Buffer) =>
      rendered.push(chunk.toString("utf8")),
    );

    const resultPromise = dispatchCommand({ command: "approve", digest, json: true }, {
      ...baseDeps(),
      intake: seeded.intake,
    } as CliDependencies);
    seeded.input.write("yes\n");
    await resultPromise;

    const screen = rendered.join("");
    expect(screen).toContain(seeded.changeSetId);
    expect(screen).toContain("src/login");
    expect(screen).toContain("npm test");
    expect(screen).toContain("https://registry.npmjs.org");
    expect(screen).toContain("env:JIRA_TOKEN");
    // An empty grant is stated, never omitted — silence would read the same
    // as "nothing", and they are different facts.
    expect(screen).toContain("(none)");
    // The digest still appears; it is now the second thing, not the only thing.
    expect(screen).toContain(digest);
  });

  it("strips terminal control sequences from an attacker-supplied digest before echoing it", async () => {
    const seeded = seededIntake("sha256:unrelated");
    const hostileDigest = `sha256:${String.fromCharCode(0x1b)}[2Jwiped`;

    const result = await dispatchCommand(
      { command: "approve", digest: hostileDigest, json: false },
      {
        ...baseDeps(),
        intake: seeded.intake,
      } as CliDependencies,
    );

    expect(result.exitCode).toBe(EXIT_GENERAL_ERROR);
    expect(result.stderr).not.toContain(String.fromCharCode(0x1b));
    expect(result.stderr).toContain("wiped");
  });

  it("surfaces a verification refusal as a failure, not a silent success", async () => {
    const digest = "sha256:approve-refused";
    const seeded = seededIntake(digest);
    // Break the contract resolution AFTER seeding: a ChangeSet whose contract
    // vanished must refuse, with the reason shown.
    const brokenIntake: IntakeDependencies = {
      ...seeded.intake,
      intentContracts: createIntentContractsRegistry(),
      requirements: createRequirementsRegistry(),
    };

    const resultPromise = dispatchCommand({ command: "approve", digest, json: false }, {
      ...baseDeps(),
      intake: brokenIntake,
    } as CliDependencies);
    seeded.input.write("yes\n");
    const result = await resultPromise;

    expect(result.exitCode).toBe(EXIT_GENERAL_ERROR);
    expect(result.stderr).toContain("no resolvable IntentContract");
    expect(seeded.intake.changeSets.get(seeded.changeSetId)?.state).toBe("awaiting_approval");
  });
});
