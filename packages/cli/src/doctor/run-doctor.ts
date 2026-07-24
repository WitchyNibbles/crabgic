/**
 * Wires every named doctor check (roadmap/09-cli-and-doctor.md §Doctor
 * checks) against real probes for a given project. `../commands/doctor.ts`
 * is this module's only intended caller; individual checks stay
 * independently unit-testable against injected fixtures (`./*.test.ts` /
 * `./doctor.fault-matrix.test.ts`).
 */
import {
  readXdgEnvFromProcess,
  resolveCacheRoot,
  resolveStateRoot,
  type JournalStore,
  type XdgEnv,
} from "@eo/journal";
import { resolveSupervisorSocketPath, SUPERVISOR_SOCKET_MODE } from "@eo/supervisor";
import { createRealProcessProbe } from "./process-probe.js";
import { runDoctorChecks, type DoctorCheck, type DoctorReport } from "./framework.js";
import { createEngineVersionCheck } from "./checks/engine-version.js";
import { createSandboxSelftestCheck } from "./checks/sandbox-selftest.js";
import {
  createHermeticitySelftestCheck,
  createRealHermeticitySelftestProbe,
} from "./checks/hermeticity-selftest.js";
import { createAuthProbeCheck, type AuthState } from "./checks/auth-probe.js";
import { createGitPlumbingCheck } from "./checks/git-plumbing.js";
import { createXdgPermissionsCheck } from "./checks/xdg-permissions.js";
import { createJournalChainCheck } from "./checks/journal-chain.js";
import { createWsl2WarningsCheck } from "./checks/wsl2-warnings.js";
import { createChecksumDriftCheck } from "./checks/checksum-drift.js";
import { createPluginTrustPinCheck } from "./checks/plugin-trust-pin.js";
import { createCapabilityManifestFreshnessCheck } from "./checks/capability-manifest-freshness.js";

export interface RunDoctorOptions {
  readonly projectHash: string;
  readonly journal: Pick<JournalStore, "verifyJournal">;
  /** Injectable auth resolver — defaults to "missing" (no credential-reading side effects at doctor-build time unless a real one is supplied by the caller). */
  readonly resolveAuthState?: () => Promise<AuthState>;
  /** Injectable XDG env — defaults to `readXdgEnvFromProcess()` (real process env). Overridable for tests that need a deterministic state/cache/socket path without mutating real process env. */
  readonly xdgEnv?: XdgEnv;
  /**
   * roadmap/10-plugin-and-installer.md's own three doctor checks
   * (checksum-drift, plugin-trust-pin, CapabilityManifest-digest-freshness)
   * are registered ONLY when this is supplied — kept optional so every
   * pre-existing roadmap/09 caller/test (which never supplies it) keeps
   * observing the exact same 8-check default set unchanged.
   */
  readonly installer?: { readonly targetDir: string; readonly pluginSourceDir: string };
}

async function detectWsl2(): Promise<boolean> {
  try {
    const { readFile } = await import("node:fs/promises");
    const release = await readFile("/proc/version", "utf8");
    return release.toLowerCase().includes("microsoft");
  } catch {
    return false;
  }
}

export function buildDefaultDoctorChecks(options: RunDoctorOptions): readonly DoctorCheck[] {
  const spawnProbe = createRealProcessProbe();
  const xdgEnv = options.xdgEnv ?? readXdgEnvFromProcess();
  const stateRoot = resolveStateRoot(xdgEnv, options.projectHash);
  const cacheRoot = resolveCacheRoot(xdgEnv, options.projectHash);
  // The supervisor's own UDS control socket (05, `docs/ipc-protocol.md`:
  // "the socket file itself is 0600") — adversarial-review fix (2026-07-24):
  // this path was never fed to any check before, so a real "bad UDS socket
  // permissions" fault had nothing registered to catch it.
  const socketPath = resolveSupervisorSocketPath(xdgEnv, options.projectHash);

  return [
    createEngineVersionCheck({ probe: spawnProbe }),
    createSandboxSelftestCheck({ probe: spawnProbe }),
    createHermeticitySelftestCheck({ probe: createRealHermeticitySelftestProbe(spawnProbe) }),
    createAuthProbeCheck({ probe: options.resolveAuthState ?? (() => Promise.resolve("missing")) }),
    createGitPlumbingCheck({ probe: spawnProbe }),
    createXdgPermissionsCheck({
      paths: [
        { path: stateRoot, expectedMode: 0o700, kind: "dir" },
        { path: cacheRoot, expectedMode: 0o700, kind: "dir" },
        { path: socketPath, expectedMode: SUPERVISOR_SOCKET_MODE, kind: "file" },
      ],
    }),
    createJournalChainCheck({ journal: options.journal }),
    createWsl2WarningsCheck({
      isWsl2: detectWsl2,
      stateRootPath: stateRoot,
      cacheRootPath: cacheRoot,
    }),
    ...(options.installer !== undefined
      ? [
          createChecksumDriftCheck({ targetDir: options.installer.targetDir }),
          createPluginTrustPinCheck({ pluginSourceDir: options.installer.pluginSourceDir }),
          createCapabilityManifestFreshnessCheck({
            targetDir: options.installer.targetDir,
            pluginSourceDir: options.installer.pluginSourceDir,
          }),
        ]
      : []),
  ];
}

export async function runDoctor(options: RunDoctorOptions): Promise<DoctorReport> {
  return runDoctorChecks(buildDefaultDoctorChecks(options));
}
