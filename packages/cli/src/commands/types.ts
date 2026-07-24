/**
 * Command-handler dependency bag — every real (non-stub) command handler in
 * `./real-handlers.ts` takes exactly this, so `./dispatch.ts` (and its own
 * tests) can inject fakes without touching a real supervisor/journal/host
 * unless a specific test wants to.
 */
import type { JournalStore } from "@eo/journal";
import type { AuthorizationEnvelope, ChangeSet, WorkUnit } from "@eo/contracts";
import type { Registry, IntakeRequest } from "@eo/supervisor";
import type { UdsClient } from "../uds-client/client.js";
import type { AuthState } from "../doctor/checks/auth-probe.js";
import type { InstallerDependencies } from "../installer/types.js";
import type { ApprovalTokenMinter } from "../approval/token.js";
import type { ApprovalPromptIo } from "../approval/prompt.js";

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
  readonly minter: ApprovalTokenMinter;
  readonly readIntakeRequest: () => Promise<IntakeRequest>;
  /** Defaults to `process.stdin`/`process.stdout` (real interactive usage) when omitted — injectable so tests never block on real stdio. */
  readonly io?: ApprovalPromptIo;
}

export interface CliDependencies {
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
}
