/**
 * Command-handler dependency bag — every real (non-stub) command handler in
 * `./real-handlers.ts` takes exactly this, so `./dispatch.ts` (and its own
 * tests) can inject fakes without touching a real supervisor/journal/host
 * unless a specific test wants to.
 */
import type { JournalStore } from "@eo/journal";
import type { UdsClient } from "../uds-client/client.js";
import type { AuthState } from "../doctor/checks/auth-probe.js";
import type { InstallerDependencies } from "../installer/types.js";

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
}
