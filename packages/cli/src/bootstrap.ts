/**
 * The testable core of `bin.ts`'s real `CliDependencies` wiring — factored
 * out so it can be unit-tested against injected overrides (`xdgEnv`,
 * `projectHash`, `resolveAuthState`) without a real process/socket.
 *
 * ADVERSARIAL-REVIEW FIX (2026-07-24): `bin.ts` used to build
 * `CliDependencies` inline with NO `resolveAuthState` at all, so `doctor`'s
 * auth check always fell back to `run-doctor.ts`'s constant `"missing"` —
 * always FAILING even on an authenticated host. `buildRealCliDependencies`
 * below always wires a real `createRealAuthStateResolver()` by default.
 */
import {
  createJournalStore,
  readXdgEnvFromProcess,
  resolveJournalDir,
  type XdgEnv,
} from "@eo/journal";
import { resolveSupervisorSocketPath } from "@eo/supervisor";
import { createRealAuthStateResolver } from "./doctor/checks/auth-probe.js";
import type { AuthProbeFn } from "./doctor/checks/auth-probe.js";
import type { CliDependencies } from "./commands/types.js";
import { connectUdsClient } from "./uds-client/client.js";
import {
  ensureSupervisorConnection,
  spawnSupervisorDaemon,
  type SpawnSupervisorDaemonOptions,
} from "./uds-client/ensure-supervisor.js";
import { deriveProjectHash } from "./project-hash.js";
import { buildRealInstallerDependencies } from "./installer/real-installer-dependencies.js";
import type { InstallerDependencies } from "./installer/types.js";

export interface BuildRealCliDependenciesOverrides {
  readonly xdgEnv?: XdgEnv;
  readonly projectHash?: string;
  readonly resolveAuthState?: AuthProbeFn;
  /** Defaults to `process.cwd()`'s own real installer wiring (roadmap/10-plugin-and-installer.md) — `../commands/dispatch.ts` only invokes it for `install`/`upgrade`/`uninstall`. */
  readonly installer?: InstallerDependencies;
  /** Spawn-on-demand knobs for `connectClient` (roadmap/05 §Lifecycle). Tests inject `spawnDaemon` plus tight retry bounds so no real daemon process is forked; production takes the defaults. */
  readonly supervisorSpawn?: {
    readonly spawnDaemon?: (options: SpawnSupervisorDaemonOptions) => void;
    readonly maxAttempts?: number;
    readonly retryDelayMs?: number;
  };
}

export function buildRealCliDependencies(
  overrides: BuildRealCliDependenciesOverrides = {},
): CliDependencies {
  const xdgEnv = overrides.xdgEnv ?? readXdgEnvFromProcess();
  const projectHash = overrides.projectHash ?? deriveProjectHash(process.cwd());
  const socketPath = resolveSupervisorSocketPath(xdgEnv, projectHash);
  const journal = createJournalStore({ journalDir: resolveJournalDir(xdgEnv, projectHash) });

  const supervisorSpawn = overrides.supervisorSpawn ?? {};
  const spawnDaemon = supervisorSpawn.spawnDaemon ?? spawnSupervisorDaemon;

  return {
    // roadmap/05-supervisor-daemon.md §Lifecycle: the daemon is "started on
    // demand by the CLI (09)". Every command that talks to the supervisor
    // reaches it through here, so this is the one place the spawn-on-demand
    // policy has to live — connect, and only if the socket is unreachable,
    // start the daemon once and retry until it answers.
    connectClient: () =>
      ensureSupervisorConnection({
        connect: () => connectUdsClient({ socketPath }),
        spawnDaemon: () => spawnDaemon({ projectHash }),
        ...(supervisorSpawn.maxAttempts !== undefined
          ? { maxAttempts: supervisorSpawn.maxAttempts }
          : {}),
        ...(supervisorSpawn.retryDelayMs !== undefined
          ? { retryDelayMs: supervisorSpawn.retryDelayMs }
          : {}),
      }),
    journal,
    projectHash,
    // Honors the SAME HOME the rest of this function resolved paths
    // against — both for real-world correctness (the auth probe's
    // `~/.claude/...` lookups match whichever HOME this invocation
    // actually resolved everything else from) and for testability
    // (overriding `xdgEnv` deterministically controls auth resolution too).
    resolveAuthState:
      overrides.resolveAuthState ?? createRealAuthStateResolver({ homeDir: xdgEnv.HOME }),
    installer: overrides.installer ?? buildRealInstallerDependencies(process.cwd()),
  };
}
