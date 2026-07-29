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
    "Submits one reviewer's verdict for a pipeline stage and returns whether that stage may now close. Closure is computed server-side from every finding on record — required exit criteria, unresolved blocking findings, undispositioned findings at any severity, and debt reopened by this change set's planned writes — never taken from the caller. Four exit criteria are DERIVED from journaled evidence and cannot be claimed: implement-gates-pass, implement-tests-first, integrate-final-candidate-gate (each from the gates' own recorded verdicts) and no-open-debt-in-touched-paths (from the finding store and this change set's planned writes). Claims to any of them are discarded. Rejects a blocking finding that names no exit criterion, a disposition with no evidence, and `approve` submitted over an unresolved blocker.",
  inputSchema: {
    type: "object",
    properties: {
      stage: { type: "string" },
      changeSetId: { type: "string" },
      verdict: { type: "object" },
      /**
       * Exit criteria established OUTSIDE the review, for the criteria no tool
       * can decide — "every task states how it will be known done" and the like.
       *
       * Separate from `verdict` on purpose: a reviewer submits findings and never
       * asserts which criteria are met. The four gate-decidable and
       * debt-decidable criteria are STRIPPED from whatever arrives here and
       * recomputed from evidence, so claiming them has no effect. What remains is
       * the judged set, which is caller-asserted and named as such rather than
       * dressed up as measured.
       */
      metCriteria: { type: "array", items: { type: "string" } },
      /**
       * The object id being merged, for `integrate-final-candidate-gate`.
       *
       * A fact the server checks rather than a criterion the caller asserts:
       * naming an id produces no passing gates for it. Omitted, that criterion
       * does not derive and the integrate stage cannot close.
       */
      candidateObjectId: { type: "string" },
    },
    required: ["stage", "changeSetId", "verdict"],
  },
};
