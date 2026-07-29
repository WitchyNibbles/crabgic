import type { McpToolDefinition } from "../gateway-mcp/registry.js";

/**
 * `review.submit` — the staged review pipeline's only write surface for a
 * reviewer (ledger Gap 20).
 *
 * Wire name `mcp__${GATEWAY_MCP_SERVER_NAME}__review.submit`, following the
 * same descriptor/handler split as `../intake/tool-definitions.ts`: this module
 * owns the descriptor, `./review-submit-handler.ts` owns the logic.
 *
 * The tool returns whether the stage may close. It does not accept that as
 * input, which is the whole point — a reviewer supplies findings, and the
 * server decides what they add up to.
 */
export const REVIEW_SUBMIT_TOOL: McpToolDefinition = {
  name: "review.submit",
  description:
    "Submits one reviewer's verdict for a pipeline stage and returns whether that stage may now close. Closure is computed server-side from every finding on record — required exit criteria, unresolved blocking findings, undispositioned findings at any severity, and debt reopened by this change set's planned writes — never taken from the caller. Rejects a blocking finding that names no exit criterion, a disposition with no evidence, and `approve` submitted over an unresolved blocker.",
  inputSchema: {
    type: "object",
    properties: {
      stage: { type: "string" },
      changeSetId: { type: "string" },
      verdict: { type: "object" },
      /**
       * Exit criteria established OUTSIDE the review — gate verdicts, and the
       * orchestrator's own record of what a stage produced.
       *
       * Separate from `verdict` on purpose, and the distinction is the point:
       * a reviewer submits findings and never asserts which criteria are met.
       * This is still weaker than deriving them server-side, which needs a
       * gate-verdict store this does not have yet; the honest description is
       * that the REVIEWER cannot satisfy its own gate, not that nobody can.
       */
      metCriteria: { type: "array", items: { type: "string" } },
    },
    required: ["stage", "changeSetId", "verdict"],
  },
};
