/**
 * SDK hook callbacks (roadmap/06-claude-engine-adapter.md work item 3):
 * a `PostToolUse` audit hook verifying the executed `tool_input` matches
 * what `adjudication-policy.ts` actually adjudicated (adaptation §9's
 * test-matrix "Hook enforcement | 03/06" row), and a `SessionEnd` hook
 * journaling an `evidence_pointer` entry pointing at the worker's own
 * transcript file. Both are in-process `HookCallback`s (SDK `Options.hooks`
 * shape, `sdk.d.ts` 0.3.210 — `HookEvent`/`HookCallbackMatcher`/
 * `HookCallback`/`HookInput`/`HookJSONOutput`), wired into `Options.hooks`
 * by the adapter (W4; out of scope here).
 *
 * FAIL-SAFE, not fail-closed (deliberately different from
 * `adjudication-policy.ts`'s fail-CLOSED posture): a hook that throws would
 * crash the SDK's own message stream for every worker, which is a much
 * larger blast radius than a single missed audit record. Both hooks below
 * therefore catch every error internally and always resolve their promise
 * — they only ever RECORD a failure (into `AdjudicationAuditLog.violations`
 * for the PostToolUse hook, into `SessionEndEvidenceHookHandle.lastError`
 * for the SessionEnd hook), never throw out of the callback itself.
 */
import { posix } from "node:path";
import { randomUUID } from "node:crypto";
import type { JournalStore } from "@eo/journal";
import { CURRENT_SCHEMA_VERSION } from "@eo/contracts";
import type { HookCallback } from "@anthropic-ai/claude-agent-sdk";

// ---------------------------------------------------------------------------
// PostToolUse audit: executed-vs-adjudicated verification.
// ---------------------------------------------------------------------------

/** A single executed-vs-adjudicated MISMATCH the PostToolUse hook detected — a tool that WAS adjudicated (≥1 allow recorded for its name) but whose EXECUTED input matched none of those adjudicated inputs. The adapter (W4) inspects `AdjudicationAuditLog.violations` to decide whether to abort the worker; this module only detects and records. */
export interface AdjudicationAuditViolation {
  readonly toolName: string;
  readonly toolUseId: string;
  readonly executedInput: unknown;
  /** ISO-8601 timestamp (`Date#toISOString`) of detection. */
  readonly detectedAt: string;
}

/** A hook-internal FAILURE (the audit machinery itself threw), recorded for visibility. Deliberately NOT a `violation`: it never feeds the adapter's abort path — see `createPostToolUseAuditHook`'s fail-safe doc comment. */
export interface AdjudicationAuditFailure {
  readonly toolName: string;
  readonly toolUseId: string;
  /** ISO-8601 timestamp (`Date#toISOString`) of the internal failure. */
  readonly detectedAt: string;
  /** Static, secret-free description of the internal failure (never carries tool input). */
  readonly message: string;
}

/**
 * Populated by the adapter (W4) immediately after `adjudication-policy.ts`
 * resolves an `allow` decision — NOT by this module, which only reads and
 * records. Keyed by tool name + deep-equal `updatedInput`.
 *
 * AUDIT CONTRACT (Finding 2 — what this log can SOUNDLY assert): it detects
 * a tool that WAS adjudicated (≥1 allow recorded for that tool name via
 * `recordAllowedDecision`) but whose EXECUTED input matches none of those
 * adjudicated inputs — a genuine adjudicated-vs-executed MISMATCH (input
 * mutation after approval, adaptation §9 canonicalization check). A tool
 * with ZERO adjudicated records that nonetheless executed is authorized by
 * the STATIC `dontAsk` allow-list (docs/engine-baseline.md §3, the
 * load-bearing, verified enforcement layer) and is OUT OF this audit's
 * scope — NOT a violation. This is required because whether the SDK invokes
 * the `canUseTool` bridge at all under `permissionMode: "dontAsk"` is an
 * UNPROBED engine fact (baseline §3 probed enforcement via static allow/deny
 * lists + `result.permission_denials`, with NO `canUseTool` installed): if
 * the bridge never fires, `recordAllowedDecision` is never called and every
 * pre-approved tool would otherwise read as a spurious violation.
 *
 * KEYING LIMITATION (documented): `hasMatchingAllowedDecision` does a
 * deep-equality scan over every allowed decision recorded for a given tool
 * name so far in this session — it has no notion of WHICH specific
 * `tool_use_id` an allowed decision was for. Two structurally-identical
 * tool calls for the same tool (e.g. two `Read` calls with the exact same
 * `file_path`) are indistinguishable from each other by this log; an
 * adjudicated allow for call #1 will also satisfy the audit check for call
 * #2 even if #2 was never itself adjudicated. This is a deliberate,
 * documented v1 simplification (README decision-record convention) — a
 * `tool_use_id`-keyed audit would require the adapter to correlate the
 * SDK's own `tool_use_id` back to the specific `AdjudicationCallback`
 * invocation that produced each decision, which 03's frozen
 * `AdjudicationCallback` shape does not surface to the callback itself.
 */
export interface AdjudicationAuditLog {
  /** Records an allowed decision's canonicalized input, called by the adapter (W4) right after the policy resolves `behavior: "allow"`. */
  recordAllowedDecision(toolName: string, updatedInput: Readonly<Record<string, unknown>>): void;
  /** True if `recordAllowedDecision` has EVER been called for `toolName` this session — i.e. this tool is within the audit's scope (see AUDIT CONTRACT above). */
  hasAnyAllowedDecision(toolName: string): boolean;
  /** True if `toolName`+`executedInput` deep-equals some previously recorded allowed decision for that tool name (see keying limitation above). */
  hasMatchingAllowedDecision(toolName: string, executedInput: unknown): boolean;
  /** Records a detected executed-vs-adjudicated mismatch (feeds the adapter's abort path). Never throws. */
  recordViolation(violation: AdjudicationAuditViolation): void;
  /** Records a hook-internal failure for visibility only — does NOT feed the abort path (the audit is a diagnostic backstop, never the load-bearing enforcement). Never throws. */
  recordAuditFailure(failure: AdjudicationAuditFailure): void;
  readonly violations: readonly AdjudicationAuditViolation[];
  readonly auditFailures: readonly AdjudicationAuditFailure[];
}

/** Minimal, dependency-free structural deep-equality check — sufficient for JSON-shaped tool-input records (strings/numbers/booleans/null/arrays/plain objects); not a general-purpose deep-equal (no cyclic-reference handling, no `Date`/`Map`/`Set` support — tool inputs are always JSON-serializable per the SDK's own wire format). */
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) {
    return true;
  }
  if (typeof a !== typeof b || a === null || b === null || typeof a !== "object") {
    return false;
  }
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) {
      return false;
    }
    return a.every((item, index) => deepEqual(item, b[index]));
  }
  const aRecord = a as Record<string, unknown>;
  const bRecord = b as Record<string, unknown>;
  const aKeys = Object.keys(aRecord);
  const bKeys = Object.keys(bRecord);
  if (aKeys.length !== bKeys.length) {
    return false;
  }
  return aKeys.every((key) => Object.hasOwn(bRecord, key) && deepEqual(aRecord[key], bRecord[key]));
}

/** In-memory `AdjudicationAuditLog` implementation — the one this package ships; no persistent-store variant exists (nothing in this phase's scope requires the audit log itself to survive a crash — the journal, not this log, is the durable record). */
export function createInMemoryAdjudicationAuditLog(): AdjudicationAuditLog {
  const allowedByToolName = new Map<string, Readonly<Record<string, unknown>>[]>();
  const violations: AdjudicationAuditViolation[] = [];
  const auditFailures: AdjudicationAuditFailure[] = [];

  return {
    recordAllowedDecision(toolName, updatedInput) {
      const bucket = allowedByToolName.get(toolName) ?? [];
      bucket.push(updatedInput);
      allowedByToolName.set(toolName, bucket);
    },
    hasAnyAllowedDecision(toolName) {
      const bucket = allowedByToolName.get(toolName);
      return bucket !== undefined && bucket.length > 0;
    },
    hasMatchingAllowedDecision(toolName, executedInput) {
      const bucket = allowedByToolName.get(toolName);
      if (bucket === undefined) {
        return false;
      }
      return bucket.some((allowedInput) => deepEqual(allowedInput, executedInput));
    },
    recordViolation(violation) {
      violations.push(violation);
    },
    recordAuditFailure(failure) {
      auditFailures.push(failure);
    },
    get violations() {
      return violations;
    },
    get auditFailures() {
      return auditFailures;
    },
  };
}

/**
 * `PostToolUse` hook callback — detects a genuine adjudicated-vs-executed
 * MISMATCH (adaptation §9's Hook-enforcement test-matrix row): a tool that
 * this session's policy DID adjudicate as `allow` (`hasAnyAllowedDecision`)
 * but whose EXECUTED input matches none of those adjudicated inputs
 * (`!hasMatchingAllowedDecision`). A tool with ZERO adjudicated records is
 * authorized by the static `dontAsk` allow-list (baseline §3, the verified
 * enforcement layer) and is OUT OF scope — never a violation (Finding 2:
 * whether the `canUseTool` bridge fires under `dontAsk` is an unprobed
 * engine fact, so an empty audit log must not be read as evidence of a
 * bad tool call). On a genuine mismatch, records a typed violation; the
 * adapter (W4) aborts the worker when `audit.violations` is non-empty —
 * this hook only detects and records.
 *
 * FAIL-SAFE, INTERNAL-ERROR handling (documented choice, Finding 2): if the
 * audit machinery itself throws, the error is recorded as an
 * `auditFailure` (visible for diagnostics) rather than a `violation`.
 * Recording it as a violation would abort the worker on a mere hook bug and
 * conflate "the audit code broke" with "the engine executed a mutated tool
 * input" — so the abort path is reserved for genuine mismatches only. A
 * broken audit log costs only the loss of this DIAGNOSTIC backstop; the
 * load-bearing static allow/deny enforcement (baseline §3) is unaffected,
 * so declining to abort here is the correct, non-fail-open choice.
 */
export function createPostToolUseAuditHook(input: {
  readonly audit: AdjudicationAuditLog;
}): HookCallback {
  return async (hookInput, toolUseId) => {
    try {
      if (hookInput.hook_event_name !== "PostToolUse") {
        return {};
      }
      const adjudicated = input.audit.hasAnyAllowedDecision(hookInput.tool_name);
      const matched = input.audit.hasMatchingAllowedDecision(
        hookInput.tool_name,
        hookInput.tool_input,
      );
      if (adjudicated && !matched) {
        input.audit.recordViolation({
          toolName: hookInput.tool_name,
          toolUseId: toolUseId ?? hookInput.tool_use_id,
          executedInput: hookInput.tool_input,
          detectedAt: new Date().toISOString(),
        });
      }
    } catch {
      // Fail-safe (file-level doc comment): never throw out of the hook.
      // Record the internal failure for VISIBILITY (never a violation — it
      // must not feed the abort path, see doc comment above). If even that
      // throws (a broken audit log implementation), there is nothing
      // further this hook can safely do without risking the stream.
      try {
        input.audit.recordAuditFailure({
          toolName: "unknown",
          toolUseId: toolUseId ?? "unknown",
          detectedAt: new Date().toISOString(),
          message: "PostToolUse audit check failed internally (fail-safe: recorded, not aborted)",
        });
      } catch {
        // Nothing further can be done safely.
      }
    }
    return {};
  };
}

// ---------------------------------------------------------------------------
// SessionEnd evidence capture.
// ---------------------------------------------------------------------------

/**
 * `mungeProjectDirectory` — implements docs/engine-baseline.md §7's
 * confirmed cwd -> transcript-directory-name mapping VERBATIM: "cwd `/a/b/c`
 * -> transcript directory name `-a-b-c` (leading `/` -> leading `-`,
 * remaining `/` -> `-`)". No further normalization (case folding, trailing
 * slashes, `.`/`..` segments) is baseline-confirmed, so none is applied.
 */
export function mungeProjectDirectory(cwd: string): string {
  return cwd.replace(/\//g, "-");
}

/** Diagnostic handle returned by `createSessionEndEvidenceHook` — see that function's doc comment for why `lastError`, not a thrown/returned hook error, is this hook's failure-reporting channel. */
export interface SessionEndEvidenceHookHandle {
  readonly callback: HookCallback;
  /** Set when the most recent `SessionEnd` journal append failed; `undefined` otherwise (including before the hook has ever fired). */
  readonly lastError: Error | undefined;
}

function toError(err: unknown): Error {
  return err instanceof Error ? err : new Error(String(err));
}

/**
 * `SessionEnd` hook callback — journals one `evidence_pointer` entry
 * pointing at this worker's own transcript file, path
 * `<configDir>/projects/<mungedCwd>/<sessionId>.jsonl` (docs/engine-
 * baseline.md §7).
 *
 * JOURNAL-APPEND-FAILURE HANDLING (documented choice): the SDK's own
 * `SyncHookJSONOutput`/`AsyncHookJSONOutput` union (`sdk.d.ts` 0.3.210) has
 * no `SessionEndHookSpecificOutput` variant in its `hookSpecificOutput`
 * union at all — there is no dedicated, structured error slot for this
 * event a caller could rely on programmatically. Rather than overload one
 * of the generic string fields (`systemMessage`/`reason`, meant for
 * human-facing text, not machine-checked diagnostics) or silently swallow
 * the failure, this hook exposes the failure on the returned
 * `SessionEndEvidenceHookHandle.lastError` — the adapter (W4) can poll it
 * after the stream ends. The hook itself still never throws (fail-safe,
 * per this file's top-of-file doc comment).
 *
 * `EvidenceRecord` FIELD-FIT NOTE (documented deviation): 04's
 * `evidence_pointer` payload schema validates as `EvidenceRecordSchema`
 * verbatim (`@eo/contracts`, unowned by this worker) — a schema shaped
 * around 14's gate-firing evidence (`command`/`exitStatus`/
 * `toolchainFingerprint`/`objectId`/`artifactDigests`), not around a
 * session-transcript pointer. This hook's exact input signature (this
 * worker's binding brief) carries no `changeSetId`, no process exit
 * status, and no git object id — none of which a `SessionEnd` hook has
 * available. Field-by-field choices, each documented inline at
 * construction below: `changeSetId` reuses `workUnitId` (both `IdSchema`
 * UUID strings — the only identifier this hook's input actually carries);
 * `exitStatus` is a schema-satisfying `0` placeholder (SessionEnd carries
 * an `ExitReason` string, never a numeric process exit code); `objectId`
 * reuses `sessionId` (informative, even though it is not literally a git
 * object id); `toolchainFingerprint` is a static, descriptive string (no
 * engine-version value is threaded into this hook's signature);
 * `artifactDigests` carries the ACTUAL transcript path — this is the field
 * that makes this entry a genuine "pointer to the transcript" per this
 * worker's brief, the other fields are schema-fit placeholders. Flagged in
 * `docs/evidence/phase-06/wi3-adjudication-result.md` for a future
 * coordinated reconciliation between 02/04 and this phase.
 */
export function createSessionEndEvidenceHook(input: {
  readonly journal: JournalStore;
  readonly runId?: string;
  readonly workUnitId: string;
  readonly sessionId: string;
  readonly projectDirectory: string;
  readonly configDir: string;
}): SessionEndEvidenceHookHandle {
  let lastError: Error | undefined;

  const callback: HookCallback = async (hookInput) => {
    try {
      if (hookInput.hook_event_name !== "SessionEnd") {
        return {};
      }

      const transcriptPath = posix.join(
        input.configDir,
        "projects",
        mungeProjectDirectory(input.projectDirectory),
        `${input.sessionId}.jsonl`,
      );

      await input.journal.appendEntry({
        type: "evidence_pointer",
        ...(input.runId !== undefined ? { runId: input.runId } : {}),
        workUnitId: input.workUnitId,
        payload: {
          schemaVersion: CURRENT_SCHEMA_VERSION,
          id: randomUUID(),
          // NOTE 5.3 above: no changeSetId is available at this hook's
          // construction site; workUnitId is the only identifier carried,
          // and it is itself a valid IdSchema (UUID) value.
          changeSetId: input.workUnitId,
          workUnitId: input.workUnitId,
          command: "claude-agent-sdk:session-transcript",
          exitStatus: 0,
          toolchainFingerprint: "@anthropic-ai/claude-agent-sdk",
          capturedAt: new Date().toISOString(),
          artifactDigests: [transcriptPath],
          objectId: input.sessionId,
        },
      });
      lastError = undefined;
    } catch (err) {
      lastError = toError(err);
    }
    return {};
  };

  return {
    callback,
    get lastError() {
      return lastError;
    },
  };
}
