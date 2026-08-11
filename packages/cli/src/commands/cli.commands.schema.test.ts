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
 * schema anywhere in `@crabgic/contracts`/`@crabgic/supervisor` — this phase owns
 * those shapes itself, so `../commands/cli.snapshots.test.ts`'s snapshot
 * stability is the correct (and only available) conformance mechanism for
 * them, not a gap.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createJournalStore, type JournalStore } from "@crabgic/journal";
import {
  buildSupervisorRouter,
  createArtifactIndexRegistry,
  createRequirementsRegistry,
  createAuthorizationEnvelopesRegistry,
  createChangeSetsRegistry,
  createRunsRegistry,
  createWorkUnitsRegistry,
  createWorkersRegistry,
  readPeerCredentialsLinux,
  RunCancelResultSchema,
  RunStatusResultSchema,
  startSupervisorServer,
  type SupervisorServer,
} from "@crabgic/supervisor";
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
    requirements: createRequirementsRegistry(),
    envelopes: createAuthorizationEnvelopesRegistry(),
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

  /**
   * Was NOT_IMPLEMENTED until 2026-07-25, when `registry.runs.list` was
   * added to 05's router — without it an operator who had not written a run
   * id down had no way to discover one.
   */
  it("status with no run-id lists every run over registry.runs.list — empty but valid on a fresh daemon", async () => {
    const result = await dispatchCommand({ command: "status", watch: false, json: true }, deps);
    expect(result.exitCode).toBe(EXIT_OK);
    expect(JSON.parse(result.stdout!)).toEqual({ runs: [] });
  });

  /**
   * `resume` was NOT_IMPLEMENTED until 2026-07-25. It now reaches the real
   * `run.dispatch` operation; this daemon is composed WITHOUT a run
   * dispatcher, so the refusal proves the command genuinely round-trips to
   * the supervisor rather than short-circuiting in the CLI.
   */
  it("resume reaches run.dispatch and surfaces the daemon's refusal reason", async () => {
    const result = await dispatchCommand(
      { command: "resume", runId: "11111111-1111-4111-8111-111111111111", json: true },
      deps,
    );
    expect(result.exitCode).not.toBe(EXIT_NOT_IMPLEMENTED);
    const parsed = JSON.parse(result.stdout!) as { accepted: boolean; reason?: string };
    expect(parsed.accepted).toBe(false);
    expect(parsed.reason).toMatch(/dispatcher/i);
  });

  it("status with no run-id renders a human-readable empty state in non-json mode", async () => {
    const result = await dispatchCommand({ command: "status", watch: false, json: false }, deps);
    expect(result.exitCode).toBe(EXIT_OK);
    // Glyph-signposted since 2026-08-11 (`docs/presentation-policy.md`): the
    // `info` role renders `•` in the monochrome `text` profile CLI stdout
    // resolves to when piped or captured.
    expect(result.stdout).toBe("• no runs\n");
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

  /**
   * The finding IDS, in order, as they appear ON THE `--json` SERIALIZATION
   * PATH — not a count. This used to be `expect(parsed.findings).toHaveLength(10)`,
   * which the phase-09 `--json`-snapshot defect names: a count cannot tell a
   * displaced check from a renamed one, and two of the last three merges
   * already moved that number.
   *
   * Deliberately NOT redundant with `../doctor/run-doctor.test.ts:17-31`,
   * which asserts the identical list against `buildDefaultDoctorChecks`'s
   * return value. That one pins the BUILDER; this one pins what a caller of
   * `dispatchCommand` actually reads out of `stdout` after
   * `runDoctorCommand` → `formatJson`. Measured, not assumed: reversing the
   * finding order inside `real-handlers.ts`'s own `--json` branch left the
   * whole `packages/cli` suite green (100 files / 1175 tests) before this
   * assertion existed, and reddens exactly this case after it.
   *
   * Order is the wiring order of `buildDefaultDoctorChecks`
   * (`../doctor/run-doctor.ts:90-135`); each id literal was read out of its
   * own check source, never copied from another test.
   */
  it("doctor --json: the finding id set is exactly the default check set, in wiring order", async () => {
    const result = await dispatchCommand(
      { command: "doctor", repairPlan: false, json: true },
      deps,
    );
    const parsed = JSON.parse(result.stdout!) as {
      findings: readonly { readonly id: string }[];
      allPassed: boolean;
    };
    expect(parsed.findings.map((f) => f.id)).toEqual([
      "engine.version",
      "sandbox.selftest",
      "hermeticity.selftest",
      "auth.probe",
      "git.plumbing",
      "xdg.permissions",
      "journal.chain",
      "journal.head-anchor",
      "journal.writer-separation",
      "wsl2.warnings",
    ]);
    expect(typeof parsed.allPassed).toBe("boolean");
  });

  it("help: renders the command table", async () => {
    const result = await dispatchCommand({ command: "help", json: false }, deps);
    expect(result.exitCode).toBe(EXIT_OK);
    // Grouped, answer-first table since 2026-08-11: the `Commands:` header is
    // now a lead stating the count, and `gateway`'s full usage string
    // (`gateway mcp`) moved to `help gateway`.
    expect(result.stdout).toMatch(/^\d+ commands\./);
    expect(result.stdout).toContain("gateway");
    expect(result.stdout).toContain("Connectors");
  });
});

describe("dispatchCommand — NOT_IMPLEMENTED stubs", () => {
  it.each([
    { command: "install", dryRun: false, json: true } as const,
    { command: "run", json: true } as const,
    { command: "approve", digest: "sha256:abc", json: true } as const,
    {
      command: "connection-add",
      provider: "jira",
      reference: { raw: "env:X" },
      baseUrl: "https://example.atlassian.net",
      allowedRedirectOrigins: ["https://example.atlassian.net"],
      allowedResources: [],
      allowedActions: [],
      discoveryTtlSeconds: 900,
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
