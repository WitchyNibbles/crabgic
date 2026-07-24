#!/usr/bin/env node
/**
 * `engineering-orchestrator-supervisord` executable entry point —
 * roadmap/05-supervisor-daemon.md §Lifecycle ("started on demand by the CLI
 * (09); exactly one live instance per project"). This is the ONLY file in
 * this package that touches the real `process.env`/`process.stderr`/
 * `process.exitCode` and installs real signal handlers: a thin,
 * intentionally-untested-by-design shim over `../compose/boot-supervisor.ts`'s
 * `bootSupervisor`, which carries every branch of actual logic and IS
 * unit-tested — the same split `packages/cli`'s own `bin.ts` uses.
 *
 * Contract (settled in the phase-23 final-wiring pass): the spawner (the CLI,
 * roadmap/09) passes the resolved project hash in `EO_PROJECT_HASH`; every
 * path (journal, runtime dir, socket, lease) is then derived from the live
 * process's XDG environment, so the daemon and the CLI agree on the socket
 * path without a second hash-derivation site.
 *
 * The listening UDS server keeps the event loop alive; SIGTERM/SIGINT trigger
 * `bootSupervisor`'s graceful shutdown (close socket + release lease). Finding
 * a daemon already running for this project is treated as benign success
 * (exit 0) so a spawn race never fails the caller — a daemon IS up.
 */
import { readXdgEnvFromProcess } from "@eo/journal";
import { readPeerCredentialsLinux } from "../peer-auth/peer-credentials.js";
import { bootSupervisor, SupervisorAlreadyRunningError } from "../compose/boot-supervisor.js";

const EXIT_OK = 0;
const EXIT_GENERAL_ERROR = 1;

function toErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

async function main(): Promise<void> {
  const projectHash = process.env.EO_PROJECT_HASH;
  if (projectHash === undefined || projectHash.length === 0) {
    process.stderr.write("supervisord: EO_PROJECT_HASH is required\n");
    process.exitCode = EXIT_GENERAL_ERROR;
    return;
  }

  try {
    const booted = await bootSupervisor({
      env: readXdgEnvFromProcess(),
      projectHash,
      peerAuth: { reader: readPeerCredentialsLinux },
      onShutdown: () => {
        process.exitCode = EXIT_OK;
      },
    });
    process.stderr.write(`supervisord: ready on ${booted.composed.socketPath}\n`);
  } catch (err) {
    if (err instanceof SupervisorAlreadyRunningError) {
      // Benign: a daemon already serves this project. The spawner just
      // connects to the existing socket.
      process.stderr.write(`supervisord: ${err.message}\n`);
      process.exitCode = EXIT_OK;
      return;
    }
    process.stderr.write(`supervisord: fatal: ${toErrorMessage(err)}\n`);
    process.exitCode = EXIT_GENERAL_ERROR;
  }
}

void main();
