/**
 * The `PreToolUse` bridge that adjudicates gateway MCP tool calls.
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
 * SCOPED TO THE GATEWAY, DELIBERATELY. This adjudicates only tools under the
 * gateway prefix. Everything else still goes through `canUseTool`, which the
 * engine does invoke for it, and adjudicating a tool twice would journal two
 * decisions for one call.
 *
 * MONOTONICALLY RESTRICTIVE. It can deny a call the engine would have allowed;
 * it can never allow one the engine would have denied. A `PreToolUse` hook
 * returning `permissionDecision: "allow"` bypasses the permission system for
 * that call, so an "allow" here could override the compiled profile's own deny
 * entries — a control added to close a hole opening a wider one. The allow path
 * therefore returns NO OPINION and lets the engine decide as it always did.
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
  "gateway tool call denied: adjudication was unavailable (the callback threw, rejected, or is absent) " +
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

/** True for a tool this bridge owns. Matches the UNDERSCORED wire form, which is the only form a hook ever sees. */
export function isGatewayTool(toolName: string): boolean {
  return toolName.startsWith(GATEWAY_TOOL_WIRE_PREFIX);
}

/**
 * Builds the `PreToolUse` matcher list that adjudicates gateway tool calls.
 *
 * Fail-closed on every path a decision could go missing: a throwing callback, a
 * rejecting one, an absent one, and a malformed hook input are all denials, and
 * never an allow.
 */
export function createGatewayAdjudicationHook(params: {
  readonly adjudicate: AdjudicationCallback;
  readonly audit: AdjudicationAuditLog;
}): readonly HookCallbackMatcher[] {
  return [
    {
      hooks: [
        async (input, _toolUseId, options): Promise<HookJSONOutput> => {
          const hookInput = input as PreToolUseHookInput;
          const toolName = hookInput.tool_name;

          // A nameless call is never legitimate, and for a gateway tool "no
          // opinion" means auto-approved — so it is denied rather than waved
          // through. Not reachable today (the engine always supplies a string),
          // which is exactly why the earlier version's fail-OPEN went unnoticed.
          if (typeof toolName !== "string" || toolName.length === 0) {
            return denyOutput(
              "gateway tool call denied: the hook received no tool name to adjudicate",
            );
          }

          // Not ours. Returning an empty output leaves the engine's own decision
          // untouched, so this never becomes a second opinion on another
          // bridge's tools. NOTE this is NOT a claim that `canUseTool`
          // adjudicates them — adversarial review found that premise unverified
          // and probably false for `Bash`/`Edit`/`Write`, which are allow-listed
          // the same way. See `docs/security-posture.md`; a probe is owed.
          if (!isGatewayTool(toolName)) return {};

          const toolInput =
            typeof hookInput.tool_input === "object" && hookInput.tool_input !== null
              ? (hookInput.tool_input as Readonly<Record<string, unknown>>)
              : {};

          // The shape check lives INSIDE the try. A callback that RESOLVES
          // something malformed used to make `decision.behavior` throw outside
          // it, which the engine then turns into a whole-turn stop rather than
          // one denied call — fail-closed, but with no audit or journal record
          // and a dead worker.
          let decision: AdjudicationDecision;
          try {
            const resolved = await params.adjudicate(toolName, toolInput, {
              signal: options.signal,
            });
            decision =
              resolved.behavior === "allow" || resolved.behavior === "deny"
                ? resolved
                : { behavior: "deny", message: GENERIC_ADJUDICATION_FAILURE_MESSAGE };
          } catch {
            decision = { behavior: "deny", message: GENERIC_ADJUDICATION_FAILURE_MESSAGE };
          }

          if (decision.behavior === "allow") {
            // NO OPINION ON ALLOW — this bridge can only ever DENY.
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
            // applied to a gateway call. The audit therefore records the input
            // that will actually execute, not the canonicalized one — recording
            // the latter would make every gateway call look like an
            // executed-vs-adjudicated mismatch to the PostToolUse audit and could
            // abort workers over a difference this bridge introduced itself.
            params.audit.recordAllowedDecision(toolName, toolInput);
            return {};
          }
          // `interrupt` is carried through, matching the `canUseTool` bridge: a
          // policy that wants to halt the worker rather than refuse one call
          // must be able to say so for a gateway call too.
          return denyOutput(decision.message, decision.interrupt);
        },
      ],
    },
  ];
}
