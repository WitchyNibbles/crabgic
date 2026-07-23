/**
 * Command-handler dependency bag — every real (non-stub) command handler in
 * `./real-handlers.ts` takes exactly this, so `./dispatch.ts` (and its own
 * tests) can inject fakes without touching a real supervisor/journal/host
 * unless a specific test wants to.
 */
import type { JournalStore } from "@eo/journal";
import type { UdsClient } from "../uds-client/client.js";
import type { AuthState } from "../doctor/checks/auth-probe.js";

export interface CliDependencies {
  /** Connects to the supervisor's UDS control socket. Throws `SupervisorUnavailableError` if unreachable. */
  readonly connectClient: () => Promise<UdsClient>;
  readonly journal: Pick<JournalStore, "queryEntries" | "verifyJournal">;
  readonly projectHash: string;
  readonly resolveAuthState?: () => Promise<AuthState>;
}
