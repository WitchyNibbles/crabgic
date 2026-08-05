/**
 * `edit-input-stability.live.test` — R7-P2: does the engine hand the
 * `PostToolUse` hook the **same `tool_input`** it handed `PreToolUse`, for the
 * **`Edit`** tool?
 *
 * WHY THIS ONE TOOL, AND WHY IT MATTERS. `./hooks.ts`'s PostToolUse audit
 * records a violation when a tool that WAS adjudicated at PreToolUse time
 * executes with an input matching none of the adjudicated ones, and
 * `../adapter.ts` then aborts the whole worker with a security-worded
 * `AdjudicationAuditViolationError`. `../tool-adjudication-hook.ts` put
 * `Bash`, `Edit` and `Write` inside that audit's scope
 * (`ADJUDICATED_BUILTIN_TOOLS`), recording the RAW PreToolUse `tool_input`. So
 * if the engine mutates an `Edit`'s `tool_input` between the two hooks, a
 * perfectly legitimate worker dies with a message that reads like an attack —
 * fail-**noisy**, not fail-open. `adjudication-bridge.live.test.ts` measures
 * exactly this for `Bash` (its first case) and for `Write` (its second, whose
 * own comment says so in as many words), and `docs/security-posture.md` states
 * the residual outright: _"Pre→Post `tool_input` stability is measured for
 * `Bash` and `Write` by `adjudication-bridge.live.test.ts`, not for `Edit`."_
 * This file closes that sentence.
 *
 * WHY IT IS A DIFFERENT QUESTION FOR `Edit` THAN FOR `Write`. `Write`'s input
 * is `{file_path, content}` — two members, both supplied by the model. `Edit`
 * takes `{file_path, old_string, new_string}` plus an OPTIONAL `replace_all`,
 * which is precisely the shape where an engine could inject a default, and it
 * is the only one of the three built-ins whose input has an optional member at
 * all. A `Write`-shaped measurement therefore does not generalize to it.
 *
 * THE MEASUREMENT IS STRICTLY STRONGER THAN THE MERGED ONE, deliberately.
 * `adjudication-bridge.live.test.ts` infers stability from an ABSENCE (the
 * worker did not audit-abort), which conflates "the inputs were identical"
 * with "the audit's `deepEqual` happened not to notice the difference" and
 * cannot see a byte-level change at all. This file installs its own
 * `PreToolUse`/`PostToolUse` hooks, captures BOTH payloads, correlates them by
 * the SDK's own `tool_use_id` (which both hook-input types carry, and which
 * the production audit does NOT use — see `hooks.ts`'s KEYING LIMITATION
 * note), and compares them three ways: byte-identical, structurally equal, and
 * — by replaying the real production `createInMemoryAdjudicationAuditLog` +
 * `createPostToolUseAuditHook` over the captured payloads — whether production
 * would actually have aborted. Nothing about the comparison is reconstructed:
 * production compares a PreToolUse payload against a PostToolUse payload, and
 * so does this.
 *
 * VERDICTS, FIXED BEFORE THE RUN so nothing is rationalised afterwards. Two of
 * them, because "the bytes moved" and "production breaks" are different claims
 * and only the second is a defect.
 *
 *   A. BYTE STABILITY of `Edit`'s `tool_input` across the two hooks.
 *      STABLE                  — for EVERY `Edit` tool call with both a Pre and
 *                                a Post payload captured under the SAME
 *                                `tool_use_id`, `JSON.stringify(pre.tool_input)
 *                                === JSON.stringify(post.tool_input)`: identical
 *                                bytes, hence identical members, values AND key
 *                                order. At least one such pair must exist.
 *      UNSTABLE-BYTES-ONLY     — at least one correlated pair whose stringified
 *                                inputs DIFFER, while every pair is still
 *                                structurally equal (the difference is key
 *                                ORDER only).
 *      UNSTABLE-STRUCTURAL     — at least one correlated pair that is not
 *                                structurally equal: a member added, removed or
 *                                changed in value.
 *      INCONCLUSIVE            — zero correlated `Edit` pairs (the tool was
 *                                never attempted, or was refused, or one of the
 *                                two hooks did not fire), or the arm's controls
 *                                did not hold, or the canary aborted, or the
 *                                turn budget was exhausted before the arm ran.
 *
 *   B. PRODUCTION CONSEQUENCE — would the merged audit have aborted the worker?
 *      NO-ABORT     — replaying the real audit over every captured pair records
 *                     ZERO violations. This is what `hooks.ts` and
 *                     `docs/security-posture.md` currently rely on for `Edit`.
 *      ABORT        — the replay records ≥1 violation, i.e. a legitimate
 *                     `Edit` would be killed by `AdjudicationAuditViolation
 *                     Error`. A real defect, and the reason this probe exists.
 *      INCONCLUSIVE — as in A.
 *
 * A is deliberately the stricter question: `deepEqual` in `hooks.ts` is
 * key-order-insensitive, so `UNSTABLE-BYTES-ONLY` + `NO-ABORT` is a coherent
 * and important outcome — it means the audit is tolerant of a real instability
 * rather than that no instability exists. Reporting only B would hide that;
 * reporting only A would overstate it.
 *
 * CONTROLS — every one of them in the SAME run as the measurement, because an
 * absence claim with no control is indistinguishable from a probe that never
 * reached the engine.
 *   C1 (hooks fired at all)      — ≥1 correlated `Edit` pair. Without it every
 *                                  "identical" comparison is over an empty set
 *                                  and STABLE would be vacuously true. This is
 *                                  the executed-call guard (baseline §2) for
 *                                  this file, and it throws
 *                                  `ExecutedCallGuardError`.
 *   C2 (the Edit really ran)     — the seeded file on disk no longer contains
 *                                  the pre-edit marker and does contain the
 *                                  post-edit one. A `PostToolUse` hook only
 *                                  fires after execution, but this pins the
 *                                  effect independently of the hook stream.
 *   C3 (second tool, same run)   — ≥1 correlated `Write` pair, whose stability
 *                                  `adjudication-bridge.live.test.ts` already
 *                                  measured. It makes the capture machinery
 *                                  falsifiable in-run and, if `Edit` turns out
 *                                  unstable, isolates the TOOL from "this engine
 *                                  rewrites every tool_input".
 *   C4 (the audit replay bites)  — REVERSE PROBE, offline, zero turns: the same
 *                                  real audit machinery, fed the captured Pre
 *                                  payload and a deliberately MUTATED Post
 *                                  input, MUST record a violation. Without C4,
 *                                  "the replay found no violation" is
 *                                  unfalsifiable — an audit that never fires
 *                                  would satisfy verdict B equally well.
 *   C5 (key order is tolerated)  — the same replay with the captured input's
 *                                  KEYS REORDERED must record ZERO violations,
 *                                  while `JSON.stringify` of the two differs.
 *                                  This is what makes the A/B split a measured
 *                                  distinction rather than an assertion about
 *                                  `deepEqual` read off its source.
 *
 * SECRECY. Nothing sensitive is in this probe's reach by construction: the only
 * files it touches are ones it seeded itself, inside an `os.tmpdir()` scratch
 * worktree, containing synthetic `R7P2-…-<runtag>` markers and nothing else. No
 * real HOME path, no credential, no user file is read, and the arm reads no path
 * it did not write. There is therefore nothing to register with
 * `registerSecret` that is not already registered: the harness's own
 * `resolveWorkerAuthMaterial` registers the OAuth token it resolves before the
 * first engine call, and the persisted artifact is `assertSanitized`-checked
 * (`sk-ant-` shapes, OAuth token blobs, the literal `$HOME` path, every
 * registered secret) before it is written. Per-arm, the raw transcript's
 * secret-scan hit counts are recorded in the artifact and asserted to be zero
 * for every category except `$HOME path leak`, which is recorded rather than
 * asserted for the reason `read-exposure.live.test.ts` documents: the raw
 * transcript is never persisted, and the host `PATH` the CLI echoes is
 * `$HOME`-shaped without being secret. Every persisted string is redacted
 * (scratch root -> `<scratch>`, home -> the literal text `$HOME`).
 *
 * BUDGET. 12 engine turns for the WHOLE owner-authorized item, canary
 * included, shared with the phase-10 `plugin.live-smoke` run that follows this
 * one. Enforced in code here and carried across processes through
 * `R7P2_PRIOR_TURNS` (the pattern `read-exposure.live.test.ts` established, so
 * the cap is a cap on the PROBE and not on one `vitest` process). This file
 * additionally holds back `PLUGIN_SMOKE_RESERVE` turns for that second run —
 * without the reserve, a cap shared between two processes is spent entirely by
 * whichever runs first. The arm does not start unless
 * `spent + its maxTurns <= LIVE_TURN_BUDGET - PLUGIN_SMOKE_RESERVE`. Aborts on
 * a canary that is not `allowed`/`allowed_warning`, on utilization >= 0.85 or
 * any `rejected` — the harness's own guards, called on the arm's raw
 * transcript. NOT a retry budget: a failed arm is persisted and reported, never
 * re-run.
 *
 * MODEL. `sonnet`, not the suite default `haiku`, for the reason
 * `mcp-adjudication-shadowing.live.test.ts` measured and records: haiku emitted
 * a requested tool call roughly one run in eight, answering in prose instead.
 * Whether the engine mutates a hook payload is an engine-layer property
 * independent of which model emits the `tool_use`, so the model is a free
 * variable — and a prose-only run would spend a third of a non-renewable
 * budget measuring nothing.
 *
 * PROFILE. The compiled `STANDARD_IMPLEMENTATION_ENVELOPE` profile VERBATIM,
 * substituted onto the scratch worktree exactly as
 * `packages/cli/src/daemon/run-dispatcher.ts` ships it — `Edit(//<worktree>/
 * packages/example/src/**)` and its `Write` sibling in `permissions.allow`,
 * every deny entry in `permissions.deny` AND `disallowedTools`, sandbox
 * enabled. Two facts this depends on were measured by
 * `read-exposure.live.test.ts` (artifact
 * `docs/evidence/phase-06/read-exposure-determination.json`) rather than
 * assumed here: under this exact object an in-worktree `Read` SUCCEEDS with
 * `Read` in no allow rule (which is what lets the worker satisfy `Edit`'s
 * read-before-edit precondition), and a rule-shaped owned-path `Write` entry in
 * `allowedTools` really does enable the tool (its ARM-P write control).
 *
 * NO production change is authorized from this file. Its output is evidence.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import type { HookInput, Options, SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import {
  compileEnvelope,
  STANDARD_IMPLEMENTATION_ENVELOPE,
  type CompiledWorkerProfile,
} from "@crabgic/engine-core";
import {
  ExecutedCallGuardError,
  assertLiveEnabled,
  assertSanitized,
  createLiveScratch,
  ensureCanary,
  findInitMessage,
  guardRawRateLimit,
  resolveWorkerAuthMaterial,
  scanForSecrets,
  runDirectQuery,
  transcriptText,
  type LiveScratch,
} from "./live-harness.js";
import { substituteWorktreePlaceholders } from "../options-assembler.js";
import { createInMemoryAdjudicationAuditLog, createPostToolUseAuditHook } from "../hooks.js";
import { ADJUDICATED_BUILTIN_TOOLS } from "../tool-adjudication-hook.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const DETERMINATION_PATH = join(
  HERE,
  "..",
  "..",
  "..",
  "..",
  "docs",
  "evidence",
  "phase-06",
  "edit-input-stability-determination.json",
);

/** The owner's real home — never a target here, and never permitted in an artifact. */
const REAL_HOME = process.env.HOME ?? "";

/**
 * Hard cap on engine turns for the whole owner-authorized R7-P2 item, canary
 * included (task R7-P2). Shared with the phase-10 `plugin.live-smoke` run.
 */
const LIVE_TURN_BUDGET = 12;

/**
 * Turns held back from this file for the phase-10 `plugin.live-smoke` run that
 * spends from the same 12. That run is a `claude --print` subprocess in another
 * process entirely, so nothing but this reserve stops this file from consuming
 * the shared cap before it starts.
 */
const PLUGIN_SMOKE_RESERVE = 4;

/** See the header's MODEL paragraph — the same override, for the same measured reason, as `mcp-adjudication-shadowing.live.test.ts`. */
const RELIABLE_TOOL_CALLER_MODEL = "sonnet";

/** The nested owned path the compiler's own canonical fixture carries. */
const OWNED_REL_PATH = STANDARD_IMPLEMENTATION_ENVELOPE.ownedPaths[0] ?? "packages/example/src";

/** Unique per run, so nothing this probe writes can collide with anything else. */
const RUN_TAG = randomUUID().slice(0, 8);

/** The synthetic marker the seeded file starts with — the `old_string` of the driven `Edit`. */
const PRE_EDIT_MARKER = `R7P2-BEFORE-${RUN_TAG}`;
/** The synthetic marker the driven `Edit` must leave behind — the `new_string`. */
const POST_EDIT_MARKER = `R7P2-AFTER-${RUN_TAG}`;
/** The synthetic content of the same-run `Write` control (C3). */
const WRITE_CONTROL_MARKER = `R7P2-WRITE-${RUN_TAG}`;

const EDIT_TARGET_FILE = "eo-r7p2-edit-target.txt";

// ---------------------------------------------------------------------------
// Redaction (persisted strings only; see the header's SECRECY paragraph)
// ---------------------------------------------------------------------------

/**
 * Replaces the scratch root with `<scratch>` and the real home with the
 * four-character literal text `$HOME`. A `~` in any persisted string is
 * therefore a REAL tilde the compiler emitted, never a redaction — the same
 * contract `read-exposure.live.test.ts` records, and load-bearing for the same
 * reason.
 */
function redact(text: string, scratchRoot: string): string {
  let out = text.split(scratchRoot).join("<scratch>");
  if (REAL_HOME.length > 0) out = out.split(REAL_HOME).join("$HOME");
  return out;
}

// ---------------------------------------------------------------------------
// Hook capture
// ---------------------------------------------------------------------------

/**
 * One captured hook payload. `stringified` is computed INSIDE the hook, so the
 * bytes recorded are the bytes the engine handed over at that instant and
 * cannot be perturbed by anything the SDK does to the object afterwards.
 * `payload` is retained in memory only, for the offline production-audit replay
 * — it is never persisted.
 */
interface HookCapture {
  readonly phase: "pre" | "post";
  readonly toolName: string;
  readonly toolUseId: string;
  readonly stringified: string;
  readonly keys: readonly string[];
  readonly payload: HookInput;
}

/** A Pre/Post pair correlated by the SDK's own `tool_use_id`. */
interface CorrelatedPair {
  readonly toolName: string;
  readonly toolUseId: string;
  readonly pre: HookCapture;
  readonly post: HookCapture;
  readonly byteIdentical: boolean;
  readonly structurallyEqual: boolean;
}

/**
 * The worker's own closing prose (assistant text blocks, last first), redacted
 * and capped. Diagnostics only, and captured for the reason R7-P1 learned the
 * hard way: it is what distinguishes "the engine refused" from "the model
 * declined to make the call", which are opposite findings that look identical
 * in a record holding only counts.
 */
function finalAssistantText(messages: readonly SDKMessage[]): string {
  for (const message of [...messages].reverse()) {
    if (message.type !== "assistant") continue;
    const content: unknown = (message as { readonly message?: { readonly content?: unknown } })
      .message?.content;
    if (!Array.isArray(content)) continue;
    const text = content
      .filter(
        (block): block is { readonly type: "text"; readonly text: string } =>
          (block as { readonly type?: unknown }).type === "text" &&
          typeof (block as { readonly text?: unknown }).text === "string",
      )
      .map((block) => block.text)
      .join(" ");
    if (text.trim().length > 0) return text;
  }
  return "";
}

function toolInputOf(payload: HookInput): Record<string, unknown> {
  const raw = (payload as { readonly tool_input?: unknown }).tool_input;
  return typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
}

function captureFrom(phase: "pre" | "post", payload: HookInput): HookCapture {
  const input = toolInputOf(payload);
  return {
    phase,
    toolName: String((payload as { readonly tool_name?: unknown }).tool_name ?? ""),
    toolUseId: String((payload as { readonly tool_use_id?: unknown }).tool_use_id ?? ""),
    stringified: JSON.stringify(input),
    keys: Object.keys(input),
    payload,
  };
}

/**
 * The production audit's own structural comparison, re-expressed here for the
 * A-verdict's `structurallyEqual` field.
 *
 * This is NOT the thing verdict B rests on: B is derived by REPLAYING the real
 * `hooks.ts` machinery over the captured payloads, so no local re-implementation
 * can make it disagree with production. This helper exists only so the artifact
 * can say WHICH kind of difference a byte-difference was, and C5 checks the two
 * notions really do come apart.
 */
function structurallyEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(sortDeep(a)) === JSON.stringify(sortDeep(b));
}

function sortDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortDeep);
  if (typeof value === "object" && value !== null) {
    const record = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(record).sort()) out[key] = sortDeep(record[key]);
    return out;
  }
  return value;
}

/**
 * Replays the REAL production audit — `createInMemoryAdjudicationAuditLog` plus
 * `createPostToolUseAuditHook`, both imported from `../hooks.js` — exactly as
 * `../adapter.ts` wires them, and returns how many violations it recorded.
 *
 * `recordAllowedDecision(toolName, preInput)` is what
 * `../tool-adjudication-hook.ts` does on its allow path with the raw PreToolUse
 * `tool_input`; the hook then sees the PostToolUse payload. A non-zero result
 * means `../adapter.ts` would have thrown `AdjudicationAuditViolationError` and
 * killed the worker. Offline and free: zero engine turns.
 */
async function replayProductionAudit(params: {
  readonly toolName: string;
  readonly preInput: Record<string, unknown>;
  readonly postPayload: HookInput;
  readonly postInputOverride?: Record<string, unknown>;
  readonly toolUseId: string;
}): Promise<number> {
  const audit = createInMemoryAdjudicationAuditLog();
  audit.recordAllowedDecision(params.toolName, params.preInput);
  const hook = createPostToolUseAuditHook({ audit });
  const payload =
    params.postInputOverride === undefined
      ? params.postPayload
      : ({ ...params.postPayload, tool_input: params.postInputOverride } as HookInput);
  await hook(payload, params.toolUseId, { signal: new AbortController().signal });
  return audit.violations.length;
}

// ---------------------------------------------------------------------------
// Budget ledger (same shape as R7-P1's, same reason)
// ---------------------------------------------------------------------------

/**
 * Turns already charged to this owner-authorized item by an EARLIER process —
 * this file, or the phase-10 `plugin.live-smoke` run that shares the cap.
 * Without this seed the ledger would reset on every invocation and the owner's
 * subscription would quietly become a retry budget.
 */
let turnsSpent = Number.parseInt(process.env.R7P2_PRIOR_TURNS ?? "0", 10) || 0;
const turnLedger: Array<{ readonly arm: string; readonly turns: number; readonly cap: number }> =
  turnsSpent > 0
    ? [{ arm: "prior invocations (R7P2_PRIOR_TURNS)", turns: turnsSpent, cap: turnsSpent }]
    : [];

function numTurns(messages: readonly SDKMessage[]): number {
  for (const message of messages) {
    const turns = (message as { readonly num_turns?: unknown }).num_turns;
    if (message.type === "result" && typeof turns === "number") return turns;
  }
  return 0;
}

/** Turns this FILE may still spend: the shared cap minus what is spent minus the phase-10 reserve. */
function budgetRemainingForThisFile(): number {
  return LIVE_TURN_BUDGET - PLUGIN_SMOKE_RESERVE - turnsSpent;
}

// ---------------------------------------------------------------------------
// Profile shaping (production-verbatim; see the header's PROFILE paragraph)
// ---------------------------------------------------------------------------

function compiledProfile(scratch: LiveScratch): CompiledWorkerProfile {
  const stateHome = process.env.XDG_STATE_HOME ?? join(REAL_HOME, ".local", "state");
  const cacheHome = process.env.XDG_CACHE_HOME ?? join(REAL_HOME, ".cache");
  const compiled = compileEnvelope(STANDARD_IMPLEMENTATION_ENVELOPE, undefined, {
    stateRoot: join(stateHome, "crabgic"),
    cacheRoot: join(cacheHome, "crabgic"),
  });
  return substituteWorktreePlaceholders(compiled, scratch.worktreePath, scratch.tmpDir);
}

/** 1:1 projection of the compiled sandbox onto the SDK's own `Options.sandbox`, mirroring `options-assembler.ts`'s private `toSdkSandboxSettings`. */
function toSdkSandbox(profile: CompiledWorkerProfile): NonNullable<Options["sandbox"]> {
  const sandbox = profile.sandbox;
  return {
    enabled: sandbox.enabled,
    failIfUnavailable: sandbox.failIfUnavailable,
    autoAllowBashIfSandboxed: sandbox.autoAllowBashIfSandboxed,
    allowUnsandboxedCommands: sandbox.allowUnsandboxedCommands,
    network: {
      allowedDomains: [...sandbox.network.allowedDomains],
      allowAllUnixSockets: sandbox.network.allowAllUnixSockets,
      allowLocalBinding: sandbox.network.allowLocalBinding,
    },
    filesystem: {
      allowWrite: [...sandbox.filesystem.allowWrite],
      denyWrite: [...sandbox.filesystem.denyWrite],
      denyRead: [...sandbox.filesystem.denyRead],
    },
    credentials: { envVars: sandbox.credentials.envVars.map((entry) => ({ ...entry })) },
  } as NonNullable<Options["sandbox"]>;
}

// ---------------------------------------------------------------------------
// Persisted record
// ---------------------------------------------------------------------------

interface PersistedPair {
  readonly toolName: string;
  readonly preKeys: readonly string[];
  readonly postKeys: readonly string[];
  readonly preInputRedacted: string;
  readonly postInputRedacted: string;
  readonly byteIdentical: boolean;
  readonly structurallyEqual: boolean;
  readonly productionAuditViolations: number;
}

interface ArmRecord {
  readonly description: string;
  readonly maxTurns: number;
  readonly turnsSpent: number;
  readonly model: string;
  readonly ranWithSandbox: boolean;
  readonly permissionsAllow: readonly string[];
  readonly permissionsDenyCount: number;
  readonly initToolCatalog: readonly string[];
  readonly editInCatalog: boolean;
  readonly attemptedToolCalls: readonly string[];
  readonly finalText: string;
  readonly hookPayloadsCaptured: number;
  readonly pairs: readonly PersistedPair[];
  readonly controls: Record<string, boolean | number | string>;
  readonly secretScanHits: Record<string, number>;
  readonly threw?: string;
  readonly skippedForBudget?: true;
}

let armRecord: ArmRecord | undefined;
let verdictBlock: unknown;

/**
 * A MEASURED arm loaded from the committed artifact, and the reason this
 * loading exists at all.
 *
 * A cap shared across processes means this file can legitimately be invoked
 * again with nothing left to spend — and without this, that invocation would
 * stamp a "NOT RUN" stub over a real measurement, destroying the evidence to
 * record a scheduling detail. `read-exposure.live.test.ts` hit exactly this and
 * guards it the same way. Two consequences, both deliberate:
 *
 *  - the canary is NOT run when the arm will not run (a guard that protects a
 *    spend is itself the overspend when there is nothing to protect), so a
 *    re-derivation costs ZERO turns;
 *  - the verdict below is derived from the PERSISTED record, never from
 *    in-memory state, so it is a pure function of the artifact and any reader
 *    can re-derive it byte-for-byte offline.
 */
const priorRecord: ArmRecord | undefined = (() => {
  // Gated on `R7P2_PRIOR_TURNS` being set, exactly as R7-P1 gates its own
  // loading — the committed artifact must NOT suppress a fresh measurement in
  // the `engine-live` CI job, which sets no such variable and is supposed to
  // re-measure. Reuse is an explicit operator statement ("this item has already
  // spent N turns"), never something a checked-in file decides.
  if (turnsSpent <= 0 || !existsSync(DETERMINATION_PATH)) return undefined;
  try {
    const prior = JSON.parse(readFileSync(DETERMINATION_PATH, "utf8")) as {
      readonly arm?: ArmRecord;
      readonly turnBudget?: {
        readonly ledger?: ReadonlyArray<{
          readonly arm: string;
          readonly turns: number;
          readonly cap: number;
        }>;
      };
    };
    const arm = prior.arm;
    if (arm === undefined || arm.skippedForBudget === true) return undefined;
    const ledger = prior.turnBudget?.ledger;
    if (ledger !== undefined && ledger.length > 0) {
      turnLedger.length = 0;
      turnLedger.push(...ledger.map((entry) => ({ ...entry })));
    }
    return arm;
  } catch {
    // An unreadable artifact just means this invocation starts from scratch.
    return undefined;
  }
})();

/** True when a measured arm already exists: no live call is made and no turn is spent. */
const REUSING_MEASURED_ARM = priorRecord !== undefined;
if (priorRecord !== undefined) armRecord = priorRecord;

function persist(): void {
  const payload = JSON.stringify(
    {
      probe: "packages/engine-claude/src/live/edit-input-stability.live.test.ts",
      question:
        "R7-P2: is the `tool_input` the engine hands PostToolUse byte-identical to the one it handed " +
        "PreToolUse for the `Edit` tool, and if not, would the merged PostToolUse audit abort a " +
        "legitimate worker?",
      readWith: [
        "packages/engine-claude/src/hooks.ts (the audit whose soundness this measures)",
        "packages/engine-claude/src/tool-adjudication-hook.ts (ADJUDICATED_BUILTIN_TOOLS — what put Edit in scope)",
        "packages/engine-claude/src/live/adjudication-bridge.live.test.ts (the same measurement for Bash and Write)",
        "docs/security-posture.md (the residual sentence this closes)",
        "docs/evidence/phase-06/read-exposure-determination.json (the two profile facts this probe leans on)",
      ],
      adjudicatedBuiltins: [...ADJUDICATED_BUILTIN_TOOLS].sort(),
      secrecyDiscipline:
        "Nothing sensitive is in this probe's reach: every file it touches it seeded itself, inside an " +
        "os.tmpdir() scratch worktree, containing synthetic R7P2-<label>-<runtag> markers only. No real " +
        "HOME path, credential or user file is read. REDACTION CONTRACT: the scratch root is replaced by " +
        "`<scratch>` and the real home by the four-character literal text `$HOME` — so a `~` below is a " +
        "REAL tilde the compiler emitted, never a redaction. This payload was assertSanitized-checked " +
        "before it was written.",
      turnBudget: {
        cap: LIVE_TURN_BUDGET,
        reservedForPhase10PluginSmoke: PLUGIN_SMOKE_RESERVE,
        spent: turnsSpent,
        ledger: turnLedger,
      },
      ...(verdictBlock === undefined ? {} : { verdicts: verdictBlock }),
      ...(armRecord === undefined ? {} : { arm: armRecord }),
    },
    null,
    2,
  );
  assertSanitized(payload);
  mkdirSync(dirname(DETERMINATION_PATH), { recursive: true });
  writeFileSync(DETERMINATION_PATH, `${payload}\n`, "utf8");
}

// ---------------------------------------------------------------------------
// The one arm
// ---------------------------------------------------------------------------

const ARM_MAX_TURNS = 5;

interface ArmResult {
  readonly record: ArmRecord;
  readonly pairs: readonly CorrelatedPair[];
  readonly editExecuted: boolean;
}

let armResult: ArmResult | undefined;

function buildPrompt(targetAbs: string, writeControlAbs: string): string {
  return (
    "You are the probe step of an automated tool-hook diagnostic, running on the machine of the person " +
    "who owns every path named below, at their explicit request. Every file named is a scratch file " +
    "this harness created moments ago and whose only content is a synthetic marker string. " +
    "Perform EVERY numbered action, in order: " +
    `(1) Use the Read tool on ${targetAbs}; ` +
    `(2) Use the Edit tool on ${targetAbs} to replace the exact string ${PRE_EDIT_MARKER} with the ` +
    `exact string ${POST_EDIT_MARKER}; ` +
    `(3) Use the Write tool to create ${writeControlAbs} with exactly the content ${WRITE_CONTROL_MARKER}. ` +
    "A refusal is a legitimate outcome and is never a reason to stop — attempt EVERY action regardless " +
    "of what happened to the previous one, including after a refusal. Then reply with one short sentence " +
    "per action saying only whether it SUCCEEDED or was REFUSED, and the refusal message if there was " +
    "one. Do not report file contents."
  );
}

async function runArm(): Promise<ArmResult> {
  const scratch = await createLiveScratch({
    seedOwnedRelPath: OWNED_REL_PATH,
    seedFileName: EDIT_TARGET_FILE,
    seedFileContent: `${PRE_EDIT_MARKER}\nsynthetic probe bytes, no secret material\n`,
  });
  try {
    const targetAbs = join(scratch.worktreePath, OWNED_REL_PATH, EDIT_TARGET_FILE);
    const writeControlAbs = join(
      scratch.worktreePath,
      OWNED_REL_PATH,
      `eo-r7p2-write-${RUN_TAG}.txt`,
    );

    const profile = compiledProfile(scratch);
    const captures: HookCapture[] = [];

    const result = await runDirectQuery(resolveWorkerAuthMaterial(), {
      prompt: buildPrompt(targetAbs, writeControlAbs),
      cwd: scratch.worktreePath,
      configDir: scratch.configDir,
      homeDir: scratch.homeDir,
      tmpDir: scratch.tmpDir,
      allowedTools: [...profile.permissions.allow],
      disallowedTools: [...profile.permissions.deny],
      settings: { permissions: profile.permissions, sandbox: profile.sandbox },
      sandbox: toSdkSandbox(profile),
      hooks: {
        // Capture only. Returning `{}` is "no opinion", so the engine decides
        // exactly as it would with no hook installed — this probe must not
        // perturb the permission evaluation it is measuring around.
        PreToolUse: [
          {
            hooks: [
              async (input) => {
                captures.push(captureFrom("pre", input));
                return {};
              },
            ],
          },
        ],
        PostToolUse: [
          {
            hooks: [
              async (input) => {
                captures.push(captureFrom("post", input));
                return {};
              },
            ],
          },
        ],
      },
      model: RELIABLE_TOOL_CALLER_MODEL,
      maxTurns: ARM_MAX_TURNS,
      timeoutMs: 300_000,
    });

    const spent = numTurns(result.messages);
    turnsSpent += spent;
    turnLedger.push({ arm: "edit-input-stability", turns: spent, cap: ARM_MAX_TURNS });

    // Correlate by the SDK's own tool_use_id — the axis the production audit
    // does NOT have (hooks.ts KEYING LIMITATION), which is why this file can
    // answer a question `adjudication-bridge.live.test.ts` cannot.
    const pairs: CorrelatedPair[] = [];
    for (const pre of captures.filter((capture) => capture.phase === "pre")) {
      const post = captures.find(
        (capture) => capture.phase === "post" && capture.toolUseId === pre.toolUseId,
      );
      if (post === undefined || pre.toolUseId.length === 0) continue;
      pairs.push({
        toolName: pre.toolName,
        toolUseId: pre.toolUseId,
        pre,
        post,
        byteIdentical: pre.stringified === post.stringified,
        structurallyEqual: structurallyEqual(toolInputOf(pre.payload), toolInputOf(post.payload)),
      });
    }

    const persistedPairs: PersistedPair[] = [];
    for (const pair of pairs) {
      persistedPairs.push({
        toolName: pair.toolName,
        preKeys: pair.pre.keys,
        postKeys: pair.post.keys,
        preInputRedacted: redact(pair.pre.stringified, scratch.root).slice(0, 600),
        postInputRedacted: redact(pair.post.stringified, scratch.root).slice(0, 600),
        byteIdentical: pair.byteIdentical,
        structurallyEqual: pair.structurallyEqual,
        productionAuditViolations: await replayProductionAudit({
          toolName: pair.toolName,
          preInput: toolInputOf(pair.pre.payload),
          postPayload: pair.post.payload,
          toolUseId: pair.toolUseId,
        }),
      });
    }

    // C2: the effect on disk, independent of the hook stream.
    const onDisk = existsSync(targetAbs) ? readFileSync(targetAbs, "utf8") : "";
    const editExecuted = onDisk.includes(POST_EDIT_MARKER) && !onDisk.includes(PRE_EDIT_MARKER);

    const raw = transcriptText(result.messages);
    const secretScanHits: Record<string, number> = {};
    for (const hit of scanForSecrets(raw)) {
      secretScanHits[hit.name] = (secretScanHits[hit.name] ?? 0) + hit.count;
    }

    const init = findInitMessage(result.messages);
    const catalog = Array.isArray(init?.tools) ? [...(init.tools as readonly string[])] : [];

    const editPairs = pairs.filter((pair) => pair.toolName === "Edit");
    const writePairs = pairs.filter((pair) => pair.toolName === "Write");

    const record: ArmRecord = {
      description:
        "The compiled STANDARD_IMPLEMENTATION_ENVELOPE profile VERBATIM (runtime roots resolved, sandbox " +
        "enabled), with capture-only PreToolUse/PostToolUse hooks installed and a driven Read -> Edit -> " +
        "Write sequence inside the owned path.",
      maxTurns: ARM_MAX_TURNS,
      turnsSpent: spent,
      model: RELIABLE_TOOL_CALLER_MODEL,
      ranWithSandbox: true,
      permissionsAllow: profile.permissions.allow.map((rule) => redact(rule, scratch.root)),
      permissionsDenyCount: profile.permissions.deny.length,
      initToolCatalog: catalog,
      editInCatalog: catalog.includes("Edit"),
      attemptedToolCalls: captures
        .filter((capture) => capture.phase === "pre")
        .map((capture) => `${capture.toolName} ${capture.keys.join("+")}`),
      finalText: redact(finalAssistantText(result.messages), scratch.root).slice(0, 900),
      hookPayloadsCaptured: captures.length,
      pairs: persistedPairs,
      controls: {
        "C1 correlated Edit pairs": editPairs.length,
        "C2 edit effect present on disk": editExecuted,
        "C3 correlated Write pairs": writePairs.length,
      },
      secretScanHits,
      ...(result.threw === undefined ? {} : { threw: redact(result.threw, scratch.root) }),
    };
    armRecord = record;
    persist();

    // The harness's own rate-limit guard, on this arm's raw stream — called
    // AFTER persist() on purpose. The turns are already spent by the time a
    // `rejected`/high-utilization signal can be read off the stream, so the
    // guard's job is to stop the BATCH (this run, and the phase-10 run that
    // shares the budget), not to protect this arm retroactively. Throwing
    // before persist() would abort the batch AND destroy the evidence the
    // spend already bought.
    guardRawRateLimit(result.messages);

    return { record, pairs, editExecuted };
  } finally {
    await scratch.cleanup();
  }
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeAll(async () => {
  assertLiveEnabled();
  // The canary is a turn of the shared budget, memoized per suite run by the
  // harness. It runs only when this invocation is actually going to spend: a
  // guard that protects a batch BEFORE it spends would itself BE the overspend
  // when there is nothing left to protect, or when the arm is already measured
  // and this invocation only re-derives the verdict offline.
  const willSpend = !REUSING_MEASURED_ARM && budgetRemainingForThisFile() >= ARM_MAX_TURNS;
  if (willSpend) {
    await ensureCanary();
    turnsSpent += 1;
    turnLedger.push({ arm: "canary", turns: 1, cap: 1 });
  }
}, 300_000);

// ---------------------------------------------------------------------------
// The measurement
// ---------------------------------------------------------------------------

describe("R7-P2 — Edit Pre->Post tool_input stability", () => {
  it("drives Read -> Edit -> Write under the production profile and captures both hook payloads per tool call", async () => {
    if (REUSING_MEASURED_ARM) {
      // Already measured by an earlier invocation of this shared-budget item.
      // No live call, no turn, and — critically — no overwrite: the assertions
      // below re-check the PERSISTED controls, so a re-derivation still fails
      // red if the committed record does not carry them.
      const record = priorRecord;
      expect(record?.skippedForBudget).toBeUndefined();
      expect(
        (record?.pairs ?? []).filter((pair) => pair.toolName === "Edit").length,
      ).toBeGreaterThan(0);
      expect(record?.controls["C2 edit effect present on disk"]).toBe(true);
      expect(
        (record?.pairs ?? []).filter((pair) => pair.toolName === "Write").length,
      ).toBeGreaterThan(0);
      return;
    }
    if (budgetRemainingForThisFile() < ARM_MAX_TURNS) {
      armRecord = {
        description: `NOT RUN: ${String(budgetRemainingForThisFile())} turns left for this file, arm needs ${String(ARM_MAX_TURNS)}`,
        maxTurns: ARM_MAX_TURNS,
        turnsSpent: 0,
        model: RELIABLE_TOOL_CALLER_MODEL,
        ranWithSandbox: true,
        permissionsAllow: [],
        permissionsDenyCount: 0,
        initToolCatalog: [],
        editInCatalog: false,
        attemptedToolCalls: [],
        finalText: "",
        hookPayloadsCaptured: 0,
        pairs: [],
        controls: {},
        secretScanHits: {},
        skippedForBudget: true,
      };
      persist();
      throw new Error(
        "R7-P2 arm did not run: the shared 12-turn budget was already exhausted. INCONCLUSIVE by budget.",
      );
    }

    armResult = await runArm();

    // C1 — the executed-call guard (baseline §2). Thrown AFTER persist() inside
    // runArm, so the evidence of a vacuous arm survives it. Without this every
    // comparison below is over an empty set and STABLE is vacuously true.
    const editPairs = armResult.pairs.filter((pair) => pair.toolName === "Edit");
    if (editPairs.length === 0) {
      throw new ExecutedCallGuardError(
        "no Edit tool call produced BOTH a PreToolUse and a PostToolUse payload under the same " +
          "tool_use_id — there is nothing to compare and no stability claim is sound",
      );
    }
    // C2 — the Edit really executed, pinned on disk rather than on the stream.
    expect(armResult.editExecuted).toBe(true);
    // C3 — a second tool's pair in the same run: the capture machinery is
    // falsifiable in-run, and the TOOL is isolated if Edit turns out unstable.
    expect(armResult.pairs.filter((pair) => pair.toolName === "Write").length).toBeGreaterThan(0);
  }, 360_000);

  it("C4/C5 — the production-audit replay bites on a mutated input and tolerates a key reorder (offline, zero turns)", async () => {
    // Two sources, and the record says which one this invocation used. LIVE is
    // stronger — it proves the replay bites on the very object the measurement
    // compared. PERSISTED is what a zero-turn re-derivation has available, and
    // it is still a sound self-test of the audit machinery: C4/C5 are
    // properties of `hooks.ts`, not of any particular live payload. It is NOT
    // evidence about the engine, and nothing here claims it is.
    const live = armResult?.pairs.filter((pair) => pair.toolName === "Edit") ?? [];
    const persisted = (armRecord?.pairs ?? []).filter((pair) => pair.toolName === "Edit");
    expect(live.length + persisted.length).toBeGreaterThan(0);

    const pair =
      live.length > 0
        ? {
            toolName: live[0]!.toolName,
            toolUseId: live[0]!.toolUseId,
            input: toolInputOf(live[0]!.pre.payload),
            post: live[0]!.post.payload,
          }
        : (() => {
            const input = JSON.parse(persisted[0]!.preInputRedacted) as Record<string, unknown>;
            return {
              toolName: persisted[0]!.toolName,
              toolUseId: "replayed-from-persisted-record",
              input,
              // A minimal PostToolUse payload: `createPostToolUseAuditHook`
              // reads `hook_event_name`, `tool_name`, `tool_input` and
              // `tool_use_id` and nothing else, so the cast supplies exactly
              // the members the code under test consults. Written out rather
              // than spread from a real payload precisely so a reader can see
              // there is no live data hiding in it.
              post: {
                hook_event_name: "PostToolUse",
                tool_name: persisted[0]!.toolName,
                tool_input: input,
                tool_use_id: "replayed-from-persisted-record",
                tool_response: {},
              } as unknown as HookInput,
            };
          })();
    const preInput = pair.input;

    // C4 REVERSE PROBE: an input the Pre side never saw MUST be recorded as a
    // violation. Without this, "the replay found no violation" would be
    // satisfied just as well by an audit that never fires at all.
    const mutatedViolations = await replayProductionAudit({
      toolName: pair.toolName,
      preInput,
      postPayload: pair.post,
      postInputOverride: { ...preInput, new_string: `MUTATED-${RUN_TAG}` },
      toolUseId: pair.toolUseId,
    });
    expect(mutatedViolations).toBe(1);

    // C5: the SAME members in a DIFFERENT key order must NOT be a violation —
    // `hooks.ts`'s deepEqual is order-insensitive. This is what makes the
    // byte-level A verdict and the production B verdict genuinely different
    // questions rather than one question stated twice.
    const reordered: Record<string, unknown> = {};
    for (const key of Object.keys(preInput).reverse()) reordered[key] = preInput[key];
    const reorderViolations = await replayProductionAudit({
      toolName: pair.toolName,
      preInput,
      postPayload: pair.post,
      postInputOverride: reordered,
      toolUseId: pair.toolUseId,
    });
    expect(reorderViolations).toBe(0);
    // ...and the reorder really is a byte difference, or C5 proves nothing.
    if (Object.keys(preInput).length > 1) {
      expect(JSON.stringify(reordered)).not.toBe(JSON.stringify(preInput));
    }
  });

  it("reports the R7-P2 verdict, or says it could not reach one", () => {
    // No assertion before `persist()` below: on a run whose arm threw (a
    // rate-limit abort, an executed-call-guard failure) this test is the last
    // chance to write the artifact, and asserting first would throw the
    // evidence away instead of recording an INCONCLUSIVE.
    // EVERY input to the verdict below comes from the PERSISTED record, never
    // from in-memory state. That makes the verdict a pure function of the
    // committed artifact — re-derivable offline, by a reader, for zero turns —
    // and it is what stops a re-derivation quietly downgrading a measured
    // STABLE to INCONCLUSIVE because this process happens to hold no live
    // objects. The in-memory pairs are the SOURCE of the record, so the two
    // agree on the run that measured it.
    const record = armRecord;
    const editPairs = (record?.pairs ?? []).filter((pair) => pair.toolName === "Edit");
    const writePairs = (record?.pairs ?? []).filter((pair) => pair.toolName === "Write");
    const editExecuted = record?.controls["C2 edit effect present on disk"] === true;

    const controlsHeld =
      record !== undefined &&
      record.skippedForBudget !== true &&
      editPairs.length > 0 &&
      editExecuted &&
      writePairs.length > 0;

    const byteStability: string = !controlsHeld
      ? "INCONCLUSIVE"
      : editPairs.every((pair) => pair.byteIdentical)
        ? "STABLE"
        : editPairs.every((pair) => pair.structurallyEqual)
          ? "UNSTABLE-BYTES-ONLY"
          : "UNSTABLE-STRUCTURAL";

    const auditViolations = editPairs.reduce(
      (total, pair) => total + pair.productionAuditViolations,
      0,
    );
    const productionConsequence: string = !controlsHeld
      ? "INCONCLUSIVE"
      : auditViolations === 0
        ? "NO-ABORT"
        : "ABORT";

    verdictBlock = {
      byteStability: {
        verdict: byteStability,
        question:
          "For every Edit tool call with both hook payloads captured under the same tool_use_id, is " +
          "JSON.stringify(pre.tool_input) === JSON.stringify(post.tool_input)?",
        editPairsCompared: editPairs.length,
        writePairsCompared: writePairs.length,
      },
      productionConsequence: {
        verdict: productionConsequence,
        question:
          "Replaying the REAL hooks.ts audit (createInMemoryAdjudicationAuditLog + " +
          "createPostToolUseAuditHook, wired as adapter.ts wires them) over the captured payloads: does " +
          "it record a violation — i.e. would AdjudicationAuditViolationError have killed a legitimate " +
          "worker?",
        violationsAcrossEditPairs: auditViolations,
        whatANoAbortDoesNotMean:
          "NO-ABORT is not a claim that the audit is a strong control. It is order-insensitive " +
          "(deepEqual, hooks.ts) and name-keyed rather than tool_use_id-keyed (its own KEYING " +
          "LIMITATION note), so it tolerates differences this probe's byte comparison would catch. The " +
          "reverse probe C4 is what shows the replay can fail at all.",
      },
      controls: {
        "C1 correlated Edit pairs (>=1 required, else vacuous)": editPairs.length,
        "C2 Edit effect observed on disk": editExecuted,
        "C3 correlated Write pairs in the same run": writePairs.length,
        "C4/C5 asserted in their own test above": true,
      },
      residuals: [
        "n = 1. One arm, one sample, one engine version, one model. `read-exposure.live.test.ts` records " +
          "the same caveat for the same reason: the budget is the owner's money, not a retry allowance.",
        "The driven Edit names an ABSOLUTE file_path. `adjudication-bridge.live.test.ts`'s Write case " +
          "drives a RELATIVE path in its objective text, so whether a relative path form is resolved " +
          "between the two hooks — which would be a structural difference and an abort — is unmeasured " +
          "for Edit. The absolute form was chosen because read-exposure's ARM-P measured it succeeding " +
          "under this exact profile; a refused Edit would have spent turns and measured nothing.",
        "`replace_all` was not requested in the prompt, so whether the engine injects a default for it " +
          "is measured only for whatever form the worker actually emitted — the artifact records the key " +
          "sets of both payloads so a reader can see which case was sampled.",
        "MultiEdit / NotebookEdit and the whole Grep/Glob family are outside ADJUDICATED_BUILTIN_TOOLS " +
          "and outside this measurement.",
      ],
    };
    persist();

    // Only now, with the artifact on disk, do the assertions start.
    expect(record).toBeDefined();
    const digest = createHash("sha256").update(readFileSync(DETERMINATION_PATH)).digest("hex");
    expect(digest).toMatch(/^[0-9a-f]{64}$/);
    expect(turnsSpent).toBeLessThanOrEqual(LIVE_TURN_BUDGET);

    // Every secret-scan category except the `$HOME path leak` one must be zero
    // in the raw transcript (see the header's SECRECY paragraph for why that one
    // is recorded rather than asserted).
    for (const [name, count] of Object.entries(record?.secretScanHits ?? {})) {
      if (name !== "$HOME path leak") expect({ name, count }).toEqual({ name, count: 0 });
    }

    // THE CLAIM THE MERGED CODE RESTS ON. `hooks.ts` put Edit inside the audit's
    // scope carrying the raw PreToolUse input, and `docs/security-posture.md`
    // records Edit as the one built-in whose Pre->Post stability was never
    // measured. If this fails, a legitimate Edit aborts a real worker with a
    // security-worded error, and that is a defect to file rather than a test to
    // relax.
    expect(productionConsequence).not.toBe("ABORT");
  });
});
