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
    "Submits one reviewer's verdict for a pipeline stage and returns whether that stage may now close. Closure is computed server-side from every finding on record — required exit criteria, unresolved blocking findings, undispositioned findings at any severity, and debt reopened by this change set's planned writes — never taken from the caller. Four exit criteria are DERIVED from journaled evidence and cannot be claimed: implement-gates-pass, implement-tests-first, integrate-final-candidate-gate (each from the gates' own recorded verdicts) and no-open-debt-in-touched-paths (from the finding store and this change set's planned writes). Six more are decided by the ARTIFACT when one is supplied as `design` / `plan`: risks each carrying a mitigation or a stated acceptance, interfaces naming their owning package, tasks stating done-criteria, a dependency graph that is genuinely acyclic, and the plan covering every element of the design the design stage stored. Every REMAINING criterion is a judgement and needs an entry in `attestations` naming who asserts it, why, and where in the artifact to look — a bare string in `metCriteria` does not count and is reported back in `unattestedCriteria`. An attestation is void while an unresolved blocking finding, or the artifact itself, contradicts its criterion. Rejects a blocking finding that names no exit criterion, a disposition with no evidence, `approve` submitted over an unresolved blocker, and an attestation with no asserter, rationale or anchor.",
  inputSchema: {
    type: "object",
    properties: {
      stage: { type: "string" },
      changeSetId: { type: "string" },
      verdict: { type: "object" },
      /**
       * Legacy bare-string criteria. Retained so a caller using the old shape gets
       * told, not so it works.
       *
       * The four gate-decidable and debt-decidable criteria are recomputed from
       * evidence, so claiming them has no effect. Everything else needs an
       * `attestations` entry and is reported in `unattestedCriteria` when it does
       * not have one — a criterion that quietly stayed unmet is the failure mode of
       * every silent strip.
       */
      metCriteria: { type: "array", items: { type: "string" } },
      /**
       * The design artifact as data: `elements` (id, name, addresses), `interfaces`
       * (name, package), `risks` (id, statement, mitigation? / acceptedBecause?).
       *
       * Submitting the ARTIFACT is not claiming a criterion — the caller supplies
       * the thing under review and the server decides what it adds up to. An empty
       * list decides nothing in either direction: it neither proves the criterion
       * nor refutes it, so "this design records no risks" is left to an attestation.
       */
      design: { type: "object" },
      /**
       * The plan artifact as data: `tasks` (id, statement, doneCriteria, dependsOn,
       * covers). `covers` names `DesignElement` ids, and coverage is scored against
       * the design record on file — not against this plan's own claims.
       */
      plan: { type: "object" },
      /**
       * Attributed claims that this stage's JUDGED criteria are met.
       *
       * Each entry: `criterion`, `asserter` (who), `rationale` (why),
       * `artifactAnchor` (where to look), `assertedAt`, `round`. All required
       * non-empty — each removes one way a claim can be unfalsifiable.
       *
       * This does not make the criterion decidable and is not presented as
       * verification. It makes the CLAIM attributable, which is a different
       * property and a reachable one: a named judgement pointing at a named place
       * can be checked and found wanting, and an anonymous `true` cannot.
       */
      attestations: {
        type: "array",
        items: {
          type: "object",
          properties: {
            criterion: { type: "string" },
            asserter: { type: "string" },
            rationale: { type: "string" },
            artifactAnchor: { type: "string" },
            assertedAt: { type: "string" },
            round: { type: "number" },
          },
          required: ["criterion", "asserter", "rationale", "artifactAnchor", "assertedAt", "round"],
        },
      },
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

/**
 * `review.calibrate` — the calibration corpus's write surface.
 *
 * Wire name `mcp__${GATEWAY_MCP_SERVER_NAME}__review.calibrate`. An MCP tool and
 * not a CLI command, per the 2026-07-28 ruling: the owner's judgement arrives in
 * conversation, so it is recorded from conversation.
 *
 * Ledger Gap 20's disclosed residual said the `blocking`/`advisory` split had no
 * calibration. The scorer and the store both shipped; nothing ever called the
 * store, so `sampleSize: 0` was a property of the product rather than a project's
 * starting state. This is what makes the number able to move.
 */
export const REVIEW_CALIBRATE_TOOL: McpToolDefinition = {
  name: "review.calibrate",
  description:
    "Records the owner's own call on how a finding SHOULD have been classified, building the corpus that decides whether the blocking/advisory classifier can be trusted. Called with no arguments, reports where the corpus stands — Cohen's kappa with its 95% lower bound, the two error directions separately, what is still missing — and which findings are worth putting to the owner next, preferring the two shapes a misclassification leaves behind (an advisory finding that got fixed anyway, a blocking finding that got refuted). The classifier's own call is NOT an input: it is read from the finding on record, so manufactured agreement cannot be recorded.",
  inputSchema: {
    type: "object",
    properties: {
      /** Omit both fields to ask for status and suggestions instead of recording. */
      findingId: { type: "string" },
      /**
       * The owner's call — `blocking` or `advisory`. The only thing this tool
       * takes, because it is the only thing the server cannot derive.
       */
      ownerClassification: { type: "string", enum: ["blocking", "advisory"] },
    },
    required: [],
  },
};
