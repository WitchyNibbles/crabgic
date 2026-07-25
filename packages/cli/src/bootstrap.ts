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
import { join } from "node:path";
import {
  createJournalStore,
  readXdgEnvFromProcess,
  resolveJournalDir,
  resolveStateRoot,
  type JournalStore,
  type XdgEnv,
} from "@eo/journal";
import { FileExternalConnectionStore, probeConnectionReachability } from "@eo/gateway";
import {
  ApprovalTokenMinter,
  AuthorizationEnvelopeSchema,
  ChangeSetSchema,
  WorkUnitSchema,
  type AuthorizationEnvelope,
  type ChangeSet,
  type WorkUnit,
} from "@eo/contracts";
import {
  createApprovalLedger,
  createCapabilityStore,
  resolveCapabilityStoreDir,
  type TrustCommandDependencies,
} from "@eo/detect";
import {
  AUTHORIZATION_ENVELOPES_FILE_NAME,
  CHANGE_SETS_FILE_NAME,
  createFileRegistry,
  resolveSupervisorSocketPath,
  WORK_UNITS_FILE_NAME,
  type IntakeRequest,
} from "@eo/supervisor";
import {
  loadOrCreateApprovalSigningKey,
  resolveApprovalSigningKeyPath,
} from "./approval/signing-key.js";
import { createRealAuthStateResolver } from "./doctor/checks/auth-probe.js";
import type { AuthProbeFn } from "./doctor/checks/auth-probe.js";
import type { CliDependencies, IntakeDependencies } from "./commands/types.js";
import { CliUsageError } from "./errors.js";
import { connectUdsClient } from "./uds-client/client.js";
import {
  ensureSupervisorConnection,
  spawnSupervisorDaemon,
  type SpawnSupervisorDaemonOptions,
} from "./uds-client/ensure-supervisor.js";
import { deriveProjectHash } from "./project-hash.js";
import { buildRealInstallerDependencies } from "./installer/real-installer-dependencies.js";
import type { InstallerDependencies } from "./installer/types.js";
import type { ConnectionDependencies } from "./connection/connection-commands.js";

/** The durable connection store's file name under the project's XDG state root. */
const CONNECTIONS_FILE_NAME = "connections.json";

export interface BuildRealCliDependenciesOverrides {
  readonly xdgEnv?: XdgEnv;
  readonly projectHash?: string;
  readonly resolveAuthState?: AuthProbeFn;
  /** Defaults to `process.cwd()`'s own real installer wiring (roadmap/10-plugin-and-installer.md) — `../commands/dispatch.ts` only invokes it for `install`/`upgrade`/`uninstall`. */
  readonly installer?: InstallerDependencies;
  /** roadmap/12's `trust *` bag. Tests inject a tmp-dir-rooted one so no real XDG cache directory is created or read. */
  readonly trust?: TrustCommandDependencies;
  /** roadmap/16's `connection *` bag. Tests inject one with a fake probe so no real network I/O occurs. */
  readonly connection?: ConnectionDependencies;
  /** roadmap/11's `run` bag. Tests inject one with tmp-dir registries and a scripted `readIntakeRequest` so nothing reads real stdin. */
  readonly intake?: IntakeDependencies;
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

  // ONE minter per process, shared by `trust` (capability_digest) and
  // `run` (envelope_hash). A second instance would have its own single-use
  // table, so a token minted by one could never be verified by the other.
  //
  // The signing key is the project's DURABLE one (2026-07-25), not a
  // per-process `randomBytes(32)`: `eo run` mints an approval token in one
  // short-lived process and `contract.approve` verifies it in another (the
  // `gateway mcp` stdio server), so a per-process key made cross-process
  // approval structurally impossible. Single-use is unaffected — it is
  // enforced durably by `./approval/durable-approval-ledger.ts`, not by the
  // key's lifetime. See `./approval/signing-key.ts` for the full rationale
  // and the fail-closed mode/symlink checks it applies.
  const minter = new ApprovalTokenMinter({
    secretKey: loadOrCreateApprovalSigningKey(resolveApprovalSigningKeyPath(xdgEnv, projectHash)),
    journal,
  });

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
    trust: overrides.trust ?? buildRealTrustDependencies(xdgEnv, projectHash, journal, minter),
    connection: overrides.connection ?? buildRealConnectionDependencies(xdgEnv, projectHash),
    intake: overrides.intake ?? buildRealIntakeDependencies(xdgEnv, projectHash, journal, minter),
  };
}

/**
 * roadmap/11's `run` backend. The three registries are DURABLE and rooted
 * at the project's XDG state root, at the exact paths `@eo/supervisor`'s
 * `composeSupervisor` reads (`CHANGE_SETS_FILE_NAME` etc.).
 *
 * That sharing is the whole point. `run` executes in this short-lived CLI
 * process; the daemon that must actually drive the approved DAG
 * (`run.dispatch`) is a different, long-lived one. Registries used to be
 * in-memory on both sides, and journal replay rebuilds only runs/workers
 * (`recovery.ts`), so an approved DAG died with the CLI invocation that
 * produced it and the daemon could never see one. Writing to the same
 * files both processes agree on is what closes that gap.
 *
 * `readIntakeRequest` reads the request as JSON on stdin (`eo run <
 * intake.json`): an `IntakeRequest` is a document — sections, requirements,
 * work-unit drafts, envelope content, performance budgets — not something
 * typed at a prompt. There is no `IntakeRequestSchema`; the pipeline's own
 * builders each `*Schema.parse` what they construct, so malformed input
 * fails closed with a precise error rather than being half-accepted.
 */
function buildRealIntakeDependencies(
  xdgEnv: XdgEnv,
  projectHash: string,
  journal: JournalStore,
  minter: ApprovalTokenMinter,
): IntakeDependencies {
  const stateRoot = resolveStateRoot(xdgEnv, projectHash);
  return {
    journal,
    changeSets: createFileRegistry<ChangeSet>({
      path: join(stateRoot, CHANGE_SETS_FILE_NAME),
      schema: ChangeSetSchema,
    }),
    workUnits: createFileRegistry<WorkUnit>({
      path: join(stateRoot, WORK_UNITS_FILE_NAME),
      schema: WorkUnitSchema,
    }),
    envelopes: createFileRegistry<AuthorizationEnvelope>({
      path: join(stateRoot, AUTHORIZATION_ENVELOPES_FILE_NAME),
      schema: AuthorizationEnvelopeSchema,
    }),
    minter,
    readIntakeRequest: readIntakeRequestFromStdin,
  };
}

/** Reads the whole of stdin and parses it as an `IntakeRequest`. */
async function readIntakeRequestFromStdin(): Promise<IntakeRequest> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string));
  }
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (raw.length === 0) {
    throw new CliUsageError(
      "`run` reads an intake request as JSON on stdin — e.g. `engineering-orchestrator run < intake.json`",
    );
  }
  try {
    return JSON.parse(raw) as IntakeRequest;
  } catch (err) {
    throw new CliUsageError(
      `intake request on stdin is not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

/**
 * roadmap/16's `connection add|list|doctor` bag. The repository is the
 * DURABLE, file-backed one: each `connection` invocation is its own
 * short-lived process, so `InMemoryExternalConnectionStore` would drop
 * every connection the instant `connection add` exited.
 *
 * Stored under the project's XDG state root (not cache) because a
 * connection an operator configured is durable state, not a regenerable
 * artifact — `resolveCacheRoot` would invite cleaners to delete it.
 */
function buildRealConnectionDependencies(
  xdgEnv: XdgEnv,
  projectHash: string,
): ConnectionDependencies {
  return {
    repository: new FileExternalConnectionStore(
      join(resolveStateRoot(xdgEnv, projectHash), CONNECTIONS_FILE_NAME),
    ),
    probe: (connection) => probeConnectionReachability(connection),
  };
}

/**
 * roadmap/12's `trust review|approve|revoke` bag, rooted at the pinned
 * capability-store path (`$XDG_CACHE_HOME/engineering-orchestrator/
 * <project-hash>/capability-store/`, interface-ledger Gap 14).
 *
 * The HMAC signing key is freshly random PER PROCESS — never a hardcoded
 * or on-disk secret (`ApprovalTokenMinterOptions.secretKey`'s own
 * contract). That is deliberate, not a limitation: a minted token is
 * single-use and verified by `capability.approve` within the same process
 * tree, which is the scope `docs/evidence/phase-09/README.md` ("#6
 * (approval-token cross-process durability)") already settled. A key that
 * outlived the process would let a token outlive it too, which is exactly
 * what the single-use gate exists to prevent.
 */
function buildRealTrustDependencies(
  xdgEnv: XdgEnv,
  projectHash: string,
  _journal: JournalStore,
  minter: ApprovalTokenMinter,
): TrustCommandDependencies {
  const storeRoot = resolveCapabilityStoreDir(xdgEnv, projectHash);
  return {
    store: createCapabilityStore(storeRoot),
    minter,
    approvalLedger: createApprovalLedger(storeRoot),
  };
}
