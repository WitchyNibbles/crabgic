/**
 * The typed command surface — roadmap/09-cli-and-doctor.md §In scope
 * "Commands" bullet + §Interfaces produced item 1. Every member below is one
 * of the plan's named commands; `./parse-command.ts` is the sole place raw
 * `argv` is turned into one of these, and `../commands/dispatch.ts` is the
 * sole place one of these is turned into a `CommandResult`.
 */
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

export interface ConnectionAddCommand extends JsonFlag {
  readonly command: "connection-add";
  readonly provider: ConnectionProvider;
  readonly reference: SecretReference;
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

export interface TrustReviewCommand extends JsonFlag {
  readonly command: "trust-review";
}

export interface TrustApproveCommand extends JsonFlag {
  readonly command: "trust-approve";
  readonly digest: string;
}

export interface TrustRevokeCommand extends JsonFlag {
  readonly command: "trust-revoke";
  readonly tokenId: string;
}

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
