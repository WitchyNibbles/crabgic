/**
 * roadmap/09-cli-and-doctor.md exit criterion, suite `cli.commands.schema.test`:
 * "Every plan CLI command exists as a typed UDS request with stable exit
 * codes; `--json` validates against published schemas." §Test plan,
 * Integration: "failing-first command-level integration against a real
 * supervisor (05) in tmp dirs, covering every command's happy path and its
 * `NOT_IMPLEMENTED` shape where no backend is wired yet." (Renamed
 * 2026-07-24 from `dispatch.test.ts` to this exact spec suite name —
 * adversarial-review finding #7.)
 *
 * "Published schemas" — this phase's own `status`/`cancel` `--json` output
 * IS literally `05`'s own published `RunStatusResultSchema`/
 * `RunCancelResultSchema` (the raw UDS result, never re-shaped), so those
 * two are validated for real against the zod schemas below, not merely
 * snapshotted. `evidence`/`doctor`/`NOT_IMPLEMENTED` have no published
 * schema anywhere in `@eo/contracts`/`@eo/supervisor` — this phase owns
 * those shapes itself, so `../commands/cli.snapshots.test.ts`'s snapshot
 * stability is the correct (and only available) conformance mechanism for
 * them, not a gap.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createJournalStore, type JournalStore } from "@eo/journal";
import {
  buildSupervisorRouter,
  createArtifactIndexRegistry,
  createChangeSetsRegistry,
  createRunsRegistry,
  createWorkUnitsRegistry,
  createWorkersRegistry,
  readPeerCredentialsLinux,
  RunCancelResultSchema,
  RunStatusResultSchema,
  startSupervisorServer,
  type SupervisorServer,
} from "@eo/supervisor";
import { EXIT_NOT_IMPLEMENTED, EXIT_OK, EXIT_SUPERVISOR_UNAVAILABLE } from "../exit-codes.js";
import { SupervisorUnavailableError } from "../errors.js";
import { connectUdsClient } from "../uds-client/client.js";
import { dispatchCommand } from "./dispatch.js";
import type { CliDependencies } from "./types.js";

let root: string;
let journal: JournalStore;
let server: SupervisorServer | undefined;
let deps: CliDependencies;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "eo-cli-dispatch-"));
  journal = createJournalStore({ journalDir: join(root, "journal") });

  const router = buildSupervisorRouter({
    journal,
    runs: createRunsRegistry(),
    changeSets: createChangeSetsRegistry(),
    workUnits: createWorkUnitsRegistry(),
    workers: createWorkersRegistry(),
    artifactIndex: createArtifactIndexRegistry(),
    liveWorkers: new Map(),
  });
  const runtimeDir = join(root, "run");
  const socketPath = join(runtimeDir, "control.sock");
  server = await startSupervisorServer({
    runtimeDir,
    socketPath,
    router,
    peerAuth: { reader: readPeerCredentialsLinux },
  });

  deps = {
    connectClient: () => connectUdsClient({ socketPath }),
    journal,
    projectHash: "test-project-hash",
    resolveAuthState: () => Promise.resolve("valid"),
  };
});

afterEach(async () => {
  await server?.close();
  server = undefined;
  await rm(root, { recursive: true, force: true });
});

describe("dispatchCommand — --json validates against 05's PUBLISHED schemas (adversarial-review fix, 2026-07-24, finding #7)", () => {
  it("status <run-id> --json is real, published-schema-valid RunStatusResultSchema output, not merely snapshot-stable", async () => {
    const result = await dispatchCommand(
      {
        command: "status",
        runId: "11111111-1111-4111-8111-111111111111",
        watch: false,
        json: true,
      },
      deps,
    );
    expect(result.exitCode).toBe(EXIT_OK);
    expect(() => RunStatusResultSchema.parse(JSON.parse(result.stdout!))).not.toThrow();
  });

  it("cancel <target-id> --json is real, published-schema-valid RunCancelResultSchema output", async () => {
    const result = await dispatchCommand(
      { command: "cancel", targetId: "11111111-1111-4111-8111-111111111111", json: true },
      deps,
    );
    expect(result.exitCode).toBe(EXIT_OK);
    expect(() => RunCancelResultSchema.parse(JSON.parse(result.stdout!))).not.toThrow();
  });
});

describe("dispatchCommand — real backends", () => {
  it("status <run-id>: unknown run renders gracefully, exit OK", async () => {
    const result = await dispatchCommand(
      {
        command: "status",
        runId: "11111111-1111-4111-8111-111111111111",
        watch: false,
        json: false,
      },
      deps,
    );
    expect(result.exitCode).toBe(EXIT_OK);
    expect(result.stdout).toContain("unknown");
  });

  it("status with no run-id: NOT_IMPLEMENTED (no registry.runs.list op wired yet)", async () => {
    const result = await dispatchCommand({ command: "status", watch: false, json: true }, deps);
    expect(result.exitCode).toBe(EXIT_NOT_IMPLEMENTED);
    expect(JSON.parse(result.stdout!)).toMatchObject({ status: "NOT_IMPLEMENTED" });
  });

  it("cancel: an unknown run is reported as not-accepted, exit OK, --json shape", async () => {
    const result = await dispatchCommand(
      { command: "cancel", targetId: "11111111-1111-4111-8111-111111111111", json: true },
      deps,
    );
    expect(result.exitCode).toBe(EXIT_OK);
    expect(JSON.parse(result.stdout!)).toEqual({ accepted: false });
  });

  it("evidence: a fresh ChangeSet with zero records returns an empty-but-valid report, exit OK", async () => {
    const result = await dispatchCommand(
      { command: "evidence", changeSetId: "22222222-2222-4222-8222-222222222222", json: true },
      deps,
    );
    expect(result.exitCode).toBe(EXIT_OK);
    expect(JSON.parse(result.stdout!)).toEqual({
      changeSetId: "22222222-2222-4222-8222-222222222222",
      records: [],
    });
  });

  it("doctor --json: returns a well-formed report", async () => {
    const result = await dispatchCommand(
      { command: "doctor", repairPlan: false, json: true },
      deps,
    );
    const parsed = JSON.parse(result.stdout!) as {
      findings: readonly unknown[];
      allPassed: boolean;
    };
    expect(parsed.findings).toHaveLength(8);
    expect(typeof parsed.allPassed).toBe("boolean");
  });

  it("help: renders the command table", async () => {
    const result = await dispatchCommand({ command: "help", json: false }, deps);
    expect(result.exitCode).toBe(EXIT_OK);
    expect(result.stdout).toContain("Commands:");
    expect(result.stdout).toContain("gateway mcp");
  });
});

describe("dispatchCommand — NOT_IMPLEMENTED stubs", () => {
  it.each([
    { command: "install", dryRun: false, json: true } as const,
    { command: "run", json: true } as const,
    { command: "resume", runId: "run-1", json: true } as const,
    {
      command: "connection-add",
      provider: "jira",
      reference: { raw: "env:X" },
      json: true,
    } as const,
    { command: "connection-list", json: true } as const,
    { command: "connection-doctor", connectionId: "c-1", json: true } as const,
    { command: "connection-capabilities", connectionId: "c-1", json: true } as const,
    { command: "trust-review", json: true } as const,
    { command: "trust-approve", digest: "abc", json: true } as const,
    { command: "trust-revoke", tokenId: "t-1", json: true } as const,
    { command: "learn-list", json: true } as const,
    { command: "learn-approve", proposalId: "p-1", json: true } as const,
    { command: "learn-reject", proposalId: "p-1", json: true } as const,
    { command: "learn-rollback", proposalId: "p-1", json: true } as const,
    { command: "upgrade", dryRun: false, json: true } as const,
    { command: "uninstall", keepState: false, json: true } as const,
  ])("$command returns the typed NOT_IMPLEMENTED shape", async (command) => {
    const result = await dispatchCommand(command, deps);
    expect(result.exitCode).toBe(EXIT_NOT_IMPLEMENTED);
    const parsed = JSON.parse(result.stdout!) as { status: string; command: string };
    expect(parsed.status).toBe("NOT_IMPLEMENTED");
    expect(parsed.command).toBe(command.command);
  });

  it("NOT_IMPLEMENTED never crashes and never echoes internal errors — human (non-json) mode also works", async () => {
    const result = await dispatchCommand({ command: "upgrade", dryRun: true, json: false }, deps);
    expect(result.exitCode).toBe(EXIT_NOT_IMPLEMENTED);
    expect(result.stdout).toContain("upgrade");
  });
});

describe("dispatchCommand — supervisor unavailable", () => {
  it("maps SupervisorUnavailableError to a stable exit code and stderr diagnostic", async () => {
    const brokenDeps: CliDependencies = {
      ...deps,
      connectClient: () => {
        throw new SupervisorUnavailableError("simulated: no such socket");
      },
    };
    const result = await dispatchCommand(
      {
        command: "status",
        runId: "11111111-1111-4111-8111-111111111111",
        watch: false,
        json: false,
      },
      brokenDeps,
    );
    expect(result.exitCode).toBe(EXIT_SUPERVISOR_UNAVAILABLE);
    expect(result.stderr).toContain("simulated");
    expect(result.stdout).toBeUndefined();
  });
});
