/**
 * The `PreToolUse` bridge that adjudicates gateway MCP tool calls and the
 * rule-granted mutation-capable built-ins (`Bash`, `Edit`, `Write`).
 *
 * WHY A SECOND BRIDGE EXISTS AT ALL. `./adapter.ts`'s `canUseTool` bridge is
 * the per-call adjudication gate for every tool — except the ones it never
 * sees. A tool named outright in `allowedTools` is auto-approved BEFORE the
 * callback is consulted, and `compileEnvelope` grants the whole gateway family
 * by name, so the journal-first fail-closed bridge never fired for a single
 * connector, evidence or review call. The SDK says so itself, unprompted:
 *
 *   [CLAUDE_SDK_CAN_USE_TOOL_SHADOWED] canUseTool will not be invoked for:
 *   mcp__<gateway>__*. Bare allowedTools entries auto-approve the whole tool
 *   before the callback is consulted. To gate every tool call, use a PreToolUse
 *   hook.
 *
 * Both halves of that were measured before this was written, not assumed —
 * `docs/engine-baseline.md` §4.5 (the shadowing) and §4.6 (a `PreToolUse` hook
 * DOES fire for an MCP call), via
 * `./live/mcp-adjudication-shadowing.live.test.ts`. Hooks run BEFORE permission
 * evaluation, which is precisely why an allow entry cannot shadow one.
 *
 * THE WIRE NAME IS UNDERSCORED, AND THIS IS THE TRAP. The engine normalizes a
 * dot in an MCP tool name to an underscore: the gateway advertises
 * `contract.approve`, the SDK's own warning quotes `contract.approve`, and the
 * `tool_name` a hook receives is `..._contract_approve`. Every real gateway tool
 * is dotted, so a matcher written against the advertised name matches NOTHING —
 * a control that looks installed and is not, which is the same shape of defect
 * as the shadowing this exists to fix. Baseline §4.6; it cost three inconclusive
 * probe runs to notice.
 *
 * SCOPED TO THE RULE-GRANTED TOOLS, DELIBERATELY. This adjudicates the gateway
 * family AND the mutation-capable built-ins the compiled profile grants by
 * rule — `Bash(<prefix>:*)`, `Edit(//<worktree>/…/**)`, `Write(...)`. A
 * rule-shaped allow entry shadows `canUseTool` exactly like a bare name does
 * (baseline §4.7, measured live 2026-07-30 by
 * `./live/builtin-allow-rule-shadowing.live.test.ts` for the Bash-prefix
 * shape; the SDK's own warning generalizes the mechanism to every settings
 * allow rule), so before this hook covered them, `Bash`/`Edit`/`Write`
 * executed with no adjudication record and sat outside the PostToolUse
 * audit's scope. Everything ELSE — `Read`, `Glob`, `Grep`, `TodoWrite`, other
 * servers' MCP tools — is left alone: the envelope policy default-denies any
 * unlisted tool while the engine grants read-only tools without a rule, so
 * covering them would journal a meaningless deny verdict for every read and
 * black-hole them all whenever adjudication is unavailable.
 *
 * TWO ENFORCEMENT POSTURES, BECAUSE THE POLICY'S FIDELITY DIFFERS BY TOOL.
 * For GATEWAY tools the policy matches on name — the same axis the engine's
 * own rule grants them on — so its deny is enforced. For BUILT-INS the policy
 * is measurably STRICTER than the engine inside a matched rule (baseline
 * §4.8: the engine allows `git status 2>&1` under `Bash(git status:*)`; the
 * policy's unproven-metacharacter fail-closed denies it), and its verdict is
 * argument-level commentary the engine does not share. Acting on it would
 * refuse calls the engine grants — so a built-in's verdict is RECORDED
 * (journal, via the bus; audit, via `recordAllowedDecision` on BOTH verdicts)
 * and never acted on, except: adjudication UNAVAILABLE denies (no unrecorded
 * mutation call may proceed), and an explicit `interrupt` halt is honored.
 * The journal entry is the alarm; the engine's own rule evaluation plus the
 * OS sandbox remain the boundary. "What it restores is the RECORD, not a
 * refusal" (`docs/security-posture.md`) — for built-ins, literally.
 *
 * NEVER WIDENS. On no path does this bridge emit `permissionDecision:
 * "allow"` — a `PreToolUse` allow bypasses the permission system and could
 * override the compiled profile's own deny entries. The allow path returns NO
 * OPINION and lets the engine decide as it always did.
 */
import type {
  HookCallbackMatcher,
  HookJSONOutput,
  PreToolUseHookInput,
} from "@anthropic-ai/claude-agent-sdk";
import { GATEWAY_MCP_SERVER_NAME } from "@crabgic/contracts";
import type { AdjudicationCallback, AdjudicationDecision } from "@crabgic/engine-core";
import type { AdjudicationAuditLog } from "./hooks.js";

/**
 * The wire prefix every gateway tool carries, built from the constant rather
 * than typed out (Gap 11: the literal has exactly one definition site).
 */
export const GATEWAY_TOOL_WIRE_PREFIX = `mcp__${GATEWAY_MCP_SERVER_NAME}__`;

/** Denial text for an adjudication that could not be obtained — the same fail-closed wording the `canUseTool` bridge uses. */
const GENERIC_ADJUDICATION_FAILURE_MESSAGE =
  "tool call denied: adjudication was unavailable (the callback threw, rejected, or is absent) " +
  "— failing closed";

/** The one deny shape this bridge emits, so every refusal path is identical by construction. */
function denyOutput(reason: string, interrupt?: boolean): HookJSONOutput {
  return {
    ...(interrupt === true ? { continue: false, stopReason: reason } : {}),
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: reason,
    },
  };
}

/** True for a gateway tool. Matches the UNDERSCORED wire form, which is the only form a hook ever sees. */
export function isGatewayTool(toolName: string): boolean {
  return toolName.startsWith(GATEWAY_TOOL_WIRE_PREFIX);
}

/**
 * The built-ins this bridge adjudicates: exactly the mutation-capable tools
 * `emitPermissionProfile` grants BY RULE, whose matched allow entries shadow
 * `canUseTool` (baseline §4.7). Their verdicts are recorded, never enforced —
 * see the file-level "two enforcement postures" note. Widening this set is
 * NOT safe by default — read that note before adding a member.
 */
export const ADJUDICATED_BUILTIN_TOOLS: ReadonlySet<string> = new Set(["Bash", "Edit", "Write"]);

/** True for a tool this bridge owns: the gateway family plus the rule-granted built-ins. */
export function isAdjudicatedTool(toolName: string): boolean {
  return isGatewayTool(toolName) || ADJUDICATED_BUILTIN_TOOLS.has(toolName);
}

/**
 * Builds the `PreToolUse` matcher list that adjudicates gateway tool calls and
 * the rule-granted built-ins.
 *
 * Fail-closed on every path a decision could go missing: a throwing callback, a
 * rejecting one, an absent one, and a malformed hook input are all denials, and
 * never an allow.
 */
export function createToolAdjudicationHook(params: {
  readonly adjudicate: AdjudicationCallback;
  readonly audit: AdjudicationAuditLog;
}): readonly HookCallbackMatcher[] {
  return [
    {
      hooks: [
        async (input, _toolUseId, options): Promise<HookJSONOutput> => {
          const hookInput = input as PreToolUseHookInput;
          const toolName = hookInput.tool_name;

          // A nameless call is never legitimate, and for an allow-listed tool
          // "no opinion" means auto-approved — so it is denied rather than
          // waved through. Not reachable today (the engine always supplies a
          // string), which is exactly why the earlier version's fail-OPEN went
          // unnoticed.
          if (typeof toolName !== "string" || toolName.length === 0) {
            return denyOutput("tool call denied: the hook received no tool name to adjudicate");
          }

          // Not ours. Returning an empty output leaves the engine's own
          // decision untouched. The excluded tools are the ones the profile
          // grants NO rule for — the envelope policy would default-deny them
          // all while the engine grants them without a rule, so an opinion
          // here would black-hole them (file-level scope note).
          if (!isAdjudicatedTool(toolName)) return {};

          const toolInput =
            typeof hookInput.tool_input === "object" && hookInput.tool_input !== null
              ? (hookInput.tool_input as Readonly<Record<string, unknown>>)
              : {};

          // The shape check lives INSIDE the try. A callback that RESOLVES
          // something malformed used to make `decision.behavior` throw outside
          // it, which the engine then turns into a whole-turn stop rather than
          // one denied call — fail-closed, but with no audit or journal record
          // and a dead worker.
          let decision: AdjudicationDecision | undefined;
          try {
            const resolved = await params.adjudicate(toolName, toolInput, {
              signal: options.signal,
            });
            decision =
              resolved.behavior === "allow" || resolved.behavior === "deny" ? resolved : undefined;
          } catch {
            decision = undefined;
          }

          // Adjudication UNAVAILABLE (threw, rejected, absent, malformed): deny,
          // for every covered tool. Record-not-refuse presumes a record exists;
          // a call with neither a trustworthy journal entry nor an audit record
          // must not proceed.
          if (decision === undefined) {
            return denyOutput(GENERIC_ADJUDICATION_FAILURE_MESSAGE);
          }

          if (decision.behavior === "allow") {
            // NO OPINION ON ALLOW — this bridge never widens.
            //
            // A `PreToolUse` hook returning `permissionDecision: "allow"`
            // BYPASSES the permission system for that call, which would let this
            // bridge override the compiled profile's own deny entries. A control
            // added to close a hole must not be able to open a wider one, so the
            // allow path returns no opinion and lets the engine evaluate exactly
            // as it did before: the tool is allow-listed, so it proceeds. The
            // adjudication still happened and is still recorded — what changes on
            // this path is only that nothing is bypassed.
            //
            // Consequence, stated because it is a real difference from the
            // `canUseTool` bridge: a policy's canonicalized `updatedInput` is NOT
            // applied to a call this bridge allows. The audit therefore records
            // the input that will actually execute, not the canonicalized one —
            // recording the latter would make every such call look like an
            // executed-vs-adjudicated mismatch to the PostToolUse audit and could
            // abort workers over a difference this bridge introduced itself.
            params.audit.recordAllowedDecision(toolName, toolInput);
            return {};
          }

          // `interrupt: true` is a policy explicitly demanding the worker halt —
          // a different statement from a routine verdict, carried through for
          // every covered tool, matching the `canUseTool` bridge.
          if (decision.interrupt === true) {
            return denyOutput(decision.message, true);
          }

          if (ADJUDICATED_BUILTIN_TOOLS.has(toolName)) {
            // RECORD-NOT-REFUSE for a built-in's policy deny. The envelope
            // policy is measurably STRICTER than the engine inside a matched
            // rule (baseline §4.8: the engine allows `git status 2>&1` under
            // `Bash(git status:*)`; the policy's unproven-metacharacter
            // fail-closed denies it), so acting on the verdict would refuse
            // calls the engine grants — a worker-reliability regression on the
            // primary toolset. And returning no opinion WITHOUT recording would
            // false-abort the PostToolUse audit whenever the engine executes a
            // policy-denied call. So the verdict stays journaled (the bus wrote
            // it before resolving), the input is recorded for the audit's
            // executed-vs-adjudicated check, and the ENGINE keeps deciding
            // exactly as it did before this bridge existed. The journal entry
            // is the alarm; the engine's own rule evaluation plus the OS
            // sandbox remain the boundary.
            params.audit.recordAllowedDecision(toolName, toolInput);
            return {};
          }

          // Gateway tools act on the deny: the policy matches them on NAME, the
          // same axis the engine's own rule grants them on, so no §4.8-style
          // divergence is possible and the deny is safe to enforce.
          return denyOutput(decision.message);
        },
      ],
    },
  ];
}
