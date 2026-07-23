/**
 * `@live` conformance-suite harness (roadmap/06 work item 6, ledger Gap 15;
 * README decision 11). This is the ONLY shared machinery every
 * `*.live.test.ts` file composes:
 *
 *  - `EO_LIVE` gate — every live file fails RED (never skips) without it, so
 *    the `engine-live` CI job goes red rather than vacuously green.
 *  - Auth resolution (baseline §1 order): `CLAUDE_CODE_OAUTH_TOKEN` env →
 *    `~/.claude/.eo-oauth-token` (0600, read at runtime, never
 *    logged/persisted) → copy `~/.claude/.credentials.json` into each
 *    probe's isolated scratch `CLAUDE_CONFIG_DIR` via this package's own
 *    `provisionWorkerAuth`.
 *  - Scratch worktree/HOME/TMP/CLAUDE_CONFIG_DIR provisioning under
 *    `os.tmpdir()`, deleted in `finally`.
 *  - Canary + rate-limit guard (baseline §8, W2's `rate-limit` module): the
 *    suite's first live call is one minimal invocation whose
 *    `rate_limit_event` stream is parsed; ABORT the batch if status is not
 *    `allowed`/`allowed_warning`, or utilization ≥ 0.85, or any `rejected`.
 *  - Version-drift check (live half of `version-gate.test`): the observed
 *    `system/init` `claude_code_version` and the adapter's
 *    `capabilities().engineVersion` must both be exactly the tested version
 *    and inside the accepted range.
 *  - Executed-call guard (baseline §2's rewritten pattern): a probe asserting
 *    on ABSENCE must first prove the probing call actually ran.
 *  - Sanitization scan (spikes' discipline, baseline §12): every persisted
 *    artifact carries zero `sk-ant-` shapes, zero OAuth token blobs, zero
 *    literal `$HOME` strings, and zero registered live-secret substrings.
 *  - `suiteDigest`, live-run-record writer + journal `evidence_pointer`
 *    append (consumed by 14's `engine-conformance` gate), and the
 *    deterministic verdict writer the parity fixture locks against.
 *
 * NO `console.log`: this harness collects structured results and persists
 * them to JSON/records; test names + `expect` carry human-facing progress.
 */
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash, randomUUID } from "node:crypto";
import { query } from "@anthropic-ai/claude-agent-sdk";
import type { McpStdioServerConfig, Options, SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { createJournalStore, type JournalStore } from "@eo/journal";
import { CURRENT_SCHEMA_VERSION } from "@eo/contracts";
import { assertNoFootguns } from "@eo/engine-core";
import type { EngineEvent } from "@eo/engine-core";
import { CONFORMANCE_FIXTURES, resolveConformanceFixture } from "@eo/testkit";
import type { ConformanceFixture } from "@eo/testkit";
import type { ClaudeEngineAdapterConfig, WorkerAuthMaterial } from "../adapter-config.js";
import { ClaudeEngineAdapter } from "../adapter.js";
import { buildWorkerEnv, provisionWorkerAuth } from "../auth.js";
import {
  ACCEPTED_ENGINE_VERSION_RANGE,
  TESTED_ENGINE_VERSION,
  assertEngineVersionAccepted,
} from "../version-gate.js";
import { rateLimitEventToLimitSignal } from "../limit-signal.js";

// ---------------------------------------------------------------------------
// Typed errors
// ---------------------------------------------------------------------------

export class LiveEnvNotEnabledError extends Error {
  constructor() {
    super(
      "EO_LIVE is not set to '1' — the @live conformance suite refuses to run and MUST fail red, " +
        "never skip silently (the engine-live CI job must go red, not vacuously green, without it).",
    );
    this.name = "LiveEnvNotEnabledError";
  }
}

export class LiveAuthUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LiveAuthUnavailableError";
  }
}

export class LiveRateLimitAbortError extends Error {
  constructor(message: string) {
    super(`live suite aborted for rate-limit safety: ${message}`);
    this.name = "LiveRateLimitAbortError";
  }
}

export class LiveVersionDriftError extends Error {
  constructor(message: string) {
    super(`live engine version drift: ${message}`);
    this.name = "LiveVersionDriftError";
  }
}

export class LiveSanitizationError extends Error {
  constructor(readonly hits: readonly string[]) {
    super(`sanitization scan found forbidden secret-shaped content: ${hits.join(", ")}`);
    this.name = "LiveSanitizationError";
  }
}

export class ExecutedCallGuardError extends Error {
  constructor(message: string) {
    super(
      `executed-call guard failed: ${message} — an absence assertion is only sound when the ` +
        "probing call demonstrably ran (docs/engine-baseline.md §2).",
    );
    this.name = "ExecutedCallGuardError";
  }
}

// ---------------------------------------------------------------------------
// EO_LIVE gate
// ---------------------------------------------------------------------------

/** Non-throwing predicate: `true` iff `EO_LIVE=1`. Used anywhere a throw is unsafe (e.g. a module-level `afterAll`, which vitest runs even when `beforeAll` threw). */
export function isLiveEnabled(): boolean {
  return process.env.EO_LIVE === "1";
}

/** Throws `LiveEnvNotEnabledError` unless `EO_LIVE=1`. Call in every live file's `beforeAll`. */
export function assertLiveEnabled(): void {
  if (!isLiveEnabled()) {
    throw new LiveEnvNotEnabledError();
  }
}

// ---------------------------------------------------------------------------
// Cost-guard constants (all live workers: haiku, tiny prompts, low maxTurns)
// ---------------------------------------------------------------------------

export const LIVE_MODEL = "haiku";
export const LIVE_MAX_TURNS = 4;
/** Rate-limit utilization at/above which the batch aborts (task LIVE-RUN SAFETY). */
export const RATE_LIMIT_ABORT_UTILIZATION = 0.85;

// ---------------------------------------------------------------------------
// Secret registry + sanitization scan (spikes' discipline, baseline §12)
// ---------------------------------------------------------------------------

const registeredSecrets = new Set<string>();

/** Registers a live secret substring (an OAuth token, a masked value) that must never appear in any persisted artifact. Held in memory only, never persisted. */
export function registerSecret(secret: string): void {
  if (secret.length >= 4) {
    registeredSecrets.add(secret);
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export interface SanitizationHit {
  readonly name: string;
  readonly count: number;
}

/** Scans `text` for `sk-ant-` token shapes, OAuth token blobs, the literal `$HOME` path, and every registered live secret. */
export function scanForSecrets(text: string): readonly SanitizationHit[] {
  const home = process.env.HOME;
  const patterns: ReadonlyArray<{ readonly name: string; readonly re: RegExp }> = [
    { name: "sk-ant token", re: /sk-ant-[a-zA-Z0-9_-]{10,}/g },
    {
      name: "oauth access/refresh token blob",
      re: /"(accessToken|refreshToken)"\s*:\s*"[^"]{10,}"/g,
    },
    ...(home !== undefined && home.length > 0
      ? [{ name: "$HOME path leak", re: new RegExp(escapeRegExp(home), "g") }]
      : []),
  ];
  const hits: SanitizationHit[] = [];
  for (const { name, re } of patterns) {
    const matches = text.match(re);
    if (matches !== null) {
      hits.push({ name, count: matches.length });
    }
  }
  for (const secret of registeredSecrets) {
    const matches = text.match(new RegExp(escapeRegExp(secret), "g"));
    if (matches !== null) {
      hits.push({ name: "registered live secret", count: matches.length });
    }
  }
  return hits;
}

/** Throws `LiveSanitizationError` if `text` carries any forbidden secret-shaped content. */
export function assertSanitized(text: string): void {
  const hits = scanForSecrets(text);
  if (hits.length > 0) {
    throw new LiveSanitizationError(hits.map((hit) => `${hit.name}×${String(hit.count)}`));
  }
}

// ---------------------------------------------------------------------------
// Auth resolution (baseline §1 order)
// ---------------------------------------------------------------------------

const HOME_DIR = process.env.HOME ?? "";
const OAUTH_HANDOFF_FILE = join(HOME_DIR, ".claude", ".eo-oauth-token");
const REAL_CREDENTIALS_FILE = join(HOME_DIR, ".claude", ".credentials.json");

/**
 * Resolves worker auth material in the baseline §1 order:
 * `CLAUDE_CODE_OAUTH_TOKEN` env → `~/.claude/.eo-oauth-token` (0600, read at
 * runtime) → `~/.claude/.credentials.json` copy. An OAuth token value is
 * registered as a secret so the sanitization scan catches any accidental
 * persistence; it is otherwise never logged or written anywhere.
 */
export function resolveWorkerAuthMaterial(): WorkerAuthMaterial {
  const envToken = process.env.CLAUDE_CODE_OAUTH_TOKEN;
  if (typeof envToken === "string" && envToken.length > 0) {
    registerSecret(envToken);
    return { kind: "oauthToken", token: envToken };
  }
  if (existsSync(OAUTH_HANDOFF_FILE)) {
    const mode = statSync(OAUTH_HANDOFF_FILE).mode & 0o777;
    if (mode !== 0o600) {
      throw new LiveAuthUnavailableError(
        `~/.claude/.eo-oauth-token exists but its mode is ${mode.toString(8)}, expected 0600 (refusing to read a world-/group-readable token).`,
      );
    }
    const token = readFileSync(OAUTH_HANDOFF_FILE, "utf8").trim();
    if (token.length === 0) {
      throw new LiveAuthUnavailableError("~/.claude/.eo-oauth-token is empty.");
    }
    registerSecret(token);
    return { kind: "oauthToken", token };
  }
  if (existsSync(REAL_CREDENTIALS_FILE)) {
    return { kind: "credentialsFile", sourcePath: REAL_CREDENTIALS_FILE };
  }
  throw new LiveAuthUnavailableError(
    "no auth material available: CLAUDE_CODE_OAUTH_TOKEN unset, ~/.claude/.eo-oauth-token absent, " +
      "and ~/.claude/.credentials.json absent (docs/engine-baseline.md §1).",
  );
}

// ---------------------------------------------------------------------------
// Scratch provisioning (os.tmpdir, deleted in finally)
// ---------------------------------------------------------------------------

export interface LiveScratch {
  readonly root: string;
  readonly worktreePath: string;
  readonly homeDir: string;
  readonly tmpDir: string;
  readonly configDir: string;
  cleanup(): Promise<void>;
}

/**
 * Creates an isolated `os.tmpdir()` scratch tree: a worktree, a HOME, a TMP,
 * and a `CLAUDE_CONFIG_DIR`. `seedOwnedRelPath`, when given, is created inside
 * the worktree with an optional seed file — used by the path-anchor probe.
 */
export async function createLiveScratch(opts?: {
  readonly seedOwnedRelPath?: string;
  readonly seedFileName?: string;
  readonly seedFileContent?: string;
}): Promise<LiveScratch> {
  const root = await mkdtemp(join(tmpdir(), "eo-live-"));
  const worktreePath = join(root, "worktree");
  const homeDir = join(root, "home");
  const tmpDir = join(root, "tmp");
  const configDir = join(root, "config");
  await Promise.all([
    mkdir(worktreePath, { recursive: true }),
    mkdir(homeDir, { recursive: true }),
    mkdir(tmpDir, { recursive: true }),
    mkdir(configDir, { recursive: true }),
  ]);
  if (opts?.seedOwnedRelPath !== undefined) {
    const ownedDir = join(worktreePath, opts.seedOwnedRelPath);
    await mkdir(ownedDir, { recursive: true });
    if (opts.seedFileName !== undefined) {
      await writeFile(join(ownedDir, opts.seedFileName), opts.seedFileContent ?? "", "utf8");
    }
  }
  return {
    root,
    worktreePath,
    homeDir,
    tmpDir,
    configDir,
    cleanup: async () => {
      await rm(root, { recursive: true, force: true });
    },
  };
}

// ---------------------------------------------------------------------------
// Gateway stub (the sanctioned gatewayServerOverride seam — see the stub's own
// doc comment for why a real MCP handshake beats a nonexistent command here)
// ---------------------------------------------------------------------------

const HARNESS_DIR = dirname(fileURLToPath(import.meta.url));
const STUB_MCP_SERVER_PATH = join(HARNESS_DIR, "fixtures", "stub-mcp-server.mjs");

/** A gateway `mcpServers` entry value pointing at the in-repo stub MCP server (node runs it). */
export const LIVE_GATEWAY_OVERRIDE: McpStdioServerConfig = {
  type: "stdio",
  command: process.execPath,
  args: [STUB_MCP_SERVER_PATH],
};

// ---------------------------------------------------------------------------
// Live adapter context (real ClaudeEngineAdapter, DEFAULT sdkQuery)
// ---------------------------------------------------------------------------

export interface LiveAdapterContext {
  readonly adapter: ClaudeEngineAdapter;
  readonly config: ClaudeEngineAdapterConfig;
  readonly scratch: LiveScratch;
  readonly journal: JournalStore;
  cleanup(): Promise<void>;
}

/**
 * Builds a real `ClaudeEngineAdapter` over the DEFAULT SDK `query` (proving
 * OUR wiring, not re-proving spikes) with fresh scratch dirs, resolved auth,
 * a temp journal, `model: "haiku"`, and the gateway pointed at the stub. Every
 * live probe that exercises the adapter goes through here.
 */
export async function createLiveAdapterContext(opts?: {
  readonly seedOwnedRelPath?: string;
  readonly seedFileName?: string;
  readonly seedFileContent?: string;
  readonly configOverrides?: Partial<ClaudeEngineAdapterConfig>;
}): Promise<LiveAdapterContext> {
  const scratch = await createLiveScratch(opts);
  const journalDir = join(scratch.root, "journal");
  await mkdir(journalDir, { recursive: true });
  const journal = createJournalStore({ journalDir });
  const auth = resolveWorkerAuthMaterial();
  const config: ClaudeEngineAdapterConfig = {
    worktreePath: scratch.worktreePath,
    provisioning: {
      HOME: scratch.homeDir,
      TMP: scratch.tmpDir,
      CLAUDE_CONFIG_DIR: scratch.configDir,
    },
    auth,
    journal,
    model: LIVE_MODEL,
    gatewayServerOverride: LIVE_GATEWAY_OVERRIDE,
    ...opts?.configOverrides,
  };
  const adapter = new ClaudeEngineAdapter(config);
  return {
    adapter,
    config,
    scratch,
    journal,
    cleanup: async () => {
      await scratch.cleanup();
    },
  };
}

// ---------------------------------------------------------------------------
// Direct minimal query (spike-style probes needing tools the compiled profile
// denies — curl/echo/cat — which cannot go through the real adapter's profile)
// ---------------------------------------------------------------------------

export interface DirectQuerySpec {
  readonly prompt: string;
  readonly cwd: string;
  readonly configDir: string;
  readonly homeDir: string;
  readonly tmpDir: string;
  readonly allow?: readonly string[];
  readonly settings?: Record<string, unknown>;
  readonly sandbox?: Options["sandbox"];
  readonly maxTurns?: number;
  readonly extraEnv?: Readonly<Record<string, string>>;
  readonly timeoutMs?: number;
}

export interface DirectQueryResult {
  readonly messages: readonly SDKMessage[];
  readonly threw: string | undefined;
  readonly timedOut: boolean;
}

/**
 * Runs a minimal direct SDK `query()` (auth via this package's own
 * `provisionWorkerAuth`/`buildWorkerEnv`, `settingSources: []`, `haiku`) and
 * collects raw `SDKMessage`s. Used only by the sandbox/hermeticity probes
 * that need a permission shape the compiled profile deliberately forbids
 * (curl/echo/cat) — every adapter-wiring probe uses `createLiveAdapterContext`.
 */
export async function runDirectQuery(
  auth: WorkerAuthMaterial,
  spec: DirectQuerySpec,
): Promise<DirectQueryResult> {
  const authEnv = await provisionWorkerAuth(auth, spec.configDir);
  const env = buildWorkerEnv({
    hostPath: process.env.PATH ?? "",
    provisioning: { HOME: spec.homeDir, TMP: spec.tmpDir, CLAUDE_CONFIG_DIR: spec.configDir },
    authEnv: { ...authEnv, ...spec.extraEnv },
  });
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, spec.timeoutMs ?? 90_000);
  timer.unref?.();
  const messages: SDKMessage[] = [];
  let threw: string | undefined;
  try {
    const options: Options = {
      settingSources: [],
      cwd: spec.cwd,
      env,
      model: LIVE_MODEL,
      maxTurns: spec.maxTurns ?? 2,
      permissionMode: "dontAsk",
      abortController: controller,
      ...(spec.allow !== undefined || spec.settings !== undefined
        ? { settings: { permissions: { allow: [...(spec.allow ?? [])] }, ...spec.settings } }
        : {}),
      ...(spec.allow !== undefined ? { allowedTools: [...spec.allow] } : {}),
      ...(spec.sandbox !== undefined ? { sandbox: spec.sandbox } : {}),
    };
    for await (const message of query({ prompt: spec.prompt, options })) {
      messages.push(message);
    }
  } catch (error) {
    threw = error instanceof Error ? error.message : String(error);
  } finally {
    clearTimeout(timer);
  }
  return { messages, threw, timedOut: controller.signal.aborted };
}

// ---------------------------------------------------------------------------
// Stream helpers
// ---------------------------------------------------------------------------

/** Drains an `AsyncIterable` of `EngineEvent`s into an array (the adapter handle's `events`). */
export async function collectEngineEvents(
  events: AsyncIterable<EngineEvent>,
): Promise<EngineEvent[]> {
  const out: EngineEvent[] = [];
  for await (const event of events) {
    out.push(event);
  }
  return out;
}

/** The raw `Bash` command strings a direct-query transcript actually attempted (assistant `tool_use` blocks). */
export function bashCommandsAttempted(messages: readonly SDKMessage[]): readonly string[] {
  const commands: string[] = [];
  for (const message of messages) {
    if (message.type !== "assistant") {
      continue;
    }
    const content: unknown = (message as { readonly message?: { readonly content?: unknown } })
      .message?.content;
    if (!Array.isArray(content)) {
      continue;
    }
    for (const block of content) {
      const typed = block as {
        readonly type?: unknown;
        readonly name?: unknown;
        readonly input?: unknown;
      };
      if (typed.type === "tool_use" && typed.name === "Bash") {
        const command = (typed.input as { readonly command?: unknown } | null)?.command;
        if (typeof command === "string") {
          commands.push(command);
        }
      }
    }
  }
  return commands;
}

/** Concatenation of every `tool_result` block's text across a direct-query transcript. */
export function toolResultText(messages: readonly SDKMessage[]): string {
  const parts: string[] = [];
  for (const message of messages) {
    if (message.type !== "user") {
      continue;
    }
    const content: unknown = (message as { readonly message?: { readonly content?: unknown } })
      .message?.content;
    if (!Array.isArray(content)) {
      continue;
    }
    for (const block of content) {
      const typed = block as { readonly type?: unknown; readonly content?: unknown };
      if (typed.type === "tool_result") {
        parts.push(
          typeof typed.content === "string" ? typed.content : JSON.stringify(typed.content),
        );
      }
    }
  }
  return parts.join("\n");
}

/** The whole transcript serialized (for substring-presence assertions — masked secrets, planted tokens). */
export function transcriptText(messages: readonly SDKMessage[]): string {
  return messages.map((message) => JSON.stringify(message)).join("\n");
}

/** The `system/init` message from a raw transcript, or `undefined`. */
export function findInitMessage(
  messages: readonly SDKMessage[],
):
  | (SDKMessage & { readonly claude_code_version?: string; readonly tools?: readonly string[] })
  | undefined {
  return messages.find(
    (message) => message.type === "system" && (message as { subtype?: unknown }).subtype === "init",
  ) as never;
}

/** The `result` message from a raw transcript, or `undefined`. */
export function findResultMessage(messages: readonly SDKMessage[]): SDKMessage | undefined {
  return messages.find((message) => message.type === "result");
}

// ---------------------------------------------------------------------------
// Rate-limit guards (baseline §8; W2's limit-signal module)
// ---------------------------------------------------------------------------

export interface RateLimitSnapshot {
  readonly statuses: readonly string[];
  readonly maxUtilization: number;
}

/** Extracts + normalizes every `rate_limit_event` in a raw transcript via `rateLimitEventToLimitSignal`. */
export function snapshotRateLimit(messages: readonly SDKMessage[]): RateLimitSnapshot {
  const statuses: string[] = [];
  let maxUtilization = 0;
  for (const message of messages) {
    if (message.type !== "rate_limit_event") {
      continue;
    }
    const signal = rateLimitEventToLimitSignal(
      message as Parameters<typeof rateLimitEventToLimitSignal>[0],
      "live-canary",
    );
    statuses.push(signal.status);
    if (typeof signal.utilization === "number" && signal.utilization > maxUtilization) {
      maxUtilization = signal.utilization;
    }
  }
  return { statuses, maxUtilization };
}

function assertRateLimitSafe(snapshot: RateLimitSnapshot): void {
  for (const status of snapshot.statuses) {
    if (status === "rejected") {
      throw new LiveRateLimitAbortError('a rate_limit_event reported status "rejected".');
    }
    if (status !== "allowed" && status !== "allowed_warning") {
      throw new LiveRateLimitAbortError(
        `a rate_limit_event reported an unexpected status "${status}".`,
      );
    }
  }
  if (snapshot.maxUtilization >= RATE_LIMIT_ABORT_UTILIZATION) {
    throw new LiveRateLimitAbortError(
      `utilization ${snapshot.maxUtilization.toFixed(2)} ≥ ${RATE_LIMIT_ABORT_UTILIZATION.toFixed(2)} — refusing to press a hot subscription window.`,
    );
  }
}

/** Mid-suite guard: any probe calls this on its raw transcript to abort the batch if a `rejected` (or high-utilization) signal appears. */
export function guardRawRateLimit(messages: readonly SDKMessage[]): void {
  assertRateLimitSafe(snapshotRateLimit(messages));
}

/** Mid-suite guard over normalized adapter events: abort if any `limitSignal` is `rejected` or high-utilization. */
export function guardEngineEventsRateLimit(events: readonly EngineEvent[]): void {
  const statuses: string[] = [];
  let maxUtilization = 0;
  for (const event of events) {
    if (event.type === "limitSignal") {
      statuses.push(event.status);
      if (typeof event.utilization === "number" && event.utilization > maxUtilization) {
        maxUtilization = event.utilization;
      }
    }
  }
  assertRateLimitSafe({ statuses, maxUtilization });
}

// ---------------------------------------------------------------------------
// Canary + version-drift check
// ---------------------------------------------------------------------------

export interface CanaryResult {
  readonly engineVersion: string;
  readonly capabilitiesEngineVersion: string;
  readonly rateLimit: RateLimitSnapshot;
  /** Live invocations this canary consumed (always exactly 1). */
  readonly invocations: number;
}

/**
 * The suite's mandatory first live call (task LIVE-RUN SAFETY): one minimal
 * `haiku`/`maxTurns:1` invocation. Parses its `rate_limit_event` stream and
 * ABORTS (typed `LiveRateLimitAbortError`) unless every status is
 * `allowed`/`allowed_warning` and utilization < 0.85; asserts the observed
 * `system/init` `claude_code_version` and the adapter's
 * `capabilities().engineVersion` both equal the tested version and sit inside
 * the accepted range (`LiveVersionDriftError` otherwise).
 */
export async function runCanary(): Promise<CanaryResult> {
  const scratch = await createLiveScratch();
  const auth = resolveWorkerAuthMaterial();
  try {
    const result = await runDirectQuery(auth, {
      prompt: "Reply with the single word: ok",
      cwd: scratch.worktreePath,
      configDir: scratch.configDir,
      homeDir: scratch.homeDir,
      tmpDir: scratch.tmpDir,
      maxTurns: 1,
      timeoutMs: 120_000,
    });
    if (result.threw !== undefined) {
      throw new LiveRateLimitAbortError(
        `canary query() threw before establishing a stream: ${result.threw}`,
      );
    }
    const rateLimit = snapshotRateLimit(result.messages);
    assertRateLimitSafe(rateLimit);

    const init = findInitMessage(result.messages);
    const observedVersion = init?.claude_code_version;
    if (typeof observedVersion !== "string") {
      throw new LiveVersionDriftError(
        "the canary's system/init message carried no string claude_code_version.",
      );
    }
    assertEngineVersionAccepted(observedVersion);
    if (observedVersion !== TESTED_ENGINE_VERSION) {
      throw new LiveVersionDriftError(
        `observed engine version ${observedVersion} ≠ tested ${TESTED_ENGINE_VERSION} ` +
          `(accepted range ${ACCEPTED_ENGINE_VERSION_RANGE.min}–${ACCEPTED_ENGINE_VERSION_RANGE.max}).`,
      );
    }

    const capabilitiesEngineVersion = await resolveCapabilitiesEngineVersion();
    if (capabilitiesEngineVersion !== observedVersion) {
      throw new LiveVersionDriftError(
        `capabilities().engineVersion ${capabilitiesEngineVersion} ≠ observed init version ${observedVersion}.`,
      );
    }

    return { engineVersion: observedVersion, capabilitiesEngineVersion, rateLimit, invocations: 1 };
  } finally {
    await scratch.cleanup();
  }
}

// Run-scoped canary memo: vitest isolates test files into separate module
// graphs, so a module-level flag alone would re-run the canary once PER FILE.
// A short-lived `os.tmpdir()` marker shares one canary across every file of a
// single `npm run test:live` invocation (and any file more than
// `CANARY_FRESH_MS` after it conservatively re-guards). The marker carries no
// secrets — only version strings + rate-limit statuses.
const CANARY_MARKER_PATH = join(tmpdir(), "eo-live-canary-marker.json");
const CANARY_FRESH_MS = 5 * 60 * 1000;
let canaryMemo: CanaryResult | undefined;

/**
 * The rate-limit/version guard every live file calls in `beforeAll`. Runs the
 * real `runCanary()` at most once per suite run (memoized in-process and via a
 * fresh `os.tmpdir()` marker); a `LiveRateLimitAbortError`/`LiveVersionDrift
 * Error` from the canary propagates and fails that file's `beforeAll` red.
 */
export async function ensureCanary(): Promise<CanaryResult> {
  if (canaryMemo !== undefined) {
    return canaryMemo;
  }
  try {
    if (existsSync(CANARY_MARKER_PATH)) {
      const raw = JSON.parse(readFileSync(CANARY_MARKER_PATH, "utf8")) as {
        readonly at: number;
        readonly result: CanaryResult;
      };
      if (Date.now() - raw.at < CANARY_FRESH_MS) {
        canaryMemo = raw.result;
        return raw.result;
      }
    }
  } catch {
    // A corrupt/unreadable marker just means we run a fresh canary below.
  }
  const result = await runCanary();
  canaryMemo = result;
  try {
    writeFileSync(CANARY_MARKER_PATH, JSON.stringify({ at: Date.now(), result }));
  } catch {
    // Best-effort cross-file cache; a failure here only costs an extra canary.
  }
  return result;
}

/** The real adapter's `capabilities().engineVersion` (offline: derived from the exact-pinned SDK package version). */
export async function resolveCapabilitiesEngineVersion(): Promise<string> {
  const ctx = await createLiveAdapterContext();
  try {
    return ctx.adapter.capabilities().engineVersion;
  } finally {
    await ctx.cleanup();
  }
}

// ---------------------------------------------------------------------------
// Executed-call guard (baseline §2's rewritten pattern)
// ---------------------------------------------------------------------------

/** Asserts at least one `Bash` command matching `predicate` was actually attempted in a direct-query transcript. */
export function assertBashAttempted(
  messages: readonly SDKMessage[],
  predicate: (command: string) => boolean,
  context: string,
): void {
  const attempted = bashCommandsAttempted(messages).filter(predicate);
  if (attempted.length === 0) {
    throw new ExecutedCallGuardError(
      `no Bash tool_use matching the expected shape was attempted for: ${context}`,
    );
  }
}

/** Asserts at least one adapter `toolUse` event matching `predicate` was actually emitted (the probing call ran). */
export function assertToolUseEmitted(
  events: readonly EngineEvent[],
  predicate: (event: Extract<EngineEvent, { type: "toolUse" }>) => boolean,
  context: string,
): void {
  const matched = events.some((event) => event.type === "toolUse" && predicate(event));
  if (!matched) {
    throw new ExecutedCallGuardError(`no adapter toolUse event was emitted for: ${context}`);
  }
}

// ---------------------------------------------------------------------------
// suiteDigest + live-run-record + verdict writer
// ---------------------------------------------------------------------------

const LIVE_DIR = HARNESS_DIR;
const LIVE_RUN_RECORD_PATH = resolve(HARNESS_DIR, "..", "..", "live-run-record.json");
export const LIVE_VERDICTS_PATH = join(HARNESS_DIR, "fixtures", "live-verdicts.json");

/** SHA-256 (hex) over the sorted-by-name bytes of every `src/live/*.live.test.ts` file. */
export function computeSuiteDigest(): string {
  const files = readdirSync(LIVE_DIR)
    .filter((name) => name.endsWith(".live.test.ts"))
    .sort();
  const hash = createHash("sha256");
  for (const name of files) {
    hash.update(readFileSync(join(LIVE_DIR, name)));
  }
  return hash.digest("hex");
}

export interface LiveRunRecord {
  readonly engineVersion: string;
  readonly runId: string;
  readonly suiteDigest: string;
}

/**
 * Writes `packages/engine-claude/live-run-record.json`
 * (`{engineVersion, runId, suiteDigest}` — consumed by 14's
 * `engine-conformance` gate) and appends a journal `evidence_pointer`
 * recording the green run (mirroring W3's `EvidenceRecordSchema`-shoehorn
 * precedent, documented in `hooks.ts`). The record file is sanitization-
 * scanned before it is trusted. `runId` = `EO_LIVE_RUN_ID` env || a fresh UUID.
 */
export async function writeLiveRunRecord(params: {
  readonly engineVersion: string;
  readonly journal: JournalStore;
  readonly workUnitId: string;
}): Promise<LiveRunRecord> {
  const record: LiveRunRecord = {
    engineVersion: params.engineVersion,
    runId: process.env.EO_LIVE_RUN_ID ?? randomUUID(),
    suiteDigest: computeSuiteDigest(),
  };
  const serialized = `${JSON.stringify(record, Object.keys(record).sort(), 2)}\n`;
  assertSanitized(serialized);
  await writeFile(LIVE_RUN_RECORD_PATH, serialized, "utf8");

  // Journal evidence_pointer append (EvidenceRecordSchema shoehorn — see
  // hooks.ts's createSessionEndEvidenceHook for the field-fit rationale this
  // mirrors: EvidenceRecordSchema is shaped around 14's gate-firing evidence,
  // not a live-run record, so command/exitStatus/objectId/toolchainFingerprint
  // are documented schema-fit choices and artifactDigests carries the actual
  // record pointer).
  await params.journal.appendEntry({
    type: "evidence_pointer",
    workUnitId: params.workUnitId,
    payload: {
      schemaVersion: CURRENT_SCHEMA_VERSION,
      id: randomUUID(),
      changeSetId: params.workUnitId,
      workUnitId: params.workUnitId,
      command: "engine-claude:@live conformance suite",
      exitStatus: 0,
      toolchainFingerprint: `@anthropic-ai/claude-agent-sdk engine ${record.engineVersion}`,
      capturedAt: new Date().toISOString(),
      artifactDigests: [`live-run-record.json#suiteDigest=${record.suiteDigest}`],
      objectId: record.runId,
    },
  });
  return record;
}

export type FixtureLiveVerdict = "allow" | "deny";

export interface RecordedFixtureVerdict {
  readonly verdict: FixtureLiveVerdict;
  readonly mechanism: string;
  readonly detail: string;
}

/** Which of the two enforcement mechanisms denies a `CONFORMANCE_FIXTURES` entry (see `classifyFixtureDenyMechanism`). */
export type FixtureDenyMechanism = "adapter-footgun-gate" | "engine-permission-deny";

/**
 * The `RecordedFixtureVerdict.detail` for a fixture whose raw profile fails
 * the compiler's own `assertNoFootguns` invariant: the real adapter's
 * synchronous `spawn`-time gate refuses it before any engine invocation.
 * Single source of truth for both the live suite (`envelope-conformance.
 * live.test.ts`) and the offline baseline derivation below.
 */
export const ADAPTER_GATE_DETAIL =
  "real ClaudeEngineAdapter.spawn refused the raw fixture profile at its synchronous " +
  "assertNoFootguns gate, before any engine invocation";

/**
 * The `RecordedFixtureVerdict.detail` for a footgun-clean fixture: the pinned
 * engine itself denies the attempted out-of-owned-path tool call, recorded in
 * `permission_denials` (executed-call guarded). Single source of truth for
 * both the live suite and the offline baseline derivation below.
 */
export const ENGINE_DENY_DETAIL =
  "the pinned engine recorded a permission denial for the attempted out-of-owned-path tool call " +
  "(executed-call guarded)";

/**
 * Classifies which enforcement mechanism denies `fixture`: a raw profile that
 * fails `assertNoFootguns` is refused by the real adapter's synchronous gate
 * before any engine call ("adapter-footgun-gate"); a footgun-clean profile
 * reaches the engine, which denies it at its own permission layer
 * ("engine-permission-deny"). Shared by the live suite (which fixtures it
 * actually observes each mechanism for) and `deriveOfflineBaselineVerdicts`
 * below, so the live classification and the offline derivation cannot drift
 * apart.
 */
export function classifyFixtureDenyMechanism(fixture: ConformanceFixture): FixtureDenyMechanism {
  try {
    assertNoFootguns(resolveConformanceFixture(fixture).profile);
    return "engine-permission-deny";
  } catch {
    return "adapter-footgun-gate";
  }
}

function fixtureIsOverallDeny(fixture: ConformanceFixture): boolean {
  const { permissions, adjudication, sandbox } = fixture.expected;
  return permissions === "deny" || adjudication === "deny" || sandbox === "deny";
}

/**
 * Derives a deterministic OFFLINE baseline verdict for each of the 7
 * `CONFORMANCE_FIXTURES` — no engine spawn, no auth required. All 7 fixtures
 * are baseline-derived overall-`deny` (asserted below, never assumed
 * silently); `mechanism` is whatever `classifyFixtureDenyMechanism` computes
 * and `detail` is the matching exported constant. Used to regenerate
 * `live-verdicts.json` byte-reproducibly offline whenever it is
 * missing/corrupted (e.g. a guarded-against `afterAll` no-op run), and by
 * `fake-live-parity.test`'s committed-mechanism corruption/regression guard.
 */
export function deriveOfflineBaselineVerdicts(): Map<string, RecordedFixtureVerdict> {
  const verdicts = new Map<string, RecordedFixtureVerdict>();
  for (const fixture of CONFORMANCE_FIXTURES) {
    if (!fixtureIsOverallDeny(fixture)) {
      throw new Error(
        `deriveOfflineBaselineVerdicts assumption violated: fixture "${fixture.name}" is not overall-deny`,
      );
    }
    const mechanism = classifyFixtureDenyMechanism(fixture);
    verdicts.set(fixture.name, {
      verdict: "deny",
      mechanism,
      detail: mechanism === "adapter-footgun-gate" ? ADAPTER_GATE_DETAIL : ENGINE_DENY_DETAIL,
    });
  }
  return verdicts;
}

export type LiveVerdictsSource = "live" | "offline-baseline";

/**
 * Writes the COMMITTED, sanitized, deterministically key-sorted
 * `src/live/fixtures/live-verdicts.json` the offline `fake-live-parity.test`
 * locks fake-engine verdicts against verdict-for-verdict. `source` records
 * this payload's provenance: `"live"` from a green `@live` conformance run,
 * `"offline-baseline"` from `deriveOfflineBaselineVerdicts` — machine-
 * checkable so the committed file's honesty never has to be taken on faith.
 */
export async function writeLiveVerdicts(
  verdicts: ReadonlyMap<string, RecordedFixtureVerdict>,
  source: LiveVerdictsSource,
): Promise<void> {
  const fixtures: Record<string, RecordedFixtureVerdict> = {};
  for (const name of [...verdicts.keys()].sort()) {
    const value = verdicts.get(name);
    if (value !== undefined) {
      fixtures[name] = value;
    }
  }
  const payload = { engineVersion: TESTED_ENGINE_VERSION, source, fixtures };
  const serialized = `${JSON.stringify(payload, keySorter, 2)}\n`;
  assertSanitized(serialized);
  await writeFile(LIVE_VERDICTS_PATH, serialized, "utf8");
}

/** A stable key-sorting replacer for deterministic JSON output. */
function keySorter(_key: string, value: unknown): unknown {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(record).sort()) {
      sorted[key] = record[key];
    }
    return sorted;
  }
  return value;
}
