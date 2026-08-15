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
  type GatewayHttpClient,
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
  RequirementSchema,
  WorkUnitSchema,
  type AuthorizationEnvelope,
  type ChangeSet,
  type ExternalConnection,
  type IntentContract,
  type Requirement,
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
  REQUIREMENTS_FILE_NAME,
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
  readSupervisordStderrTail,
  spawnSupervisorDaemon,
  SUPERVISORD_STDERR_LOG_FILE_NAME,
  type SpawnSupervisorDaemonOptions,
} from "./uds-client/ensure-supervisor.js";
import { isPassiveMode } from "./uds-client/passive-mode.js";
import { deriveProjectHash } from "./project-hash.js";
import { resolveFindingStorePath } from "./review/finding-store.js";
import { resolveCalibrationStorePath } from "./review/calibration-store.js";
import { resolveAttestationStorePath } from "./review/attestation-store.js";
import { resolveArtifactStorePath } from "./review/artifact-store.js";
import {
  buildRealInstallerDependencies,
  createRealConfirmPolicy,
} from "./installer/real-installer-dependencies.js";
import { derivePolicy } from "./policy/derive-policy.js";
import {
  loadEnvelopePolicy,
  resolveEnvelopePolicyPath,
  writeEnvelopePolicy,
} from "./policy/policy-store.js";
import { listTopLevelDirectories } from "./policy/list-directories.js";
import type { InstallerDependencies } from "./installer/types.js";
import type { ConnectionDependencies } from "./connection/connection-commands.js";
import { withProviderKeyNormalization } from "./connection/provider-keys.js";
import { resolveProbePath } from "./connection/probe-paths.js";
import { FileJiraConnectionConfigStore } from "./connection/jira-config-store.js";
import { createConnectionActivator } from "./connection/connection-activation.js";

/** The durable connection store's file name under the project's XDG state root. */
const CONNECTIONS_FILE_NAME = "connections.json";

/** The per-connection Jira auth/deployment config store, beside `connections.json` (issue #135 — the storage roadmap/19's `JiraConnectionConfig` never had). */
const JIRA_CONNECTION_CONFIGS_FILE_NAME = "jira-connection-configs.json";

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
 * The two returned registries are handed back so a caller that holds
 * resolved credentials can call `register(connection, ...)` on them.
 *
 * THAT CALLER NOW EXISTS (2026-08-14, issue #135 defect 3):
 * `./connection/connection-activation.ts`, invoked lazily on first
 * dispatch for each connection. Until then there was none, and the note
 * here said so — which was accurate and also the whole bug: the
 * registries stayed empty for the process's entire life, so every
 * connector answered "was never registered" and none could serve a single
 * request. The same was true of the two Grafana stores below; the
 * `register(connection, {payloadStore, snapshotStore})` call site they
 * were waiting for is that activator.
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
  /**
   * Test-only seam for `buildRealGatewayToolRegistry`'s connection
   * activator — the HTTP client a connector is wired with. Production
   * omits it, defaulting to the real SSRF/DNS/TLS stack; tests supply a
   * capture so a dispatch can be driven end to end without a network.
   */
  readonly activationHttpClient?: (connection: ExternalConnection) => Promise<GatewayHttpClient>;
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
  // The daemon's stderr lands here (truncated per spawn) so that when it dies
  // during startup the CLI can report WHY, not just that nothing answered.
  // The state root already exists by now — `loadOrCreateApprovalSigningKey`
  // above created it — and `spawnSupervisorDaemon` falls back to discarding
  // stderr if the path is unopenable anyway.
  const supervisordStderrLogPath = join(
    resolveStateRoot(xdgEnv, projectHash),
    SUPERVISORD_STDERR_LOG_FILE_NAME,
  );
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
        spawnDaemon: () => spawnDaemon({ projectHash, stderrLogPath: supervisordStderrLogPath }),
        spawn: !passive,
        readSpawnDiagnostics: () => readSupervisordStderrTail(supervisordStderrLogPath),
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
          // The existing-file guard: an existing policy is the owner's file
          // (hand-added grants are never derived) and install keeps it.
          loadExisting: () => loadEnvelopePolicy(resolveEnvelopePolicyPath(xdgEnv, projectHash)),
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
    intake:
      overrides.intake ??
      buildRealIntakeDependencies(xdgEnv, projectHash, journal, minter, signingKey),
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
    // The call site issue #135's defect 3 was missing. `dispatch.jira`
    // and `dispatch.grafana` had NO consumers outside their own
    // construction, so the per-connection registries behind the two
    // provider clients above stayed empty for the process's whole life
    // and every connector answered "was never registered".
    activateConnection: createConnectionActivator({
      jira: dispatch.jira,
      jiraConfigs: deps.connection!.jiraConfigs!,
      grafana: dispatch.grafana,
      // The two durable stores this wiring already builds. Until now they
      // were constructed, documented, and consumed by nothing — the
      // `register(connection, {payloadStore, snapshotStore})` call site
      // they were waiting for is the one below.
      grafanaPayloadStore: dispatch.grafanaPayloadStore,
      grafanaSnapshotStore: dispatch.grafanaSnapshotStore,
      ...(overrides.activationHttpClient !== undefined
        ? {
            buildJiraHttpClient: overrides.activationHttpClient,
            buildGrafanaHttpClient: overrides.activationHttpClient,
          }
        : {}),
    }),
    supervisorSocketPath: resolveSupervisorSocketPath(xdgEnv, projectHash),
    // Resolved HERE, from the same xdgEnv/projectHash everything else in this
    // composition root uses — a second derivation elsewhere would be a second
    // answer to "where is this project's state" that could disagree.
    reviewFindingsPath: resolveFindingStorePath(xdgEnv, projectHash),
    reviewCalibrationPath: resolveCalibrationStorePath(xdgEnv, projectHash),
    reviewAttestationsPath: resolveAttestationStorePath(xdgEnv, projectHash),
    reviewArtifactsPath: resolveArtifactStorePath(xdgEnv, projectHash),
    reviewStateHome: resolveXdgStateHome(xdgEnv),
    approvalSigningKey: loadOrCreateApprovalSigningKey(
      resolveApprovalSigningKeyPath(xdgEnv, projectHash),
      resolveXdgStateHome(xdgEnv),
    ),
    changeSets: intake.changeSets,
    workUnits: intake.workUnits,
    envelopes: intake.envelopes,
    intentContracts: intake.intentContracts,
    requirements: intake.requirements,
    // `journal` is load-bearing, not decorative: `capability.audit` REFUSES
    // to run without it (interface-ledger Gap 5 — a verdict nobody can
    // later verify happened is worse than no verdict).
    capability: { store: trust.store, journal: intake.journal },
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
  secretKey: Buffer,
): IntakeDependencies {
  const stateRoot = resolveStateRoot(xdgEnv, projectHash);
  return {
    journal,
    secretKey,
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
    // File-backed for a STRONGER reason than the four above: the daemon
    // itself reads these. Seal verification resolves a work unit's
    // requirements before accepting its completion, and that happens in the
    // process that drives the run, not the one that took the intake.
    requirements: createFileRegistry<Requirement>({
      path: join(stateRoot, REQUIREMENTS_FILE_NAME),
      schema: RequirementSchema,
    }),
    minter,
    readIntakeRequest: readIntakeRequestFromStdin,
    // Ledger Gap 18: routine approval is the standing policy's containment
    // check, not a prompt. Read fresh per call — the owner may have edited the
    // policy since this process started, and a cached grant is a stale grant.
    loadPolicy: () => loadEnvelopePolicy(resolveEnvelopePolicyPath(xdgEnv, projectHash)),
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
    // Wrapped, never bare: a record written by 1.7.0 or earlier carries
    // the un-dispatchable `provider: "jira"` (issue #135, defect 2), and
    // this is the composition root — the one layer that knows both the
    // store and the connectors whose keys it must speak. The store itself
    // stays provider-agnostic.
    repository: withProviderKeyNormalization(
      new FileExternalConnectionStore(
        join(resolveStateRoot(xdgEnv, projectHash), CONNECTIONS_FILE_NAME),
      ),
    ),
    // Beside `connections.json`, under the same state root and the same
    // 0600 posture: a Jira connection's credential SHAPE is state an
    // operator configured, and without somewhere to record it a Jira
    // Cloud connection cannot authenticate at all (issue #135).
    jiraConfigs: new FileJiraConnectionConfigStore(
      join(resolveStateRoot(xdgEnv, projectHash), JIRA_CONNECTION_CONFIGS_FILE_NAME),
    ),
    // The provider-specific probe path is supplied HERE, not inside the
    // gateway: `probeConnectionReachability` stays provider-agnostic, and
    // this is the layer that knows both it and the connectors. Without a
    // caller for that seam, `connection doctor` GET the site root and
    // refused every Atlassian Cloud connection (issue #135, defect 1).
    probe: (connection) => {
      const path = resolveProbePath(connection.provider);
      return probeConnectionReachability(connection, path !== undefined ? { path } : {});
    },
  };
}

/**
 * roadmap/12's `trust review|approve|revoke` bag, rooted at the pinned
 * capability-store path (`$XDG_CACHE_HOME/crabgic/
 * <project-hash>/capability-store/`, interface-ledger Gap 14).
 *
 * **Corrected 2026-08-01:** this docblock used to claim "the HMAC signing
 * key is freshly random PER PROCESS." That has not been true since
 * `./approval/signing-key.ts` landed — the `minter` handed to this
 * function is built at `buildRealCliDependencies` from
 * `loadOrCreateApprovalSigningKey`, a DURABLE, 0600, project-scoped
 * on-disk key. It has to be: `trust approve` mints in one short-lived CLI
 * process and `capability.approve` verifies in the long-lived `gateway
 * mcp` one, so a per-process key made every such token dead on arrival.
 * Replay protection does not depend on the key's lifetime — it is enforced
 * durably by the minter's own single-use bookkeeping, which is what
 * `./bootstrap.test.ts`'s "second process rejects a token as a replay, not
 * as a bad signature" case pins.
 *
 * **interface-ledger Gap 5, resolution (2026-08-01):** `journal` used to
 * be accepted and deliberately ignored (`_journal`) — the capability store
 * had nothing to journal because nothing in phase 12 wrote an entry
 * directly. It does now: the store is journal-first for every
 * `CapabilityDecision` transition, and refuses the flip outright without a
 * sink. This is the SAME `JournalStore` the minter already writes
 * `approval_token_mint` through, so the mint and the flip it authorises
 * land in one chain, in order.
 */
function buildRealTrustDependencies(
  xdgEnv: XdgEnv,
  projectHash: string,
  journal: JournalStore,
  minter: ApprovalTokenMinter,
): TrustCommandDependencies {
  const storeRoot = resolveCapabilityStoreDir(xdgEnv, projectHash);
  return {
    store: createCapabilityStore(storeRoot, { journal }),
    minter,
    approvalLedger: createApprovalLedger(storeRoot),
  };
}
