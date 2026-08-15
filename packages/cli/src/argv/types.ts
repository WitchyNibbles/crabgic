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

/**
 * `approve <digest>` — the terminal half of the escalation path ledger
 * Gap 18 kept the token machinery for: a human, in a real terminal, approves
 * a pending authorization envelope by its digest. The `/eo:approve` skill
 * delegates here. Mint AND verification happen inside this one command
 * process, so the token never crosses a process or session boundary — the
 * exact courier exposure Gap 18's audit recorded against `run --json`.
 */
export interface ApproveCommand extends JsonFlag {
  readonly command: "approve";
  readonly digest: string;
}

/**
 * `crabgic design approve|reject <change-set-id> --revision <rev>` — the design
 * gate's write path (owner ruling R2, roadmap/25 WI 5).
 *
 * A CLI command and deliberately NOT a gateway tool. Nothing reachable from a
 * session may record this verdict, or the model could approve its own design
 * and the gate would be a checkpoint — the same division ledger Gap 18 draws
 * around the `EnvelopePolicy`.
 *
 * `revision` is required on both verbs: a verdict that does not say what it was
 * given over carries forward across an edit. `reason` is required on `reject`
 * and refused by the schema without it, because the design stage loops on it.
 */
export interface DesignVerdictCommand extends JsonFlag {
  readonly command: "design-approve" | "design-reject";
  readonly changeSetId: string;
  readonly revision: string;
  readonly reason?: string;
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
  /**
   * Jira only — the members of `JiraConnectionConfig` this command exposes,
   * per roadmap/19 line 97: "whoever wires the CLI should read
   * `JiraConnectionConfig` (this phase) as the contract to expose, not
   * invent a parallel shape."
   *
   * `--reference` stays the PRIMARY credential in every mode (the OAuth
   * client secret, the basic password / API token, or the PAT), so the
   * flag an operator already knows keeps meaning "the secret". These name
   * the second half a mode needs, never a duplicate of the first.
   */
  readonly authMode?: string;
  /** `--username-ref`: basic auth's username — on Cloud, the account email that pairs with an API token. */
  readonly usernameReference?: SecretReference;
  /** `--client-id-ref`: OAuth's client id, whose secret is `--reference`. */
  readonly clientIdReference?: SecretReference;
  /** `--allow-basic-auth`: roadmap/19's Data Center opt-in. Has no effect on Cloud, where basic auth means a revocable API token rather than a directory password. */
  readonly allowBasicAuth: boolean;
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
  | ApproveCommand
  | DesignVerdictCommand
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
