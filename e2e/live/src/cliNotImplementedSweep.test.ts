import {
  EXIT_NOT_IMPLEMENTED,
  EXIT_OK,
  SupervisorUnavailableError,
  type CliDependencies,
} from "crabgic";
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
  /**
   * DISPATCH-LEVEL, absent every optional dependency — deliberately not the
   * same question as "what is broken in the shipped binary": a command with
   * a real conditional branch shows up here and is then resolved against
   * real production wiring by `combineFindings`.
   *
   * `resume` and `status` left this list when they became unconditional
   * (both need only the UDS client). `gateway-mcp` stays: `cli-entry.ts`
   * still intercepts it before `dispatchCommand`, so its branch remains
   * structurally unreachable dead code rather than a gap.
   */
  it("finds every dispatch-level NOT_IMPLEMENTED command among the 18 probes, absent any optional dependency", async () => {
    const findings = await sweepDispatchLevelNotImplemented();
    const commands = findings.map((f) => f.command).sort();
    expect(commands).toEqual(
      [
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

  /**
   * The sweep used to assert it NEVER reached `connectClient`, which held
   * only while every supervisor-backed command was a stub. `resume` and
   * `status` are now unconditional, so the probe set does reach that seam
   * — and the property that actually matters is unchanged and asserted
   * here instead: a throwing/offline supervisor seam must never turn into a
   * NOT_IMPLEMENTED finding. A command that fails because no daemon is
   * running is not an unimplemented command, and conflating the two would
   * make this whole audit report phantom gaps on any machine without a
   * live supervisor.
   */
  it("never mistakes an unreachable supervisor for an unimplemented command", async () => {
    let connectClientCalled = false;
    const deps: CliDependencies = {
      connectClient: async () => {
        connectClientCalled = true;
        throw new SupervisorUnavailableError("no daemon in this test");
      },
      journal: {
        queryEntries: async function* () {},
        verifyJournal: async () => {
          throw new Error("should never be called for a stub command");
        },
      },
      projectHash: "test",
    };

    const findings = await sweepDispatchLevelNotImplemented(SWEEP_COMMAND_PROBES, deps);

    expect(connectClientCalled).toBe(true);
    expect(findings.map((f) => f.command)).not.toContain("resume");
    expect(findings.map((f) => f.command)).not.toContain("status");
    expect(findings.every((f) => f.exitCode === EXIT_NOT_IMPLEMENTED)).toBe(true);
  });
});

describe("checkProductionDependencyWiring — genuine integration (real buildRealCliDependencies)", () => {
  /** Every optional bag is wired as of the phase-23 composition-root work — learning closed last, once promotion was bound to an ongoing intake. */
  it("reflects today's real production wiring: every optional bag is now supplied", () => {
    const wiring = checkProductionDependencyWiring();
    expect(wiring.installerWired).toBe(true);
    expect(wiring.intakeWired).toBe(true);
    expect(wiring.trustWired).toBe(true);
    expect(wiring.connectionWired).toBe(true);
    expect(wiring.learningWired).toBe(true);
  });

  /**
   * The one bag member that is deliberately NOT supplied (WP5,
   * 2026-07-25). Pinned so that wiring a real capability discoverer is a
   * visible, deliberate edit here plus an allowlist deletion — not a
   * silent change that leaves the gate asserting a gap that has closed.
   */
  it("reports capability discovery as NOT wired — the one remaining connection-bag gap", () => {
    expect(checkProductionDependencyWiring().capabilityDiscoveryWired).toBe(false);
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
      trustWired: true,
      connectionWired: true,
      capabilityDiscoveryWired: false,
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
      trustWired: false,
      connectionWired: false,
      capabilityDiscoveryWired: false,
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
      trustWired: false,
      connectionWired: false,
      capabilityDiscoveryWired: false,
    };
    const [install] = combineFindings(
      allDispatchLevelFindings.filter((f) => f.command === "install"),
      wiring,
    );
    expect(install?.realGapInProduction).toBe(false);
  });

  it("marks connection-capabilities a real gap: its bag is wired but its discoverer is not", () => {
    const wiring: ProductionDependencyWiring = {
      installerWired: true,
      intakeWired: true,
      learningWired: true,
      trustWired: true,
      connectionWired: true,
      capabilityDiscoveryWired: false,
    };
    const [capabilities] = combineFindings(
      [{ command: "connection-capabilities", exitCode: EXIT_NOT_IMPLEMENTED, detail: "" }],
      wiring,
    );
    expect(capabilities?.realGapInProduction).toBe(true);
    expect(capabilities?.note).toContain("capabilityDiscoveryWired");
  });

  it("marks a dependency-gated command as a real gap when its dependency is NOT wired (run/intake today)", () => {
    const wiring: ProductionDependencyWiring = {
      installerWired: true,
      intakeWired: false,
      learningWired: false,
      trustWired: false,
      connectionWired: false,
      capabilityDiscoveryWired: false,
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

    // Every command whose dispatch branch is gated by a bag production
    // actually supplies: installer, intake, trust and connection are all
    // wired, so their branches are reachable and none of these is a gap.
    // Plus `gateway-mcp`, whose branch is unreachable dead code.
    expect(notRealGaps).toEqual(
      [
        "gateway-mcp",
        "install",
        "upgrade",
        "uninstall",
        "run",
        "trust-review",
        "trust-approve",
        "trust-revoke",
        "connection-add",
        "connection-list",
        "connection-doctor",
        "learn-list",
        "learn-approve",
        "learn-reject",
        "learn-rollback",
      ].sort(),
    );
    // All that genuinely remains: connection-capabilities, which has no
    // backend at all. It is the allowlist's single entry.
    expect(realGaps).toEqual(["connection-capabilities"]);
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
