/**
 * Construction-time contract for the real Claude Code `EngineAdapter`
 * (roadmap/06-claude-engine-adapter.md).
 *
 * 03's frozen `EngineAdapter` signature (`spawn(packet, profile, adjudicate)`)
 * deliberately carries no host paths, auth material, or SDK plumbing — all of
 * that arrives here, injected by the composition root (the supervisor-side
 * wiring that already provisions per-worker HOME/TMP/CLAUDE_CONFIG_DIR), one
 * adapter instance per worker. This file is the seam shared by every module
 * in this package; it holds types only, no behavior.
 */
import type { Options, SDKMessage, SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import type { JournalStore } from "@eo/journal";
import type { WorkerProvisioning } from "@eo/supervisor";

/**
 * The SDK message stream a `query()` call yields. The real SDK returns its
 * `Query` async generator (which additionally carries control methods);
 * anything satisfying this structural type is accepted so tests can inject a
 * scripted stream replaying `spikes/fixtures/*` transcript shapes without
 * spawning a real engine.
 */
export type SdkMessageStream = AsyncGenerator<SDKMessage, void, unknown>;

/**
 * Injectable stand-in for `@anthropic-ai/claude-agent-sdk`'s `query`. The
 * default is the real SDK function; unit/integration tests substitute a
 * scripted fake. This is the package's single SDK boundary — no other module
 * may call the SDK directly.
 */
export type SdkQueryFunction = (params: {
  readonly prompt: string | AsyncIterable<SDKUserMessage>;
  readonly options?: Options;
}) => SdkMessageStream;

/**
 * Worker auth material, per `docs/engine-baseline.md` §1 (auth decision
 * record): the confirmed-PASS mechanism is copying the owner's
 * `.credentials.json` (0600) into the worker's isolated `CLAUDE_CONFIG_DIR`;
 * a `CLAUDE_CODE_OAUTH_TOKEN` value injected into the worker env is the
 * documented primary path the same record tracks. The adapter supports both;
 * it never chooses independently (roadmap/06 §Risks, risk 9).
 */
export type WorkerAuthMaterial =
  | {
      /** Inject `CLAUDE_CODE_OAUTH_TOKEN` into the worker's (from-scratch) env. */
      readonly kind: "oauthToken";
      readonly token: string;
    }
  | {
      /** Copy this credentials file (0600) into the worker's `CLAUDE_CONFIG_DIR`. */
      readonly kind: "credentialsFile";
      readonly sourcePath: string;
    };

/**
 * Per-worker construction config for `ClaudeEngineAdapter`. One instance per
 * worker: the supervisor constructs the adapter with the concrete paths it
 * provisioned, then calls the frozen `spawn(packet, profile, adjudicate)`.
 */
export interface ClaudeEngineAdapterConfig {
  /**
   * Absolute path of the supervisor-provisioned worktree (07's layout —
   * never `.claude/worktrees/` nor `isolation: "worktree"`, roadmap/06
   * §In scope). Substituted for engine-core's `<worktree>` placeholder in
   * the compiled profile before any engine invocation.
   */
  readonly worktreePath: string;
  /** 05's per-worker HOME/TMP/CLAUDE_CONFIG_DIR provisioning result. */
  readonly provisioning: WorkerProvisioning;
  /** Auth material per the baseline §1 decision record. */
  readonly auth: WorkerAuthMaterial;
  /**
   * Model for this worker. Routing per role is the caller's decision
   * (balanced defaults per adaptation §0; 13 owns dispatch); the adapter
   * only applies the value. Defaults to the balanced implementation-worker
   * model when omitted.
   */
  readonly model?: string;
  /** Role preamble appended to the `claude_code` system-prompt preset. */
  readonly rolePreamble?: string;
  /**
   * Journal used for this package's own entries: the pre-spawn
   * `session_assignment` record and SessionEnd `evidence_pointer` capture.
   * (`adjudication_decision` entries are written by 05's adjudication bus,
   * which owns its own journal handle.)
   */
  readonly journal: JournalStore;
  /** Correlation ids stamped on journal entries this adapter writes. */
  readonly runId?: string;
  /**
   * Test seam for the SDK boundary. Defaults to the real SDK `query`.
   * The `@live` suite is the only place the default runs against a real
   * engine in CI.
   */
  readonly sdkQuery?: SdkQueryFunction;
  /**
   * Override for the gateway MCP server process entry (tests point this at
   * a stub). The default is the external `engineering-orchestrator gateway
   * mcp` stdio process (ledger Gap 2), keyed by `GATEWAY_MCP_SERVER_NAME`
   * (ledger Gap 11) — never an in-process import of packages/gateway.
   */
  readonly gatewayServerOverride?: Readonly<Record<string, unknown>>;
  /**
   * Override for the engine executable path (SDK `pathToClaudeCodeExecutable`).
   * Default: the SDK's own bundled engine, which the exact dependency pin
   * makes reproducible.
   */
  readonly pathToClaudeCodeExecutable?: string;
  /**
   * Test seam for engine-version resolution. Default: derive the bundled
   * engine version from the exact-pinned SDK package version (the CLI/SDK
   * version pairing `docs/engine-baseline.md` records: 2.1.210 ↔ 0.3.210).
   * The version gate consumes this value; `spawn`/`resume` refuse outside
   * the baseline's accepted range before any engine invocation.
   */
  readonly engineVersionResolver?: () => string;
}
