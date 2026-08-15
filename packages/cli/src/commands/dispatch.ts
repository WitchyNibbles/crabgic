/**
 * `ParsedCommand` → `CommandResult` — roadmap/09-cli-and-doctor.md work
 * item 1's failing-first framing: "invoking a command with no backend
 * registered yet returns the exact `NOT_IMPLEMENTED` typed shape, not a
 * crash or an untyped error." Every command name in `../argv/types.ts` has
 * a branch below; `status`/`cancel`/`evidence`/`doctor` delegate to
 * `./real-handlers.ts` unconditionally; `install`/`upgrade`/`uninstall`
 * (roadmap/10-plugin-and-installer.md) delegate to
 * `./installer-handlers.ts` only when `deps.installer` is supplied;
 * `learn-*` and `trust-*` likewise delegate to their real backends only
 * when `deps.learning` / `deps.trust` is supplied; everything else returns
 * `notImplementedResult`.
 */
import { EXIT_GENERAL_ERROR, EXIT_SUPERVISOR_UNAVAILABLE } from "../exit-codes.js";
import { SupervisorUnavailableError, toErrorMessage } from "../errors.js";
import type { ParsedCommand } from "../argv/types.js";
import type { CommandResult } from "../output/format.js";
import type { CliDependencies } from "./types.js";
import { notImplementedResult } from "./not-implemented.js";
import {
  runCancelCommand,
  runDoctorCommand,
  runEvidenceCommand,
  runResumeCommand,
  runRunCommand,
  runStatusCommand,
} from "./real-handlers.js";
import { runApproveCommand } from "./approve.js";
import { runDesignVerdictCommand } from "./design-verdict-handler.js";
import { runInstallCommand, runUninstallCommand, runUpgradeCommand } from "./installer-handlers.js";
import {
  runLearnApproveCommand,
  runLearnListCommand,
  runLearnRejectCommand,
  runLearnRollbackCommand,
} from "../learning/learn-command-backend.js";
import {
  runTrustApproveCommand,
  runTrustReviewCommand,
  runTrustRevokeCommand,
} from "@crabgic/detect";
import {
  runConnectionAddCommand,
  runConnectionDoctorCommand,
  runConnectionListCommand,
} from "../connection/connection-commands.js";
import { runConnectionCapabilitiesCommand } from "../connection/connection-capabilities.js";
import { renderHelp } from "./help.js";

export async function dispatchCommand(
  command: ParsedCommand,
  deps: CliDependencies,
): Promise<CommandResult> {
  try {
    switch (command.command) {
      case "help":
        return renderHelp(command);
      case "doctor":
        return await runDoctorCommand(command, deps);
      case "status":
        return await runStatusCommand(command, deps);
      case "cancel":
        return await runCancelCommand(command, deps);
      case "evidence":
        return await runEvidenceCommand(command, deps);

      // roadmap/10-plugin-and-installer.md wires these three real backends
      // — but ONLY when `deps.installer` is supplied (kept optional on
      // `CliDependencies` precisely so every pre-existing roadmap/09 test,
      // which never supplies it, keeps observing the exact same typed
      // NOT_IMPLEMENTED shape unchanged).
      case "install":
        return deps.installer !== undefined
          ? await runInstallCommand(command, deps.installer)
          : notImplementedResult(command.command, command.json);
      case "upgrade":
        return deps.installer !== undefined
          ? await runUpgradeCommand(command, deps.installer)
          : notImplementedResult(command.command, command.json);
      case "uninstall":
        return deps.installer !== undefined
          ? await runUninstallCommand(command, deps.installer)
          : notImplementedResult(command.command, command.json);

      // roadmap/11-intake-contract-approval.md wires this real backend —
      // but ONLY when `deps.intake` is supplied (kept optional on
      // `CliDependencies` precisely so every pre-existing roadmap/09 test,
      // which never supplies it, keeps observing the exact same typed
      // NOT_IMPLEMENTED shape unchanged).
      case "run":
        return await runRunCommand(command, deps);

      // roadmap/11's escalation half (ledger Gap 18): a human approves a
      // pending envelope digest at a real terminal. Same conditional wiring
      // as `run` — without `deps.intake` it stays typed NOT_IMPLEMENTED.
      case "approve":
        return await runApproveCommand(command, deps);

      // `resume <run-id>` asks the daemon to (re-)drive an existing run.
      // Unconditional like `status`/`cancel`: it needs only the UDS client,
      // since the DRIVER lives in the daemon (roadmap/05 owns worker
      // lifecycle; `driveRun` registers into the supervisor's own
      // `liveWorkers`), not in this process.
      // roadmap/25 WI 5 — the design gate's ONLY write path. Deliberately a CLI
      // command: no gateway tool records a verdict, so the model cannot approve
      // its own design (the same division ledger Gap 18 draws around the
      // standing EnvelopePolicy).
      case "design-approve":
      case "design-reject":
        return deps.designVerdicts !== undefined
          ? await runDesignVerdictCommand(command, deps.designVerdicts)
          : notImplementedResult(command.command, command.json);

      case "resume":
        return await runResumeCommand(command, deps);

      // roadmap/22-learning-system.md wires these four real backends —
      // but ONLY when `deps.learning` is supplied (kept optional on
      // `CliDependencies` precisely so every pre-existing roadmap/09 test,
      // which never supplies it, keeps observing the exact same typed
      // NOT_IMPLEMENTED shape unchanged).
      case "learn-list":
        return deps.learning !== undefined
          ? await runLearnListCommand(command, deps.learning)
          : notImplementedResult(command.command, command.json);
      case "learn-approve":
        return deps.learning !== undefined
          ? await runLearnApproveCommand(command, deps.learning)
          : notImplementedResult(command.command, command.json);
      case "learn-reject":
        return deps.learning !== undefined
          ? await runLearnRejectCommand(command, deps.learning)
          : notImplementedResult(command.command, command.json);
      case "learn-rollback":
        return deps.learning !== undefined
          ? await runLearnRollbackCommand(command, deps.learning)
          : notImplementedResult(command.command, command.json);

      // roadmap/12-stack-detection-quarantine.md wires these three real
      // backends (implemented in `@crabgic/detect`) — but ONLY when `deps.trust`
      // is supplied, for the identical reason as `installer`/`learning`
      // above. Phase 12 could not wire these itself: reaching `@crabgic/detect`
      // from here closed a dependency cycle until the shared primitives
      // moved to `@crabgic/contracts` (2026-07-25).
      case "trust-review":
        return deps.trust !== undefined
          ? runTrustReviewCommand(command, deps.trust)
          : notImplementedResult(command.command, command.json);
      case "trust-approve":
        return deps.trust !== undefined
          ? await runTrustApproveCommand(command, deps.trust)
          : notImplementedResult(command.command, command.json);
      case "trust-revoke":
        return deps.trust !== undefined
          ? await runTrustRevokeCommand(command, deps.trust)
          : notImplementedResult(command.command, command.json);

      // roadmap/16's `ExternalConnection` store + reachability probe, wired
      // through `../connection/connection-commands.ts` when `deps.connection`
      // is supplied — same optional-bag convention as above.
      case "connection-add":
        return deps.connection !== undefined
          ? await runConnectionAddCommand(command, deps.connection)
          : notImplementedResult(command.command, command.json);
      case "connection-list":
        return deps.connection !== undefined
          ? await runConnectionListCommand(command, deps.connection)
          : notImplementedResult(command.command, command.json);
      case "connection-doctor":
        return deps.connection !== undefined
          ? await runConnectionDoctorCommand(command, deps.connection)
          : notImplementedResult(command.command, command.json);

      // Same optional-bag convention as its three siblings, one level
      // deeper: the backend exists (`../connection/connection-capabilities.ts`)
      // and is gated on `deps.connection.discoverCapabilities`, the
      // injected discovery function that plays the role `probe` plays for
      // `connection-doctor`. `../bootstrap.ts` does not supply one yet —
      // see `ConnectionDependencies.discoverCapabilities` for exactly what
      // each connector is still missing — so in the shipped binary this
      // remains the typed NOT_IMPLEMENTED shape, visible to `e2e/live`'s
      // sweep. It is no longer UNCONDITIONAL: a caller holding a real
      // discoverer now reaches a real command.
      case "connection-capabilities":
        return deps.connection?.discoverCapabilities !== undefined
          ? await runConnectionCapabilitiesCommand(command, deps.connection)
          : notImplementedResult(command.command, command.json);

      case "gateway-mcp":
        // `gateway mcp` is a long-running stdio process, never a single
        // CommandResult — `../bin.ts` boots it directly and never routes
        // it through this dispatcher's request/response model.
        return notImplementedResult(
          "gateway mcp is booted directly by bin.ts, never dispatched",
          false,
        );

      default: {
        const exhaustive: never = command;
        return notImplementedResult(String((exhaustive as { command: string }).command), false);
      }
    }
  } catch (err) {
    if (err instanceof SupervisorUnavailableError) {
      return { exitCode: EXIT_SUPERVISOR_UNAVAILABLE, stderr: `${err.message}\n` };
    }
    return { exitCode: EXIT_GENERAL_ERROR, stderr: `${toErrorMessage(err)}\n` };
  }
}
