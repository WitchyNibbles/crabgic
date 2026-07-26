import {
  buildRealCliDependencies,
  dispatchCommand,
  EXIT_NOT_IMPLEMENTED,
  SupervisorUnavailableError,
  type CliDependencies,
  type CommandName,
  type ParsedCommand,
} from "engineering-orchestrator";

/**
 * The zero-`NOT_IMPLEMENTED` SWEEP (behavioral half) — roadmap/23-release-
 * hardening.md work item 7: "a static test that greps/loads
 * packages/cli + packages/gateway and enumerates EVERY `NOT_IMPLEMENTED`
 * return." This module LOADS the real, shipped `packages/cli` package
 * (`engineering-orchestrator`'s own public exports — `dispatchCommand`,
 * the real router) and drives every command variant through it, recording
 * which ones actually produce the typed `NOT_IMPLEMENTED` shape
 * (`exitCode === EXIT_NOT_IMPLEMENTED`) — a real, running proof rather than
 * a hand-maintained list that could silently drift from the code.
 *
 * TWO DISTINCT LAYERS, because the codebase's own optionality convention
 * (`CliDependencies.installer`/`.intake`/`.learning`) means "does dispatch.ts
 * have a real conditional branch for this command" and "is that branch
 * actually reachable in the real, shipped binary" are different questions:
 *
 *  - `sweepDispatchLevelNotImplemented` drives every candidate command
 *    against a deps bag with every OPTIONAL dependency left `undefined`
 *    (mirrors "every pre-existing roadmap/09 test" per that package's own
 *    doc comments) — the widest, dependency-agnostic view of which
 *    commands CAN return `NOT_IMPLEMENTED`.
 *  - `checkProductionDependencyWiring` calls the REAL
 *    `buildRealCliDependencies()` (`packages/cli/src/bootstrap.ts`) and
 *    inspects which of `installer`/`intake`/`learning` it actually
 *    supplies. THIS IS WHERE A REAL, PREVIOUSLY-UNDOCUMENTED GAP SURFACES:
 *    `buildRealCliDependencies` wires `installer` (so `install`/`upgrade`/
 *    `uninstall` are NOT stubs in the shipped binary) but NEVER wires
 *    `intake` or `learning` — so `run` and all four `learn-*` commands,
 *    despite dispatch.ts having real conditional branches for them and
 *    real backends existing (`../intake/run-intake-command.ts` /
 *    `../learning/learn-command-backend.ts`), are UNCONDITIONALLY
 *    `NOT_IMPLEMENTED` in the actual `engineering-orchestrator` binary
 *    today. `combineFindings` below folds both layers into the final,
 *    accurate "what's really NOT_IMPLEMENTED right now" list.
 */

/** One representative `ParsedCommand` per command name this sweep drives — excludes `help` (never `NOT_IMPLEMENTED`) and `doctor`/`cancel`/`evidence` (fully wired via `deps.journal`/`deps.connectClient`, not part of the `NOT_IMPLEMENTED` surface, and probing them would require a live supervisor connection this sweep has no business establishing). */
export const SWEEP_COMMAND_PROBES: readonly ParsedCommand[] = [
  { command: "resume", json: false, runId: "sweep-probe-run-id" },
  {
    // Fully-populated since `connection-add` was wired: the command type
    // gained the fields `ExternalConnectionSchema` requires, and a probe
    // missing them no longer type-checks. Values are inert — the sweep
    // only ever observes which dispatch branch was taken, never a store
    // write or a network call.
    command: "connection-add",
    json: false,
    provider: "jira",
    reference: { raw: "env:SWEEP_PROBE_TOKEN" },
    baseUrl: "https://sweep-probe.invalid",
    allowedRedirectOrigins: [],
    allowedResources: [],
    allowedActions: [],
    discoveryTtlSeconds: 900,
  },
  { command: "connection-list", json: false },
  { command: "connection-doctor", json: false, connectionId: "sweep-probe-connection-id" },
  { command: "connection-capabilities", json: false, connectionId: "sweep-probe-connection-id" },
  { command: "trust-review", json: false },
  { command: "trust-approve", json: false, digest: "sweep-probe-digest" },
  { command: "trust-revoke", json: false, tokenId: "sweep-probe-token-id" },
  { command: "run", json: false },
  { command: "learn-list", json: false },
  { command: "learn-approve", json: false, proposalId: "sweep-probe-proposal-id" },
  { command: "learn-reject", json: false, proposalId: "sweep-probe-proposal-id" },
  { command: "learn-rollback", json: false, proposalId: "sweep-probe-proposal-id" },
  { command: "status", json: false, watch: false },
  { command: "gateway-mcp" },
  { command: "install", json: false, dryRun: true },
  { command: "upgrade", json: false, dryRun: true },
  { command: "uninstall", json: false, keepState: false },
];

export interface SweepFinding {
  readonly command: CommandName;
  readonly exitCode: number;
  /** The rendered `NotImplementedShape.message`, when JSON-decodable; a short summary otherwise. */
  readonly detail: string;
}

/**
 * None of `SWEEP_COMMAND_PROBES` above ever reach `deps.connectClient`/
 * `deps.journal` on the `NOT_IMPLEMENTED` path (every stub branch in
 * `dispatch.ts` returns before touching either) — these stubs exist purely
 * to satisfy `CliDependencies`' type; a real call would throw loudly if
 * this sweep's own command list ever drifted to include a fully-wired
 * command by mistake, which is itself a useful safety property.
 */
export function unusedDeps(): CliDependencies {
  return {
    connectClient: async () => {
      throw new SupervisorUnavailableError(
        "cliNotImplementedSweep never expects a stub command to reach the supervisor",
      );
    },
    journal: {
      queryEntries: () => ({
        [Symbol.asyncIterator]() {
          return {
            next: async (): Promise<IteratorResult<never>> => {
              throw new Error(
                "cliNotImplementedSweep never expects a stub command to reach the journal",
              );
            },
          };
        },
      }),
      verifyJournal: async () => {
        throw new Error("cliNotImplementedSweep never expects a stub command to reach the journal");
      },
    },
    projectHash: "cli-not-implemented-sweep-fixture",
  };
}

/** Drives every `SWEEP_COMMAND_PROBES` entry through the real `dispatchCommand` router with every optional dependency left `undefined`, and records every one that comes back `NOT_IMPLEMENTED`. */
export async function sweepDispatchLevelNotImplemented(
  probes: readonly ParsedCommand[] = SWEEP_COMMAND_PROBES,
  deps: CliDependencies = unusedDeps(),
): Promise<readonly SweepFinding[]> {
  const findings: SweepFinding[] = [];
  for (const probe of probes) {
    // Deliberately sequential: a handful of pure-routing calls, order
    // doesn't matter but simplicity does.
    const result = await dispatchCommand(probe, deps);
    if (result.exitCode === EXIT_NOT_IMPLEMENTED) {
      findings.push({
        command: probe.command,
        exitCode: result.exitCode,
        detail: (result.stdout ?? "").trim(),
      });
    }
  }
  return findings;
}

export interface ProductionDependencyWiring {
  readonly installerWired: boolean;
  readonly intakeWired: boolean;
  readonly learningWired: boolean;
  /** roadmap/12's `trust *` bag — wired 2026-07-25; this audit reported `trust-*` as a real gap until it was. */
  readonly trustWired: boolean;
  /** roadmap/16's `connection *` bag — wired 2026-07-25, same as `trustWired`. */
  readonly connectionWired: boolean;
  /**
   * `ConnectionDependencies.discoverCapabilities` specifically (WP5,
   * 2026-07-25). Tracked SEPARATELY from `connectionWired` because
   * `connection-capabilities` is gated one level deeper than its three
   * siblings: the bag is wired, but the discovery function inside it is
   * not, so folding it under `connectionWired` would report a real,
   * currently-shipped gap as closed.
   */
  readonly capabilityDiscoveryWired: boolean;
}

/**
 * Calls the REAL `buildRealCliDependencies()` (no overrides) and reports
 * which optional dependency bags it actually supplies. Safe to call in any
 * environment: construction alone does filesystem-path resolution
 * (`$XDG_*`, `process.cwd()`) but never opens a socket or spawns a process.
 */
export function checkProductionDependencyWiring(): ProductionDependencyWiring {
  const deps = buildRealCliDependencies();
  return {
    installerWired: deps.installer !== undefined,
    intakeWired: deps.intake !== undefined,
    learningWired: deps.learning !== undefined,
    trustWired: deps.trust !== undefined,
    connectionWired: deps.connection !== undefined,
    capabilityDiscoveryWired: deps.connection?.discoverCapabilities !== undefined,
  };
}

/** Command names whose stub branch is a structurally dead branch in production, not a real reachable gap: `cli-entry.ts` intercepts `"gateway-mcp"` before ever calling `dispatchCommand` (`../cli-entry.ts`'s own doc comment: "only invoked for a command that actually needs it (never for gateway-mcp ...)"). */
const STRUCTURALLY_DEAD_BRANCHES: ReadonlySet<CommandName> = new Set(["gateway-mcp"]);

/** Commands whose `NOT_IMPLEMENTED`-capable dispatch branch is gated by an optional dependency this sweep's own `checkProductionDependencyWiring` maps to `installerWired`/`intakeWired`/`learningWired`. */
const DEPENDENCY_GATED_COMMANDS: Readonly<Record<string, keyof ProductionDependencyWiring>> = {
  install: "installerWired",
  upgrade: "installerWired",
  uninstall: "installerWired",
  run: "intakeWired",
  "learn-list": "learningWired",
  "learn-approve": "learningWired",
  "learn-reject": "learningWired",
  "learn-rollback": "learningWired",
  "trust-review": "trustWired",
  "trust-approve": "trustWired",
  "trust-revoke": "trustWired",
  "connection-add": "connectionWired",
  "connection-list": "connectionWired",
  "connection-doctor": "connectionWired",
  "connection-capabilities": "capabilityDiscoveryWired",
};

export interface CliNotImplementedFinding {
  readonly command: CommandName;
  /** `true` iff this command is ACTUALLY `NOT_IMPLEMENTED` in the real, shipped `engineering-orchestrator` binary today (not merely at dispatch-level absent-deps probing). */
  readonly realGapInProduction: boolean;
  readonly note: string;
}

/**
 * Folds `sweepDispatchLevelNotImplemented`'s findings with
 * `checkProductionDependencyWiring`'s real wiring facts into the final,
 * accurate list of commands that are genuinely `NOT_IMPLEMENTED` in the
 * real, shipped binary right now.
 */
export function combineFindings(
  dispatchLevelFindings: readonly SweepFinding[],
  wiring: ProductionDependencyWiring,
): readonly CliNotImplementedFinding[] {
  return dispatchLevelFindings.map((finding) => {
    if (STRUCTURALLY_DEAD_BRANCHES.has(finding.command)) {
      return {
        command: finding.command,
        realGapInProduction: false,
        note:
          '"gateway mcp" is intercepted and booted directly by cli-entry.ts before dispatchCommand ' +
          "is ever called for it in the real binary — this dispatch.ts branch is unreachable dead " +
          "code, not a real gap.",
      };
    }
    const gatingKey = DEPENDENCY_GATED_COMMANDS[finding.command];
    if (gatingKey !== undefined) {
      const wired = wiring[gatingKey];
      return {
        command: finding.command,
        realGapInProduction: !wired,
        note: wired
          ? `dispatch.ts has a NOT_IMPLEMENTED branch for "${finding.command}" absent its optional ` +
            `dependency, but buildRealCliDependencies() DOES wire it in production — not a real gap.`
          : `dispatch.ts has a real conditional branch for "${finding.command}", but ` +
            `buildRealCliDependencies() never supplies the dependency (${gatingKey}) that would ` +
            "route to it — a real, currently-shipped gap.",
      };
    }
    return {
      command: finding.command,
      realGapInProduction: true,
      note: `"${finding.command}" has no backend wired at all — a real, currently-shipped gap.`,
    };
  });
}
