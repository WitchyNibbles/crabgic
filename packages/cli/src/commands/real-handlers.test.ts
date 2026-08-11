/**
 * Unit coverage for `./real-handlers.ts` branches not already exercised by
 * `./dispatch.test.ts`'s real-supervisor integration suite: `status
 * --watch`'s event-streaming loop, and `doctor`'s human-mode rendering of a
 * failing check plus `--repair-plan`.
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
  startSupervisorServer,
  type SupervisorServer,
} from "@crabgic/supervisor";
import { DEFAULT_PRESENTATION_POLICY, RUN_LIFECYCLE_STATES } from "@crabgic/contracts";
import { EXIT_DOCTOR_FINDINGS, EXIT_OK } from "../exit-codes.js";
import { connectUdsClient } from "../uds-client/client.js";
import type { CliDependencies } from "./types.js";
import {
  RUN_STATE_ROLES,
  renderDoctorReport,
  renderRunRecord,
  runDoctorCommand,
  runGlyphRole,
  runStatusCommand,
} from "./real-handlers.js";

/** A minimal run record — only the members the renderer reads. */
const RUN = {
  runId: "11111111-1111-4111-8111-111111111111",
  changeSetId: "22222222-2222-4222-8222-222222222222",
  runState: "running",
  updatedAt: "2026-08-11T00:00:00.000Z",
};

let root: string;
let journal: JournalStore;
let server: SupervisorServer | undefined;
let deps: CliDependencies;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "eo-cli-real-handlers-"));
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
    projectHash: "hash",
  };
});

afterEach(async () => {
  await server?.close();
  server = undefined;
  await rm(root, { recursive: true, force: true });
});

describe("runStatusCommand --watch", () => {
  it("emits the initial status line then resolves immediately given an already-aborted signal", async () => {
    const lines: string[] = [];
    const controller = new AbortController();
    controller.abort();
    const result = await runStatusCommand(
      {
        command: "status",
        runId: "11111111-1111-4111-8111-111111111111",
        watch: true,
        json: false,
      },
      deps,
      { watchSignal: controller.signal, emitLine: (line) => lines.push(line) },
    );
    expect(result.exitCode).toBe(EXIT_OK);
    expect(lines.length).toBeGreaterThanOrEqual(1);
    expect(lines[0]).toContain("unknown");
  });

  it("resolves once the signal aborts asynchronously, having emitted the initial line", async () => {
    const lines: string[] = [];
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 10);
    const result = await runStatusCommand(
      { command: "status", runId: "11111111-1111-4111-8111-111111111111", watch: true, json: true },
      deps,
      {
        watchSignal: controller.signal,
        emitLine: (line) => lines.push(line),
      },
    );
    expect(result.exitCode).toBe(EXIT_OK);
    expect(lines).toHaveLength(1);
    expect(JSON.parse(result.stdout!)).toEqual({});
  });
});

/**
 * The glyph a run's state gets is the whole reason the list is scannable, and
 * the first version of this mapping was written against state names that do not
 * exist (`succeeded`, `completed`, a `parked` prefix belonging to
 * `WorkUnitAttemptStatus`). Those were dead branches, and the real states fell
 * through a default to `running` — so a FINISHED run and a run WAITING ON THE
 * OWNER both rendered as in-flight.
 *
 * This is the same failure `stop-autonomy-gate.mjs` guards against with its own
 * partition test, and it gets the same guard: the map must cover
 * `RUN_LIFECYCLE_STATES` exactly, so adding a state to the contract without
 * classifying it here fails rather than silently rendering wrong.
 */
describe("run-state glyph mapping", () => {
  it("classifies every run lifecycle state, and invents none", () => {
    expect(Object.keys(RUN_STATE_ROLES).sort()).toEqual([...RUN_LIFECYCLE_STATES].sort());
  });

  it("does not report a finished or owner-blocked run as still running", () => {
    expect(RUN_STATE_ROLES.published_local).toBe("ok");
    expect(RUN_STATE_ROLES.awaiting_approval).toBe("blocked");
    expect(RUN_STATE_ROLES.blocked).toBe("blocked");
    expect(RUN_STATE_ROLES.failed).toBe("fail");
  });

  it("uses a verdict-free glyph for a state this build does not know", () => {
    // A confident wrong verdict about an unrecognised state is worse than none.
    expect(runGlyphRole("some_future_state")).toBe("info");
  });

  it("renders a finished run with the ok glyph end to end", () => {
    expect(renderRunRecord({ ...RUN, runState: "published_local" }, RUN.runId)).toMatch(/^✓ /);
    expect(renderRunRecord({ ...RUN, runState: "awaiting_approval" }, RUN.runId)).toMatch(/^⊘ /);
  });
});

describe("runDoctorCommand", () => {
  it("human mode renders a failing check with a ✗ marker and, with --repair-plan, an ordered repair plan", async () => {
    const result = await runDoctorCommand(
      { command: "doctor", repairPlan: true, json: false },
      { ...deps, resolveAuthState: () => Promise.resolve("missing") },
    );
    expect(result.exitCode).toBe(EXIT_DOCTOR_FINDINGS);
    expect(result.stdout).toContain("✗");
    expect(result.stdout).toContain("Repair plan");
  });

  it("human mode without --repair-plan omits the repair-plan section even when checks fail", async () => {
    const result = await runDoctorCommand(
      { command: "doctor", repairPlan: false, json: false },
      { ...deps, resolveAuthState: () => Promise.resolve("missing") },
    );
    expect(result.stdout).not.toContain("Repair plan");
  });

  it("--json with --repair-plan includes a repairPlan array", async () => {
    const result = await runDoctorCommand(
      { command: "doctor", repairPlan: true, json: true },
      { ...deps, resolveAuthState: () => Promise.resolve("missing") },
    );
    const parsed = JSON.parse(result.stdout!) as { repairPlan?: readonly string[] };
    expect(Array.isArray(parsed.repairPlan)).toBe(true);
  });

  /**
   * `doctor` was the product's largest human report and the one furthest from
   * the policy it is supposed to obey: ten findings, emitted as ten flat
   * `<glyph> [severity] id: evidence` lines with no lead, no headings and no
   * cap — an undifferentiated block, which `docs/presentation-policy.md` names
   * as the defect it exists to prevent ("a report that technically contains the
   * answer somewhere inside an undifferentiated block has not delivered it").
   *
   * The passing checks are the bulk of that block and carry no action, so they
   * collapse to a count. The failures — the only part that asks anything of the
   * reader — get the section.
   */
  describe("answer-first rendering (docs/presentation-policy.md)", () => {
    it("leads with the verdict, before any detail", async () => {
      const result = await runDoctorCommand(
        { command: "doctor", repairPlan: false, json: false },
        { ...deps, resolveAuthState: () => Promise.resolve("missing") },
      );
      const first = result.stdout!.split("\n")[0] ?? "";
      expect(first).toMatch(/^✗ \d+ of \d+ checks failed\.$/);
    });

    it("collapses the passing checks to a count instead of listing them", async () => {
      const result = await runDoctorCommand(
        { command: "doctor", repairPlan: false, json: false },
        { ...deps, resolveAuthState: () => Promise.resolve("missing") },
      );
      expect(result.stdout).toMatch(/\d+ of \d+ checks passed/);
      // The passing checks' own ids must not appear: they are the noise this
      // rendering exists to remove, and `--json` still carries every one.
      expect(result.stdout).not.toContain("git.plumbing");
    });

    it("heads the failures, so they are findable without reading the whole report", async () => {
      const result = await runDoctorCommand(
        { command: "doctor", repairPlan: false, json: false },
        { ...deps, resolveAuthState: () => Promise.resolve("missing") },
      );
      expect(result.stdout).toContain("Failed\n──────");
      expect(result.stdout).toContain("auth.probe");
    });

    /**
     * Driven through `renderDoctorReport` with a synthetic report rather than
     * through `runDoctorCommand`, deliberately. The first version of this test
     * ran the REAL doctor and bailed with `if (result.exitCode !== EXIT_OK)
     * return;` when the host had a failing check — which is every developer
     * host here, since the engine version sits outside the pinned range. It
     * therefore asserted nothing at all, on the one arm it existed to cover.
     */
    it("collapses a fully passing run to a single line", () => {
      const findings = Array.from({ length: 10 }, (_u, i) => ({
        id: `check.${String(i)}`,
        passed: true,
        severity: "error",
        evidence: "fine",
      }));
      const stdout = renderDoctorReport({ allPassed: true, findings }, undefined);
      expect(stdout.trimEnd().split("\n")).toHaveLength(1);
      expect(stdout).toBe("✓ all 10 checks passed.\n");
    });

    it("names the failing checks and no passing one, on a synthetic mixed report", () => {
      const stdout = renderDoctorReport(
        {
          allPassed: false,
          findings: [
            { id: "a.ok", passed: true, severity: "error", evidence: "fine" },
            { id: "b.bad", passed: false, severity: "error", evidence: "broken" },
          ],
        },
        undefined,
      );
      expect(stdout).toContain("b.bad");
      expect(stdout).not.toContain("a.ok");
      expect(stdout).toMatch(/^✗ 1 of 2 checks failed\./);
    });

    it("holds every human line within the policy's limits", async () => {
      const result = await runDoctorCommand(
        { command: "doctor", repairPlan: true, json: false },
        { ...deps, resolveAuthState: () => Promise.resolve("missing") },
      );
      for (const line of result.stdout!.split("\n")) {
        expect(line).toBe(line.replace(/\s+$/, ""));
        if (!line.startsWith("  • ")) continue;
        const words = line.slice(4).split(/\s+/).filter(Boolean);
        // `…` is the elision marker the renderer appends, not a content word.
        const content = words.filter((w) => w !== "…");
        expect(content.length).toBeLessThanOrEqual(
          DEFAULT_PRESENTATION_POLICY.limits.bulletMaxWords,
        );
      }
    });
  });
});

/**
 * `status <run-id>` reports PROGRESS, not just the run's lifecycle state.
 *
 * The state answers "is it going?"; an operator watching a multi-minute run
 * needs "how far has it got?", and the journal already held that. Wired here
 * rather than asserted only on the fold, because a pure function nothing calls
 * is the failure mode this repository has paid for before.
 */
describe("runStatusCommand — work-unit progress", () => {
  function depsWith(entries: readonly unknown[]): CliDependencies {
    return {
      projectHash: "test-hash",
      connectClient: () =>
        Promise.resolve({
          request: () =>
            Promise.resolve({
              run: {
                runId: "run-1",
                changeSetId: "cs-1",
                runState: "running",
                updatedAt: "2026-01-01T00:00:00.000Z",
              },
            }),
          close: () => Promise.resolve(),
          onEvent: () => () => undefined,
        } as never),
      journal: {
        queryEntries: (() =>
          (async function* () {
            for (const entry of entries) yield entry;
          })()) as never,
        verifyJournal: (() => Promise.resolve({ ok: true, entries: 0 })) as never,
      },
    } as CliDependencies;
  }

  const transition = (workUnitId: string, status: string): unknown => ({
    type: "work_unit_transition",
    workUnitId,
    payload: { status },
  });

  it("renders a progress line under the run line", async () => {
    const result = await runStatusCommand(
      { command: "status", runId: "run-1", watch: false, json: false },
      depsWith([
        transition("wu-1", "succeeded"),
        transition("wu-2", "dispatched"),
        transition("wu-3", "failed"),
      ]),
    );

    expect(result.stdout).toContain("run run-1: running");
    expect(result.stdout).toContain("work units seen:");
    expect(result.stdout).toContain("1 succeeded");
    expect(result.stdout).toContain("1 running");
    expect(result.stdout).toContain("1 failed");
  });

  it("says nothing extra when the journal has seen no work units", async () => {
    const result = await runStatusCommand(
      { command: "status", runId: "run-1", watch: false, json: false },
      depsWith([]),
    );
    expect(result.stdout).toContain("run run-1: running");
    // "0 of 0" implies a denominator this cannot know; silence is honest.
    expect(result.stdout).not.toContain("work units seen");
  });

  it("leaves --json exactly as 05 published it, because that shape is a contract", async () => {
    // `./cli.commands.schema.test.ts` validates this output against the REAL
    // `RunStatusResultSchema`, which is `.strict()`: the CLI's status JSON "IS
    // literally 05's own published result, never re-shaped". Widening it is a
    // cross-phase interface decision the ledger governs, so a rendering
    // improvement must not smuggle a key in — and this pins that.
    const result = await runStatusCommand(
      { command: "status", runId: "run-1", watch: false, json: true },
      depsWith([transition("wu-1", "succeeded"), transition("wu-2", "failed")]),
    );

    const parsed = JSON.parse(result.stdout!) as Record<string, unknown>;
    expect(Object.keys(parsed)).toEqual(["run"]);
    expect(parsed).not.toHaveProperty("progress");
  });
});
