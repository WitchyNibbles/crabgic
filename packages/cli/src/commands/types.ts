/**
 * Command-handler dependency bag — every real (non-stub) command handler in
 * `./real-handlers.ts` takes exactly this, so `./dispatch.ts` (and its own
 * tests) can inject fakes without touching a real supervisor/journal/host
 * unless a specific test wants to.
 */
import type { JournalStore } from "@crabgic/journal";
import type {
  AuthorizationEnvelope,
  ChangeSet,
  IntentContract,
  WorkUnit,
} from "@crabgic/contracts";
import type { Registry, IntakeRequest } from "@crabgic/supervisor";
import type { UdsClient } from "../uds-client/client.js";
import type { AuthState } from "../doctor/checks/auth-probe.js";
import type { InstallerDependencies } from "../installer/types.js";
import type { TrustCommandDependencies } from "@crabgic/detect";
import type { ApprovalTokenMinter } from "../approval/token.js";
import type { ApprovalPromptIo } from "../approval/prompt.js";
import type { ApprovalTerminalVerdict } from "../approval/interactive-terminal.js";
import type { LoadPolicyResult } from "../policy/policy-store.js";
import type { LearningDependencies } from "../learning/learning-dependencies.js";
import type { ConnectionDependencies } from "../connection/connection-commands.js";

/**
 * roadmap/11-intake-contract-approval.md's `run` backend — kept OPTIONAL for
 * the identical reason `installer` (below) is: every pre-existing
 * roadmap/09 test builds a `CliDependencies` without it and must keep
 * observing the exact same typed `NOT_IMPLEMENTED` shape for `run`
 * unchanged; `../bootstrap.ts`'s real wiring supplies it. `journal` here is
 * the FULL store (append-capable), distinct from this interface's own
 * top-level read-only `journal` field.
 */
export interface IntakeDependencies {
  readonly journal: JournalStore;
  readonly changeSets: Registry<ChangeSet>;
  readonly workUnits: Registry<WorkUnit>;
  /** CRITICAL C1 repair: durable envelope store — see `../intake/run-intake-command.ts`'s own doc comment on `RunIntakeCommandDeps.envelopes`. */
  readonly envelopes: Registry<AuthorizationEnvelope>;
  /** Durable contract store — see `../intake/run-intake-command.ts`'s own doc comment on `RunIntakeCommandDeps.intentContracts`. */
  readonly intentContracts: Registry<IntentContract>;
  readonly minter: ApprovalTokenMinter;
  /**
   * The project's durable approval-signing key — the SAME material `minter`
   * signs with, needed separately because `run`/`approve` now complete
   * verification in-process (`../intake/complete-envelope-approval.ts`)
   * instead of relaying the token to another process.
   */
  readonly secretKey: Buffer;
  readonly readIntakeRequest: () => Promise<IntakeRequest>;
  /**
   * Reads the project's standing `EnvelopePolicy` (ledger Gap 18) — REQUIRED,
   * because it IS the approval decision. Optional would mean a caller that
   * forgot it silently got a different, weaker approval model rather than a
   * compile error.
   */
  readonly loadPolicy: () => LoadPolicyResult;
  /** Defaults to `process.stdin`/`process.stdout` (real interactive usage) when omitted — injectable so tests never block on real stdio. */
  readonly io?: ApprovalPromptIo;
  /**
   * Whether this process may render the approval prompt at all. Defaults to
   * `resolveApprovalTerminal` over the real environment — which checks far
   * more than `isTTY`, because a pty wrapper satisfies `isTTY` from an agent's
   * own shell. See `../approval/interactive-terminal.ts` for what the gate
   * does and does not prove. Injectable so tests never depend on the ambient
   * terminal or environment.
   */
  readonly resolveTerminal?: () => ApprovalTerminalVerdict;
}

export interface CliDependencies {
  /** Absolute path to the project's standing `EnvelopePolicy` (ledger Gap 18). Optional so pre-existing callers keep the same doctor check set. */
  readonly standingPolicyPath?: string;
  /** Connects to the supervisor's UDS control socket. Throws `SupervisorUnavailableError` if unreachable. */
  readonly connectClient: () => Promise<UdsClient>;
  readonly journal: Pick<JournalStore, "queryEntries" | "verifyJournal">;
  readonly projectHash: string;
  readonly resolveAuthState?: () => Promise<AuthState>;
  /**
   * roadmap/10-plugin-and-installer.md's `install`/`upgrade`/`uninstall`
   * backend — kept OPTIONAL so every pre-existing roadmap/09 test (which
   * builds a `CliDependencies` without it) keeps observing the exact same
   * typed `NOT_IMPLEMENTED` shape for these three commands unchanged;
   * `../bootstrap.ts`'s real wiring always supplies it.
   */
  readonly installer?: InstallerDependencies;
  /** roadmap/11's `run` backend — see `IntakeDependencies`'s own doc comment above for why this is optional. */
  readonly intake?: IntakeDependencies;
  /**
   * roadmap/22-learning-system.md's `learn list|approve|reject|rollback`
   * backend — kept OPTIONAL for the identical reason `intake`/`installer`
   * are: every pre-existing roadmap/09 test builds a `CliDependencies`
   * without it and must keep observing the exact same typed
   * `NOT_IMPLEMENTED` shape for `learn-*` unchanged; `../bootstrap.ts`'s
   * real wiring supplies it.
   */
  readonly learning?: LearningDependencies;
  /**
   * roadmap/12-stack-detection-quarantine.md's `trust review|approve|revoke`
   * backend, implemented in `@crabgic/detect` — kept OPTIONAL for the identical
   * reason `intake`/`installer`/`learning` are: every pre-existing
   * roadmap/09 test builds a `CliDependencies` without it and must keep
   * observing the exact same typed `NOT_IMPLEMENTED` shape for `trust-*`
   * unchanged; `../bootstrap.ts`'s real wiring supplies it.
   *
   * Wiring this was blocked until 2026-07-25: phase 12 recorded the gap as
   * a deviation because `@crabgic/detect` could not be reached from here without
   * closing a `cli -> learning -> gates -> detect -> cli` dependency cycle.
   */
  readonly trust?: TrustCommandDependencies;
  /**
   * roadmap/16-gateway-core.md's `connection add|list|doctor` backend —
   * kept OPTIONAL for the identical reason the bags above are. roadmap/16
   * §Out of scope explicitly left the command surface to 09 ("ships it
   * `NOT_IMPLEMENTED` until wired"); this is the wiring.
   */
  readonly connection?: ConnectionDependencies;
}
