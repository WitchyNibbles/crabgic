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
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import {
  createJournalStore,
  readXdgEnvFromProcess,
  resolveJournalDir,
  resolveStateRoot,
  resolveXdgStateHome,
  type JournalStore,
  type XdgEnv,
} from "@crabgic/journal";
import {
  FileExternalConnectionStore,
  probeConnectionReachability,
  ProviderRegistry,
  type GatewayToolRegistry,
  type GenericProviderClient,
  type MutationApplyClient,
} from "@crabgic/gateway";
import { registerJiraCloudProvider, type JiraConnectionRegistry } from "@crabgic/connectors-jira";
import {
  createFileGrafanaPlanPayloadStore,
  createFileGrafanaRollbackSnapshotStore,
  registerRoutedGrafanaProvider,
  type GrafanaConnectionRegistry,
  type GrafanaPlanPayloadStoreLike,
  type GrafanaRollbackSnapshotStoreLike,
} from "@crabgic/connectors-grafana";
import { buildProductionGatewayToolRegistry } from "./gateway-mcp/build-tool-registry.js";
import {
  ApprovalTokenMinter,
  AuthorizationEnvelopeSchema,
  ChangeSetSchema,
  IntentContractSchema,
  WorkUnitSchema,
  type AuthorizationEnvelope,
  type ChangeSet,
  type IntentContract,
  type WorkUnit,
} from "@crabgic/contracts";
import {
  createApprovalLedger,
  createCapabilityStore,
  resolveCapabilityStoreDir,
  type TrustCommandDependencies,
} from "@crabgic/detect";
import {
  AUTHORIZATION_ENVELOPES_FILE_NAME,
  CHANGE_SETS_FILE_NAME,
  createFileRegistry,
  INTENT_CONTRACTS_FILE_NAME,
  resolveSupervisorSocketPath,
  WORK_UNITS_FILE_NAME,
  type IntakeRequest,
} from "@crabgic/supervisor";
import {
  loadOrCreateApprovalSigningKey,
  resolveApprovalSigningKeyPath,
} from "./approval/signing-key.js";
import { ProposalRegistry, resolveRegistryDir } from "@crabgic/learning";
import { resolveOngoingIntakeRefs } from "./learning/ongoing-intake-refs.js";
import type { LearningDependencies } from "./learning/learning-dependencies.js";
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
import { isPassiveMode } from "./uds-client/passive-mode.js";
import { deriveProjectHash } from "./project-hash.js";
import { resolveFindingStorePath } from "./review/finding-store.js";
import { resolveCalibrationStorePath } from "./review/calibration-store.js";
import {
  buildRealInstallerDependencies,
  createRealConfirmPolicy,
} from "./installer/real-installer-dependencies.js";
import { derivePolicy } from "./policy/derive-policy.js";
import { resolveEnvelopePolicyPath, writeEnvelopePolicy } from "./policy/policy-store.js";
import { listTopLevelDirectories } from "./policy/list-directories.js";
import type { InstallerDependencies } from "./installer/types.js";
import type { ConnectionDependencies } from "./connection/connection-commands.js";

/** The durable connection store's file name under the project's XDG state root. */
const CONNECTIONS_FILE_NAME = "connections.json";

/**
 * 20's plan-payload and rollback-snapshot stores, durable under the
 * project's XDG state root (not cache). A pending mutation plan is state
 * an operator's approval already authorized, and losing it strands the
 * mutation half-applied with no rollback baseline — `resolveCacheRoot`
 * would invite cleaners to delete exactly that.
 */
const GRAFANA_PLAN_PAYLOADS_FILE_NAME = "grafana-plan-payloads.json";
const GRAFANA_ROLLBACK_SNAPSHOTS_FILE_NAME = "grafana-rollback-snapshots.json";

/**
 * roadmap/18/19's Jira and roadmap/20's Grafana provider dispatch, wired
 * into 16's two `ProviderRegistry` instances.
 *
 * REGISTRATION IS CREDENTIAL-FREE. `registerJiraCloudProvider` and
 * `registerRoutedGrafanaProvider` take only the two registries — no secret
 * is resolved, no HTTP client is built, no network call is made — and each
 * returns the per-CONNECTION registry that the connection lifecycle fills
 * in once an operator has configured a connection and its credentials
 * resolve. Doing this at boot is therefore not "wiring credentials early";
 * it is telling the gateway which provider keys this build knows how to
 * dispatch at all. Before it, a perfectly valid Jira connection answered
 * `UnknownProviderError` — "this build has no Jira connector" — which was
 * simply false.
 *
 * The two returned registries are handed back so a caller that DOES hold
 * resolved credentials can call `register(connection, ...)` on them. No
 * such caller exists yet; that is the genuinely-blocked half, tracked in
 * `e2e/live/src/knownDeferredAllowlist.ts` rather than faked here. The
 * same is true of the two Grafana stores below: they are CONSTRUCTED here,
 * durable and owner-only, and travel with the registry they belong to, but
 * nothing consumes them until that `register(connection, {payloadStore,
 * snapshotStore})` call site exists. Stated plainly rather than described
 * as "wired" — `./bootstrap.test.ts` pins what is actually true of them
 * (their exact paths, their mode, and that they survive a process
 * boundary), and nothing claims more.
 */
export interface ProviderDispatchWiring {
  readonly providers: ProviderRegistry<GenericProviderClient>;
  readonly mutationApplyClients: ProviderRegistry<MutationApplyClient>;
  readonly jira: JiraConnectionRegistry;
  readonly grafana: GrafanaConnectionRegistry;
  /** Durable, so a plan built in one `gateway mcp` process is appliable from the next. Passed to `GrafanaConnectionRegistry.register` by whoever makes that call — see the note above. */
  readonly grafanaPayloadStore: GrafanaPlanPayloadStoreLike;
  readonly grafanaSnapshotStore: GrafanaRollbackSnapshotStoreLike;
}

export function buildProviderDispatchWiring(
  xdgEnv: XdgEnv,
  projectHash: string,
): ProviderDispatchWiring {
  const stateRoot = resolveStateRoot(xdgEnv, projectHash);
  const providers = new ProviderRegistry<GenericProviderClient>();
  const mutationApplyClients = new ProviderRegistry<MutationApplyClient>();

  return {
    providers,
    mutationApplyClients,
    jira: registerJiraCloudProvider({ providers, mutationApplyClients }),
    grafana: registerRoutedGrafanaProvider({ providers, mutationApplyClients }),
    grafanaPayloadStore: createFileGrafanaPlanPayloadStore({
      path: join(stateRoot, GRAFANA_PLAN_PAYLOADS_FILE_NAME),
    }),
    grafanaSnapshotStore: createFileGrafanaRollbackSnapshotStore({
      path: join(stateRoot, GRAFANA_ROLLBACK_SNAPSHOTS_FILE_NAME),
    }),
  };
}

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
  /** roadmap/22's `learn *` bag. Tests inject one with a tmp-dir proposal registry and a scripted `resolveChangeSetRefs` so no real learning state is written. */
  readonly learning?: LearningDependencies;
  /** Spawn-on-demand knobs for `connectClient` (roadmap/05 §Lifecycle). Tests inject `spawnDaemon` plus tight retry bounds so no real daemon process is forked; production takes the defaults. */
  readonly supervisorSpawn?: {
    readonly spawnDaemon?: (options: SpawnSupervisorDaemonOptions) => void;
    readonly maxAttempts?: number;
    readonly retryDelayMs?: number;
    /** Explicit passive-mode override; when omitted, `CRABGIC_NO_SPAWN` in the process env decides. Tests set it directly so they never depend on ambient env. */
    readonly spawn?: boolean;
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
  const signingKey = loadOrCreateApprovalSigningKey(
    resolveApprovalSigningKeyPath(xdgEnv, projectHash),
    resolveXdgStateHome(xdgEnv),
  );
  const minter = new ApprovalTokenMinter({ secretKey: signingKey, journal });

  const supervisorSpawn = overrides.supervisorSpawn ?? {};
  const spawnDaemon = supervisorSpawn.spawnDaemon ?? spawnSupervisorDaemon;
  // Passive observers (the manager Stop hook) set this to ask whether a
  // supervisor is ALREADY up without causing one to exist. See
  // `./uds-client/passive-mode.ts` for why it is an env var and not a flag.
  const passive = supervisorSpawn.spawn === false || isPassiveMode(process.env);

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
        spawn: !passive,
        ...(supervisorSpawn.maxAttempts !== undefined
          ? { maxAttempts: supervisorSpawn.maxAttempts }
          : {}),
        ...(supervisorSpawn.retryDelayMs !== undefined
          ? { retryDelayMs: supervisorSpawn.retryDelayMs }
          : {}),
      }),
    journal,
    projectHash,
    standingPolicyPath: resolveEnvelopePolicyPath(xdgEnv, projectHash),
    // Honors the SAME HOME the rest of this function resolved paths
    // against — both for real-world correctness (the auth probe's
    // `~/.claude/...` lookups match whichever HOME this invocation
    // actually resolved everything else from) and for testability
    // (overriding `xdgEnv` deterministically controls auth resolution too).
    resolveAuthState:
      overrides.resolveAuthState ?? createRealAuthStateResolver({ homeDir: xdgEnv.HOME }),
    installer:
      overrides.installer ??
      buildRealInstallerDependencies(process.cwd(), {
        // The standing-approval bootstrap (ledger Gap 18). Wired HERE because
        // this is the only place that knows the project's XDG paths, and the
        // policy is deliberately not a repo artifact — a standing grant that
        // could be committed would be a standing grant every clone carried.
        policy: {
          path: resolveEnvelopePolicyPath(xdgEnv, projectHash),
          derive: () =>
            derivePolicy({
              projectDir: process.cwd(),
              id: randomUUID(),
              createdAt: new Date().toISOString(),
              listDirectories: listTopLevelDirectories,
            }),
          confirm: createRealConfirmPolicy({ input: process.stdin, output: process.stdout }),
          // ROAST ROUND 32: the writer verifies every directory component
          // BELOW the state home, so the state home has to travel with it.
          write: (target, policy) =>
            writeEnvelopePolicy(target, policy, resolveXdgStateHome(xdgEnv)),
        },
      }),
    trust: overrides.trust ?? buildRealTrustDependencies(xdgEnv, projectHash, journal, minter),
    connection: overrides.connection ?? buildRealConnectionDependencies(xdgEnv, projectHash),
    intake: overrides.intake ?? buildRealIntakeDependencies(xdgEnv, projectHash, journal, minter),
    learning:
      overrides.learning ??
      buildRealLearningDependencies(xdgEnv, projectHash, journal, minter, signingKey),
  };
}

/**
 * roadmap/22's `learn list|approve|reject|rollback` bag.
 *
 * `@crabgic/learning`'s own `ProposalRegistry` is already file-backed, rooted at
 * the project's pinned learning dir — which matters here for the same
 * reason it did for connections: every `learn` invocation is its own
 * short-lived process, so a proposal recorded by one must be visible to the
 * next.
 *
 * `secretKey` is the project's DURABLE signing key and `minter` is this
 * process's single shared instance: `learn approve` mints and verifies
 * under the third, distinct `"learning_review"` subject kind, never
 * `"envelope_hash"`/`"capability_digest"`.
 *
 * `resolveChangeSetRefs` implements the owner's ruling that a promoted
 * lesson rides an intake already in flight — read from the SAME durable
 * ChangeSet registry `run` writes, at promote time, refusing rather than
 * inventing references. See `./learning/ongoing-intake-refs.ts`.
 */
function buildRealLearningDependencies(
  xdgEnv: XdgEnv,
  projectHash: string,
  journal: JournalStore,
  minter: ApprovalTokenMinter,
  secretKey: Buffer,
): LearningDependencies {
  const changeSets = createFileRegistry<ChangeSet>({
    path: join(resolveStateRoot(xdgEnv, projectHash), CHANGE_SETS_FILE_NAME),
    schema: ChangeSetSchema,
  });

  return {
    registry: new ProposalRegistry({
      registryDir: resolveRegistryDir(xdgEnv, projectHash),
      journal,
    }),
    journal,
    minter,
    secretKey,
    resolveChangeSetRefs: () => resolveOngoingIntakeRefs(changeSets),
  };
}

/**
 * The `gateway mcp` server's real tool registry — every family the shipped
 * binary exposes, bound to the SAME durable state the CLI's own commands
 * use. That sharing is the point: `run` mints an approval token and writes
 * the ChangeSet in one process, and `contract.approve` verifies and flips it
 * from this one.
 *
 * Deliberately reuses `buildRealCliDependencies` rather than re-resolving
 * the registries itself, so there is exactly one definition of where this
 * project's state lives — and so `capability.approve` verifies against the
 * very same `ApprovalTokenMinter` instance `trust approve` minted from.
 */
export function buildRealGatewayToolRegistry(
  overrides: BuildRealCliDependenciesOverrides = {},
): GatewayToolRegistry {
  const xdgEnv = overrides.xdgEnv ?? readXdgEnvFromProcess();
  const projectHash = overrides.projectHash ?? deriveProjectHash(process.cwd());
  const deps = buildRealCliDependencies({ ...overrides, xdgEnv, projectHash });

  // Non-null assertions are sound here and nowhere else: this function
  // resolves its own `xdgEnv`/`projectHash` and passes them down, so the
  // three optional bags are the real ones built above unless a test
  // deliberately injected replacements.
  const intake = deps.intake!;
  const trust = deps.trust!;
  const dispatch = buildProviderDispatchWiring(xdgEnv, projectHash);

  return buildProductionGatewayToolRegistry({
    journal: intake.journal,
    connections: deps.connection!.repository,
    providers: dispatch.providers,
    mutationApplyClients: dispatch.mutationApplyClients,
    supervisorSocketPath: resolveSupervisorSocketPath(xdgEnv, projectHash),
    // Resolved HERE, from the same xdgEnv/projectHash everything else in this
    // composition root uses — a second derivation elsewhere would be a second
    // answer to "where is this project's state" that could disagree.
    reviewFindingsPath: resolveFindingStorePath(xdgEnv, projectHash),
    reviewCalibrationPath: resolveCalibrationStorePath(xdgEnv, projectHash),
    reviewStateHome: resolveXdgStateHome(xdgEnv),
    approvalSigningKey: loadOrCreateApprovalSigningKey(
      resolveApprovalSigningKeyPath(xdgEnv, projectHash),
      resolveXdgStateHome(xdgEnv),
    ),
    changeSets: intake.changeSets,
    workUnits: intake.workUnits,
    envelopes: intake.envelopes,
    intentContracts: intake.intentContracts,
    capability: { store: trust.store },
    approvalTokenVerifier: trust.minter,
    resolveCapabilityStoreKey: (digest) => trust.store.findByDigest(digest)?.key,
  });
}

/**
 * roadmap/11's `run` backend. The three registries are DURABLE and rooted
 * at the project's XDG state root, at the exact paths `@crabgic/supervisor`'s
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
    // File-backed for the same reason as the three above: `contract.approve`
    // reads this ChangeSet's declared `requirementIds` from a DIFFERENT
    // process (the gateway MCP server), and journal replay does not rebuild
    // intake artifacts.
    intentContracts: createFileRegistry<IntentContract>({
      path: join(stateRoot, INTENT_CONTRACTS_FILE_NAME),
      schema: IntentContractSchema,
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
      "`run` reads an intake request as JSON on stdin — e.g. `crabgic run < intake.json`",
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
 * capability-store path (`$XDG_CACHE_HOME/crabgic/
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
