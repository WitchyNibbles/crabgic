import { EXIT_NOT_IMPLEMENTED, EXIT_OK, type CliDependencies } from "engineering-orchestrator";
import { describe, expect, it } from "vitest";
import {
  checkProductionDependencyWiring,
  combineFindings,
  SWEEP_COMMAND_PROBES,
  sweepDispatchLevelNotImplemented,
  unusedDeps,
  type ProductionDependencyWiring,
  type SweepFinding,
} from "./cliNotImplementedSweep.js";

describe("sweepDispatchLevelNotImplemented — genuine integration (real dispatchCommand, real packages/cli)", () => {
  it("finds every dispatch-level NOT_IMPLEMENTED command among the 18 probes, absent any optional dependency", async () => {
    const findings = await sweepDispatchLevelNotImplemented();
    const commands = findings.map((f) => f.command).sort();
    expect(commands).toEqual(
      [
        "resume",
        "connection-add",
        "connection-list",
        "connection-doctor",
        "connection-capabilities",
        "trust-review",
        "trust-approve",
        "trust-revoke",
        "run",
        "learn-list",
        "learn-approve",
        "learn-reject",
        "learn-rollback",
        "status",
        "gateway-mcp",
        "install",
        "upgrade",
        "uninstall",
      ].sort(),
    );
    expect(findings.every((f) => f.exitCode === EXIT_NOT_IMPLEMENTED)).toBe(true);
  });

  it("SWEEP_COMMAND_PROBES covers exactly the 18 command variants this sweep is designed to probe", () => {
    expect(SWEEP_COMMAND_PROBES).toHaveLength(18);
    expect(new Set(SWEEP_COMMAND_PROBES.map((p) => p.command)).size).toBe(18);
  });

  it("a hand-built deps bag that never reaches connectClient/journal proves the probe set never touches either seam", async () => {
    let connectClientCalled = false;
    const deps: CliDependencies = {
      connectClient: async () => {
        connectClientCalled = true;
        throw new Error("should never be called for a stub command");
      },
      journal: {
        queryEntries: async function* () {},
        verifyJournal: async () => {
          throw new Error("should never be called for a stub command");
        },
      },
      projectHash: "test",
    };
    await sweepDispatchLevelNotImplemented(SWEEP_COMMAND_PROBES, deps);
    expect(connectClientCalled).toBe(false);
  });
});

describe("checkProductionDependencyWiring — genuine integration (real buildRealCliDependencies)", () => {
  it("reflects today's real production wiring: installer IS wired, intake/learning are NOT", () => {
    const wiring = checkProductionDependencyWiring();
    expect(wiring.installerWired).toBe(true);
    expect(wiring.intakeWired).toBe(false);
    expect(wiring.learningWired).toBe(false);
  });
});

describe("combineFindings", () => {
  const allDispatchLevelFindings: readonly SweepFinding[] = [
    { command: "resume", exitCode: EXIT_NOT_IMPLEMENTED, detail: "" },
    { command: "gateway-mcp", exitCode: EXIT_NOT_IMPLEMENTED, detail: "" },
    { command: "install", exitCode: EXIT_NOT_IMPLEMENTED, detail: "" },
    { command: "run", exitCode: EXIT_NOT_IMPLEMENTED, detail: "" },
  ];

  it("marks an unconditional stub (no gating dependency) as a real gap", () => {
    const wiring: ProductionDependencyWiring = {
      installerWired: true,
      intakeWired: true,
      learningWired: true,
    };
    const [resume] = combineFindings(
      allDispatchLevelFindings.filter((f) => f.command === "resume"),
      wiring,
    );
    expect(resume?.realGapInProduction).toBe(true);
  });

  it("marks the gateway-mcp dead branch as NOT a real gap regardless of wiring", () => {
    const wiring: ProductionDependencyWiring = {
      installerWired: false,
      intakeWired: false,
      learningWired: false,
    };
    const [gatewayMcp] = combineFindings(
      allDispatchLevelFindings.filter((f) => f.command === "gateway-mcp"),
      wiring,
    );
    expect(gatewayMcp?.realGapInProduction).toBe(false);
  });

  it("marks a dependency-gated command as NOT a real gap when its dependency IS wired", () => {
    const wiring: ProductionDependencyWiring = {
      installerWired: true,
      intakeWired: false,
      learningWired: false,
    };
    const [install] = combineFindings(
      allDispatchLevelFindings.filter((f) => f.command === "install"),
      wiring,
    );
    expect(install?.realGapInProduction).toBe(false);
  });

  it("marks a dependency-gated command as a real gap when its dependency is NOT wired (run/intake today)", () => {
    const wiring: ProductionDependencyWiring = {
      installerWired: true,
      intakeWired: false,
      learningWired: false,
    };
    const [run] = combineFindings(
      allDispatchLevelFindings.filter((f) => f.command === "run"),
      wiring,
    );
    expect(run?.realGapInProduction).toBe(true);
  });

  it("genuine integration: folding today's real dispatch-level findings with today's real production wiring yields exactly the accurate gap list", async () => {
    const dispatchLevel = await sweepDispatchLevelNotImplemented();
    const wiring = checkProductionDependencyWiring();
    const combined = combineFindings(dispatchLevel, wiring);

    const realGaps = combined
      .filter((f) => f.realGapInProduction)
      .map((f) => f.command)
      .sort();
    const notRealGaps = combined
      .filter((f) => !f.realGapInProduction)
      .map((f) => f.command)
      .sort();

    // installer-backed commands are genuinely wired in production today.
    expect(notRealGaps).toEqual(["gateway-mcp", "install", "upgrade", "uninstall"].sort());
    // Everything else — including run/learn-* despite their real backends
    // existing — is a genuine, currently-shipped NOT_IMPLEMENTED gap.
    expect(realGaps).toEqual(
      [
        "resume",
        "connection-add",
        "connection-list",
        "connection-doctor",
        "connection-capabilities",
        "trust-review",
        "trust-approve",
        "trust-revoke",
        "run",
        "learn-list",
        "learn-approve",
        "learn-reject",
        "learn-rollback",
        "status",
      ].sort(),
    );
  });
});

describe("unusedDeps — the never-invoked defensive stub deps.ts's own probe list relies on", () => {
  it("connectClient throws SupervisorUnavailableError if ever actually called", async () => {
    await expect(unusedDeps().connectClient()).rejects.toThrow(
      "cliNotImplementedSweep never expects a stub command to reach the supervisor",
    );
  });

  it("journal.queryEntries throws if ever actually iterated", async () => {
    const iterate = async () => {
      for await (const _entry of unusedDeps().journal.queryEntries()) {
        // unreachable
      }
    };
    await expect(iterate()).rejects.toThrow(
      "cliNotImplementedSweep never expects a stub command to reach the journal",
    );
  });

  it("journal.verifyJournal throws if ever actually called", async () => {
    await expect(unusedDeps().journal.verifyJournal()).rejects.toThrow(
      "cliNotImplementedSweep never expects a stub command to reach the journal",
    );
  });
});

// Sanity: EXIT_OK is imported only to prove it is distinct from
// EXIT_NOT_IMPLEMENTED — guards against a future exit-code renumbering
// silently making every check in this file vacuously true.
describe("exit code sanity", () => {
  it("EXIT_NOT_IMPLEMENTED is distinct from EXIT_OK", () => {
    expect(EXIT_NOT_IMPLEMENTED).not.toBe(EXIT_OK);
  });
});
