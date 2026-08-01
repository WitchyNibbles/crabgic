#!/usr/bin/env node
/**
 * `crabgic-supervisord` executable entry point —
 * roadmap/05-supervisor-daemon.md §Lifecycle ("started on demand by the CLI
 * (09); exactly one live instance per project"). A thin,
 * intentionally-untested-by-design shim over `@crabgic/supervisor`'s
 * `bootSupervisor`, which carries every branch of actual logic and IS
 * unit-tested — the same split this package's own `../bin.ts` uses.
 *
 * WHY THIS LIVES IN `packages/cli`, not `packages/supervisor`: the daemon
 * must construct the real `ClaudeEngineAdapter` to drive work, and
 * `@crabgic/engine-claude` already depends on `@crabgic/supervisor` — hosting the
 * entry point there would be a dependency cycle. `@crabgic/supervisor` therefore
 * keeps the composition root parameterized on `@crabgic/engine-core`'s
 * `EngineAdapter` interface, and this layer injects the concrete engine.
 *
 * Contract (settled in the phase-23 final-wiring pass): the spawner (the CLI,
 * roadmap/09) passes the resolved project hash in `CRABGIC_PROJECT_HASH`; every
 * path (journal, runtime dir, socket, lease) is then derived from the live
 * process's XDG environment, so the daemon and the CLI agree on the socket
 * path without a second hash-derivation site.
 *
 * The listening UDS server keeps the event loop alive; SIGTERM/SIGINT trigger
 * `bootSupervisor`'s graceful shutdown (close socket + release lease). Finding
 * a daemon already running for this project is treated as benign success
 * (exit 0) so a spawn race never fails the caller — a daemon IS up.
 */
import { readXdgEnvFromProcess } from "@crabgic/journal";
import {
  bootSupervisor,
  readPeerCredentialsLinux,
  SupervisorAlreadyRunningError,
  type SupervisorDependencies,
} from "@crabgic/supervisor";
// Neither import may pull `../daemon/run-dispatcher.js` into the boot path:
// it statically imports `@crabgic/engine-claude` -> `@anthropic-ai/claude-agent-sdk`,
// measured at +40.9 MiB, which alone put this daemon's idle RSS over
// roadmap/05's <100 MiB budget. `RealRunDispatcherOptions` is a TYPE-only
// import (erased under `verbatimModuleSyntax`), and the dispatcher itself is
// loaded on first dispatch — see `../daemon/lazy-run-dispatcher.ts`.
import { createLazyRunDispatcher } from "../daemon/lazy-run-dispatcher.js";
import { loadEnvelopePolicy, resolveEnvelopePolicyPath } from "../policy/policy-store.js";
import { resolveWorkerAuthMaterial } from "../daemon/worker-auth.js";
import type { RealRunDispatcherOptions } from "../daemon/run-dispatcher.js";

const EXIT_OK = 0;
const EXIT_GENERAL_ERROR = 1;

function toErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

async function main(): Promise<void> {
  const projectHash = process.env.CRABGIC_PROJECT_HASH;
  if (projectHash === undefined || projectHash.length === 0) {
    process.stderr.write("supervisord: CRABGIC_PROJECT_HASH is required\n");
    process.exitCode = EXIT_GENERAL_ERROR;
    return;
  }

  const xdgEnv = readXdgEnvFromProcess();

  // The daemon drives runs, which means freezing the repository and cutting
  // per-attempt worktrees — both need the actual checkout, which a project
  // HASH cannot locate. The spawning CLI passes it (see
  // `../uds-client/ensure-supervisor.ts`).
  const projectDir = process.env.CRABGIC_PROJECT_DIR;
  const auth = await resolveWorkerAuthMaterial(xdgEnv.HOME);

  try {
    const booted = await bootSupervisor({
      env: xdgEnv,
      projectHash,
      peerAuth: { reader: readPeerCredentialsLinux },
      // Missing projectDir or credentials degrades ONLY dispatch: the
      // daemon still serves status/cancel/evidence/registry, none of which
      // need either, and `run.dispatch` refuses with a typed reason. Dying
      // here instead would take the whole control plane down over a
      // capability most commands never use.
      ...(projectDir !== undefined && projectDir.length > 0 && auth !== undefined
        ? {
            createRunDispatcher: (deps: SupervisorDependencies) =>
              createLazyRunDispatcher({
                deps: deps as RealRunDispatcherOptions["deps"],
                projectDir,
                xdgEnv,
                projectHash,
                auth,
                // The standing approval, re-read on EVERY dispatch rather
                // than captured at boot (ledger Gap 18). An owner who
                // narrows the policy must have that bind to the next
                // dispatch, not to the next daemon restart -- a long-lived
                // daemon caching it would make tightening the gate silently
                // ineffective for as long as it stays up.
                loadPolicy: () =>
                  loadEnvelopePolicy(resolveEnvelopePolicyPath(xdgEnv, projectHash)),
                // Named in containment refusals: editing this file is the
                // only remedy that works for an out-of-policy envelope.
                standingPolicyPath: resolveEnvelopePolicyPath(xdgEnv, projectHash),
                onDriveError: (runId, err) => {
                  process.stderr.write(
                    `supervisord: run ${runId} failed to drive: ${toErrorMessage(err)}\n`,
                  );
                },
              }),
          }
        : {}),
      onShutdown: (info) => {
        process.exitCode = EXIT_OK;
        // Say so when the drain could not finish. The lease is deliberately
        // left held in that case (`bootSupervisor`'s teardown), which an
        // operator watching the next `crabgic` invocation take over a
        // "stale-looking" lease deserves to have been told about rather than
        // discover.
        if (!info.leaseReleased) {
          process.stderr.write(
            `supervisord: ${String(info.unsettledRunIds.length)} run(s) were still writing at ` +
              `shutdown (${info.unsettledRunIds.join(", ")}); the project lease is NOT released ` +
              `— the next daemon reclaims it once this process is gone\n`,
          );
        }
      },
    });
    if (projectDir === undefined || projectDir.length === 0) {
      process.stderr.write(
        "supervisord: CRABGIC_PROJECT_DIR unset — `run dispatch` is unavailable\n",
      );
    } else if (auth === undefined) {
      process.stderr.write(
        "supervisord: no engine credentials found — `run dispatch` is unavailable " +
          "(set CLAUDE_CODE_OAUTH_TOKEN or run `claude setup-token`)\n",
      );
    }
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
