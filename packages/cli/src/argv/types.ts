/**
 * The typed command surface — roadmap/09-cli-and-doctor.md §In scope
 * "Commands" bullet + §Interfaces produced item 1. Every member below is one
 * of the plan's named commands; `./parse-command.ts` is the sole place raw
 * `argv` is turned into one of these, and `../commands/dispatch.ts` is the
 * sole place one of these is turned into a `CommandResult`.
 */
import type {
  TrustApproveCommand,
  TrustReviewCommand,
  TrustRevokeCommand,
} from "@crabgic/contracts";
import type { SecretReference } from "./secret-reference.js";

interface JsonFlag {
  readonly json: boolean;
}

export interface InstallCommand extends JsonFlag {
  readonly command: "install";
  readonly dryRun: boolean;
}

export interface DoctorCommand extends JsonFlag {
  readonly command: "doctor";
  readonly repairPlan: boolean;
}

export interface RunCommand extends JsonFlag {
  readonly command: "run";
}

export interface StatusCommand extends JsonFlag {
  readonly command: "status";
  readonly runId?: string;
  readonly watch: boolean;
}

export interface ResumeCommand extends JsonFlag {
  readonly command: "resume";
  readonly runId: string;
}

export interface CancelCommand extends JsonFlag {
  readonly command: "cancel";
  readonly targetId: string;
}

export interface EvidenceCommand extends JsonFlag {
  readonly command: "evidence";
  readonly changeSetId: string;
}

export type ConnectionProvider = "jira" | "grafana";

/**
 * roadmap/19 §Out of scope, line 97: "This phase asserts no CLI flag names
 * ... as settled — that surface belongs to 09/23. Whoever wires the CLI
 * should read `JiraConnectionConfig` (this phase) as the contract to
 * expose, not invent a parallel shape." Accordingly the fields below are
 * exactly the ones `ExternalConnectionSchema` (02) requires or accepts —
 * `baseUrl` is mandatory because the schema has no default for it, and the
 * list/TTL fields are optional because `./parse-command.ts` can derive
 * safe defaults (redirect origins default to the base URL's own origin;
 * the TTL to 16's 15-minute `CapabilitySnapshot` default).
 */
export interface ConnectionAddCommand extends JsonFlag {
  readonly command: "connection-add";
  readonly provider: ConnectionProvider;
  readonly reference: SecretReference;
  /** Must be `https://` — `ExternalConnectionSchema` refuses anything else. */
  readonly baseUrl: string;
  /** Provider-interpreted opaque string (Jira cloud/datacenter, Grafana cloud/oss/enterprise). */
  readonly deploymentType?: string;
  readonly allowedRedirectOrigins: readonly string[];
  readonly allowedResources: readonly string[];
  readonly allowedActions: readonly string[];
  readonly discoveryTtlSeconds: number;
}

export interface ConnectionListCommand extends JsonFlag {
  readonly command: "connection-list";
}

export interface ConnectionDoctorCommand extends JsonFlag {
  readonly command: "connection-doctor";
  readonly connectionId: string;
}

export interface ConnectionCapabilitiesCommand extends JsonFlag {
  readonly command: "connection-capabilities";
  readonly connectionId: string;
}

/**
 * The three `trust *` shapes are the only members of this union whose
 * backend lives outside this package (phase 12 owns them, in
 * `@crabgic/detect`), so they are declared in `@crabgic/contracts` and re-exported
 * here — see `packages/contracts/src/cli-surface/trust-commands.ts`. They
 * remain ordinary members of `ParsedCommand` below; nothing else changes.
 */
export type { TrustApproveCommand, TrustReviewCommand, TrustRevokeCommand };

export interface LearnListCommand extends JsonFlag {
  readonly command: "learn-list";
}

export interface LearnApproveCommand extends JsonFlag {
  readonly command: "learn-approve";
  readonly proposalId: string;
}

export interface LearnRejectCommand extends JsonFlag {
  readonly command: "learn-reject";
  readonly proposalId: string;
}

export interface LearnRollbackCommand extends JsonFlag {
  readonly command: "learn-rollback";
  readonly proposalId: string;
}

export interface UpgradeCommand extends JsonFlag {
  readonly command: "upgrade";
  readonly dryRun: boolean;
}

export interface UninstallCommand extends JsonFlag {
  readonly command: "uninstall";
  readonly keepState: boolean;
}

/** No user-facing flags (interface-ledger Gap 2). */
export interface GatewayMcpCommand {
  readonly command: "gateway-mcp";
}

export interface HelpCommand extends JsonFlag {
  readonly command: "help";
  readonly topic?: string;
}

export type ParsedCommand =
  | InstallCommand
  | DoctorCommand
  | RunCommand
  | StatusCommand
  | ResumeCommand
  | CancelCommand
  | EvidenceCommand
  | ConnectionAddCommand
  | ConnectionListCommand
  | ConnectionDoctorCommand
  | ConnectionCapabilitiesCommand
  | TrustReviewCommand
  | TrustApproveCommand
  | TrustRevokeCommand
  | LearnListCommand
  | LearnApproveCommand
  | LearnRejectCommand
  | LearnRollbackCommand
  | UpgradeCommand
  | UninstallCommand
  | GatewayMcpCommand
  | HelpCommand;

export type CommandName = ParsedCommand["command"];
