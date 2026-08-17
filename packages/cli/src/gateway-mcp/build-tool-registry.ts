/**
 * The gateway MCP server's production composition root — the single place
 * every tool family the shipped binary exposes is actually registered.
 *
 * Until 2026-07-25 `cli-entry.ts` booted an EMPTY registry: the eight
 * families interface-ledger Gap 1 counts all existed, fully built and
 * tested, and none of them was reachable from the binary. 16's native
 * families lived behind a dependency edge `packages/cli` did not have; 11's
 * `project.inspect`/`contract.approve` and 12's `capability.audit`/
 * `capability.approve` shipped as descriptor constants plus plain handler
 * functions with no production caller at all. This module is the seam every
 * one of those phases deferred, and it is deliberately the ONLY new
 * coupling: neither `@crabgic/gateway` nor `@crabgic/detect` learns about the other,
 * because `packages/cli` already depends on both.
 *
 * The descriptor constants stay the single source of truth for each tool's
 * name and description — this module re-expresses only the input SHAPE, as
 * zod (which `GatewayToolDefinition` needs and the SDK converts to JSON
 * Schema on the wire), never a second copy of the prose.
 *
 * Provider-dispatch population — registering 18/19's Jira and 20's Grafana
 * clients into `ProviderRegistry` — used to be deliberately absent here,
 * on the reasoning that it "needs resolved credentials." WP5 (2026-07-25)
 * establishes that reasoning was too strong for the REGISTRATION half:
 * `registerJiraCloudProvider` and `registerRoutedGrafanaProvider` take
 * only the two registries — no credentials, no I/O — and hand back a
 * per-connection registry the connection lifecycle fills in later. The two
 * registries are now supplied by the caller (`../bootstrap.ts`), populated,
 * rather than constructed EMPTY inline as they were until then. That
 * changes `tracker.*`/`observability.*`'s failure mode for a configured
 * connection from a misleading `UnknownProviderError` ("this build has no
 * Jira connector") to a typed `Jira/GrafanaConnectionNotRegisteredError`
 * ("that connection has not been wired yet"), which is strictly more
 * honest. What genuinely remains blocked on live credentials is the
 * per-connection `register()` call itself — see
 * `e2e/live/src/knownDeferredAllowlist.ts`.
 */
import { z } from "zod";
import type { JournalStore } from "@crabgic/journal";
import {
  buildNativeToolRegistry,
  GatewayToolRegistry,
  type ProviderRegistry,
  type AnyGatewayToolDefinition,
  type GatewayToolDefinition,
  type GenericProviderClient,
  type MutationApplyClient,
  type ExternalConnectionRepository,
} from "@crabgic/gateway";
import {
  CAPABILITY_APPROVE_TOOL,
  CAPABILITY_AUDIT_TOOL,
  runCapabilityApprove,
  runCapabilityAudit,
  type CapabilityApproveDeps,
  type CapabilityAuditDeps,
} from "@crabgic/detect";
import { resolveRequirements, type ProjectInspectDeps, type Registry } from "@crabgic/supervisor";
import { completedStageIds } from "@crabgic/contracts";
import type {
  AuthorizationEnvelope,
  ChangeSet,
  ExternalConnection,
  IntentContract,
  Requirement,
  WorkUnit,
} from "@crabgic/contracts";
import { CONTRACT_APPROVE_TOOL, PROJECT_INSPECT_TOOL } from "../intake/tool-definitions.js";
import {
  REPORT_RENDER_SHAPE,
  REPORT_RENDER_TOOL,
  runReportRenderTool,
  type ReportRenderArgs,
} from "./report-tool-definition.js";
import {
  PIPELINE_PLAN_TOOL,
  REVIEW_CALIBRATE_TOOL,
  REVIEW_SUBMIT_TOOL,
} from "../review/tool-definitions.js";
import { runPipelinePlan } from "../review/pipeline-plan-handler.js";
import { runReviewCalibrate } from "../review/calibrate-handler.js";
import { runReviewSubmit } from "../review/review-submit-handler.js";
import { loadFindings, saveFindings } from "../review/finding-store.js";
import { loadStageCompletions, recordStageCompletion } from "../review/stage-completion-store.js";
import { loadAttestations, saveAttestationsForStage } from "../review/attestation-store.js";
import { loadArtifacts, saveArtifacts } from "../review/artifact-store.js";
import { loadDesignVerdicts, verdictInForce } from "../review/design-verdict-store.js";
import { GATE_DERIVED_CRITERIA, deriveGateCriteria } from "../review/gate-criteria.js";
import { scoreCalibration } from "../review/calibration.js";
import { loadCalibrationSamples, recordCalibrationSample } from "../review/calibration-store.js";
import { queryEvidence } from "../evidence/query.js";
import { runProjectInspectTool } from "../intake/project-inspect-handler.js";
import { runContractApprove } from "../intake/contract-approve-handler.js";

/** Everything the composed registry needs, all of it already built by `../bootstrap.ts` for the CLI's own command surface. */
export interface ProductionGatewayToolRegistryDeps {
  readonly journal: JournalStore;
  readonly connections: ExternalConnectionRepository;
  /**
   * Fills the per-connection registries behind the two provider-dispatch
   * points above, lazily, on first dispatch for each connection. Without
   * it those registries stay empty forever and every connector answers
   * "was never registered" (issue #135, defect 3).
   */
  readonly activateConnection?: (connection: ExternalConnection) => Promise<void>;
  /**
   * 16's read/plan provider-dispatch point, ALREADY POPULATED by the
   * caller. Supplied rather than constructed here so that the same
   * instances the connection lifecycle registers connections into are the
   * ones `tracker.*`/`observability.*` dispatch through — two registries
   * built in two places would leave this one permanently empty, which is
   * exactly the defect this parameter fixes.
   */
  readonly providers: ProviderRegistry<GenericProviderClient>;
  /** 16's mutation-apply dispatch point (`tracker.apply`/`observability.apply`), same sharing requirement. */
  readonly mutationApplyClients: ProviderRegistry<MutationApplyClient>;
  readonly supervisorSocketPath: string;
  /** The project's durable approval signing key — the same one `run` minted its token under (see `../approval/signing-key.ts`). */
  readonly approvalSigningKey: Buffer;
  readonly changeSets: Registry<ChangeSet>;
  readonly workUnits: Registry<WorkUnit>;
  readonly envelopes: Registry<AuthorizationEnvelope>;
  readonly intentContracts: Registry<IntentContract>;
  /** Durable `Requirement` store (roadmap/24) — the records the ready transition seals. */
  readonly requirements: Registry<Requirement>;
  readonly capability: CapabilityAuditDeps;
  /** Verifies a `trust approve` token — the process-wide minter `../bootstrap.ts` builds. */
  readonly approvalTokenVerifier: CapabilityApproveDeps["minter"];
  /** Resolves the capability-store key a digest belongs to — 12's `capability.approve` needs it and deliberately does not guess. */
  readonly resolveCapabilityStoreKey: (digest: string) => string | undefined;
  /**
   * Where this project's review findings live, and the XDG state root the
   * store's directory chain is verified below.
   *
   * Supplied rather than derived here for the same reason the provider
   * registries are: `../bootstrap.ts` already resolves the XDG env and the
   * project hash, and a second derivation is a second answer to "where is this
   * project's state" that can disagree with the first.
   */
  readonly reviewFindingsPath: string;
  readonly reviewStateHome: string;
  /** Where the owner's calibration judgements about the classifier live. */
  readonly reviewCalibrationPath: string;
  /** Where the attributed claims about judged exit criteria live. */
  readonly reviewAttestationsPath: string;
  /** Where the structured design and plan records live, per ChangeSet. */
  readonly reviewArtifactsPath: string;
  /**
   * Where the record of which stages have CLOSED lives — owner ruling R8
   * (2026-08-16), ledger Gap 23's disclosed residual 2.
   *
   * The registry WRITES this one, and that is the difference from
   * `reviewDesignVerdictsPath` directly above. A design verdict is the owner's
   * answer and nothing session-reachable may record it; a stage completion is
   * the SERVER's own closure computation, and `review.submit` is the one place
   * in the product that computes it. Writing it anywhere else would be a second
   * answer to a question that already has one.
   */
  readonly reviewStageCompletionsPath: string;
  /**
   * Where the OWNER's design verdicts live — the design gate's only key
   * (owner ruling R2, roadmap/25 WI 5).
   *
   * The registry READS this path and never writes it. There is deliberately no
   * gateway tool that records a verdict: if a tool the model can call could,
   * the model could approve its own design and the gate would be a checkpoint.
   * The CLI is the only writer, which is the owner typing on their own
   * terminal — the same division ledger Gap 18 draws around the
   * `EnvelopePolicy`.
   */
  readonly reviewDesignVerdictsPath: string;
}

/**
 * `review.submit` — the staged review pipeline's write surface (ledger Gap 20).
 *
 * The two inputs the SERVER supplies, never the caller:
 *
 *   - `plannedWrites` comes from the ChangeSet's own AuthorizationEnvelope
 *     `ownedPaths`, which is what the run is actually allowed to write. Taking
 *     it from the caller would let a reviewer decide which debt it has to face
 *     by understating what it intends to touch.
 *   - `priorFindings` comes from the durable store, so a clean round cannot
 *     erase an open blocker somebody else raised.
 */
function buildReviewTools(
  deps: ProductionGatewayToolRegistryDeps,
): readonly AnyGatewayToolDefinition[] {
  const reviewSubmit: GatewayToolDefinition<typeof REVIEW_SUBMIT_SHAPE> = {
    name: REVIEW_SUBMIT_TOOL.name,
    description: REVIEW_SUBMIT_TOOL.description,
    inputSchema: REVIEW_SUBMIT_SHAPE,
    handler: async (args) => {
      const changeSet = deps.changeSets.get(args.changeSetId);
      if (changeSet === undefined) {
        return errorResult(`unknown ChangeSet "${args.changeSetId}"`);
      }
      const envelope = deps.envelopes
        .list()
        .find((candidate) => candidate.changeSetId === args.changeSetId);

      const prior = await loadFindings(deps.reviewFindingsPath);
      const priorAttestations = await loadAttestations(deps.reviewAttestationsPath);
      // The design record the design stage left behind is what the plan stage's
      // coverage criterion is scored against — supplied by the SERVER, never by the
      // plan being checked.
      const priorArtifacts = await loadArtifacts(deps.reviewArtifactsPath, args.changeSetId);
      // Read-only, and the latest verdict wins: an earlier approval must not
      // satisfy a gate the owner has since re-answered.
      const ownerVerdict = verdictInForce(
        await loadDesignVerdicts(deps.reviewDesignVerdictsPath),
        args.changeSetId,
      );
      // Scored from the owner's own corpus, and reported on the response. A
      // fresh project has none, which is normal — what would not be normal is
      // handing back a blocking/advisory verdict without saying whether anyone
      // has ever checked that classifier.
      const calibration = scoreCalibration(
        await loadCalibrationSamples(deps.reviewCalibrationPath),
      );

      // The gate-decidable criteria are DERIVED from journaled evidence and then
      // subtracted from whatever the caller claimed. A caller that asserts
      // `implement-gates-pass` without gate evidence to back it is not
      // believed — the pipeline's own rule that anything a deterministic gate
      // decides is decided by the gate, applied to every criterion this tool can
      // actually check.
      //
      // The subtraction reads `GATE_DERIVED_CRITERIA` rather than naming the ids
      // here, so a criterion that becomes derivable becomes unclaimable in the
      // same edit. A second list would drift, and the drift would be silent and
      // in the believing direction.
      const evidence = await queryEvidence({
        journal: deps.journal,
        changeSetId: args.changeSetId,
      });
      const derived = deriveGateCriteria(evidence.records, {
        ...(args.candidateObjectId !== undefined
          ? { candidateObjectId: args.candidateObjectId }
          : {}),
      });
      const claimed = (args.metCriteria ?? []).filter(
        (criterion) => !GATE_DERIVED_CRITERIA.includes(criterion),
      );
      const metCriteria = [...claimed, ...derived];
      const result = await runReviewSubmit(
        {
          stage: args.stage,
          verdict: args.verdict,
          ...(args.attestations !== undefined ? { attestations: args.attestations } : {}),
          ...(args.design !== undefined ? { design: args.design } : {}),
          ...(args.plan !== undefined ? { plan: args.plan } : {}),
        },
        {
          appendEvidence: () => Promise.resolve(),
          priorFindings: () => prior,
          plannedWrites: () => envelope?.ownedPaths ?? [],
          metCriteria: () => metCriteria,
          priorAttestations: () => priorAttestations,
          priorDesign: () => priorArtifacts.design,
          priorPlan: () => priorArtifacts.plan,
          ownerDesignVerdict: () => ownerVerdict,
          /**
           * Appended only when `runReviewSubmit`'s own `stageClosable` is true —
           * the handler guards the call, and this closure supplies only what the
           * handler could not know: the ChangeSet it was scoped to, and the
           * moment it closed.
           *
           * `closedAt` is stamped HERE and never accepted from the caller, the
           * same rule `crabgic design approve` earned: a supplied timestamp can
           * be backdated, and when a stage actually closed is the only thing the
           * field is for.
           */
          recordStageCompletion: (closure) =>
            recordStageCompletion(
              deps.reviewStageCompletionsPath,
              {
                schemaVersion: 1,
                changeSetId: args.changeSetId,
                stage: closure.stage,
                round: closure.round,
                artifactRef: closure.artifactRef,
                closedAt: new Date().toISOString(),
              },
              deps.reviewStateHome,
            ),
          calibration: () => ({
            calibrated: calibration.calibrated,
            kappa: calibration.kappa,
            kappaLowerBound: calibration.kappaLowerBound,
            sampleSize: calibration.sampleSize,
            samplesNeeded: calibration.samplesNeeded,
            verdictReason: calibration.verdictReason,
          }),
        },
      );

      // Persisted only on a valid submission, and persisted as the set the
      // decision was computed from rather than as the set that was submitted.
      if (result.ok && result.findings !== undefined) {
        await saveFindings(deps.reviewFindingsPath, result.findings, deps.reviewStateHome);
      }
      // Persisted per stage, and only the stage that was submitted — a submission
      // for `implement` knows nothing about what the design stage established.
      if (result.ok && result.attestations !== undefined) {
        await saveAttestationsForStage(
          deps.reviewAttestationsPath,
          args.stage,
          result.attestations,
          deps.reviewStateHome,
        );
      }
      // Persisted as the record the decision was computed from, and only what this
      // submission carried — a plan submission must not erase the design it was
      // scored against.
      if (result.ok && (result.designOfRecord !== undefined || result.planOfRecord !== undefined)) {
        await saveArtifacts(
          deps.reviewArtifactsPath,
          args.changeSetId,
          {
            ...(result.designOfRecord !== undefined ? { design: result.designOfRecord } : {}),
            ...(result.planOfRecord !== undefined ? { plan: result.planOfRecord } : {}),
          },
          deps.reviewStateHome,
        );
      }
      return jsonResult(result);
    },
  };

  /**
   * `review.calibrate` — where the owner's judgement about the classifier goes.
   *
   * `recordCalibrationSample` shipped tested and unreachable: nothing called it,
   * so `sampleSize: 0` was a permanent property of the product rather than a
   * project's starting state. This is the surface that changes that, and it is an
   * MCP tool rather than a CLI command per the 2026-07-28 ruling — the owner's
   * call arrives in conversation, so it is recorded from conversation.
   *
   * The classifier's own call is NOT an argument. It is read from the finding
   * store, which is what stops a caller recording twenty flattering samples and
   * certifying the classifier itself.
   */
  const reviewCalibrate: GatewayToolDefinition<typeof REVIEW_CALIBRATE_SHAPE> = {
    name: REVIEW_CALIBRATE_TOOL.name,
    description: REVIEW_CALIBRATE_TOOL.description,
    inputSchema: REVIEW_CALIBRATE_SHAPE,
    handler: async (args) => {
      const samples = await loadCalibrationSamples(deps.reviewCalibrationPath);
      const findings = await loadFindings(deps.reviewFindingsPath);
      const result = await runReviewCalibrate(
        {
          ...(args.findingId !== undefined ? { findingId: args.findingId } : {}),
          ...(args.ownerClassification !== undefined
            ? { ownerClassification: args.ownerClassification }
            : {}),
        },
        {
          findings: () => findings,
          samples: () => samples,
          record: (sample) =>
            recordCalibrationSample(deps.reviewCalibrationPath, sample, deps.reviewStateHome),
        },
      );
      return result.ok ? jsonResult(result) : errorResult(result.error ?? "calibration refused");
    },
  };

  /**
   * `pipeline.plan` — stage order, lens coverage and the round budget, decided
   * by the server (roadmap/25 WI 7).
   *
   * Takes no `changeSetId` and reads no store: it is a pure function of the
   * stage roster, the domain-lens roster and the project's detected stack, so it
   * is registered here rather than threaded through `deps`. That purity is the
   * point — the answer cannot vary with who is asking.
   */
  const pipelinePlan: GatewayToolDefinition<typeof PIPELINE_PLAN_SHAPE> = {
    name: PIPELINE_PLAN_TOOL.name,
    description: PIPELINE_PLAN_TOOL.description,
    inputSchema: PIPELINE_PLAN_SHAPE,
    handler: async (args) => {
      /**
       * Read only when the caller named a change set. Absent is not empty: an
       * embedder that has not wired the store keeps the pre-R8 behaviour, while
       * an empty recorded set means nothing has closed, which is the fail-safe
       * direction R8 depends on.
       */
      const recordedStages =
        args.changeSetId === undefined
          ? undefined
          : completedStageIds(
              await loadStageCompletions(deps.reviewStageCompletionsPath),
              args.changeSetId,
            );
      return jsonResult(
        runPipelinePlan({
          ...(args.completedStages !== undefined ? { completedStages: args.completedStages } : {}),
          ...(recordedStages !== undefined ? { recordedStages } : {}),
          ...(args.stackEvidence !== undefined ? { stackEvidence: args.stackEvidence } : {}),
        }),
      );
    },
  };

  return [reviewSubmit, reviewCalibrate, pipelinePlan];
}

const PIPELINE_PLAN_SHAPE = {
  /**
   * The change set this plan is for — owner ruling R8.
   *
   * Optional so an embedder that has not wired the stage-completion store keeps
   * working. When supplied, the server READS what has actually closed for this
   * change set and plans from that, using `completedStages` below only to tell
   * the caller which of its claims the record does not support.
   */
  changeSetId: z.string().optional(),
  /**
   * What the CALLER believes has closed.
   *
   * No longer authoritative when `changeSetId` is supplied. Kept because a
   * caller's own view is worth reporting a disagreement about, and removing the
   * field would break every existing caller for no gain.
   */
  completedStages: z.array(z.string()).optional(),
  /**
   * `unknown`, deliberately: validated by `StackEvidenceSchema` inside the
   * handler, which degrades a malformed value to EMPTY rather than throwing.
   * Re-declaring the shape here would be a second schema for one document.
   */
  stackEvidence: z.unknown().optional(),
};

/** JSON-serialized tool output — every one of these tools answers with a single structured text block, matching 16's native families. */
function jsonResult(payload: unknown): { content: [{ type: "text"; text: string }] } {
  return { content: [{ type: "text", text: JSON.stringify(payload) }] };
}

function errorResult(message: string): {
  content: [{ type: "text"; text: string }];
  isError: true;
} {
  return { content: [{ type: "text", text: JSON.stringify({ error: message }) }], isError: true };
}

const PROJECT_INSPECT_SHAPE = { changeSetId: z.string().optional() };
const CONTRACT_APPROVE_SHAPE = {
  changeSetId: z.string(),
  digest: z.string(),
  token: z.string(),
};
/** Exported so `./review-submit-shape.test.ts` can compare its required set against the published descriptor's. */
export const REVIEW_SUBMIT_SHAPE = {
  stage: z.string(),
  changeSetId: z.string(),
  // `unknown`, deliberately: the verdict is validated by `ReviewVerdictSchema`
  // inside the handler, where a rejection carries the reason. Re-declaring its
  // shape here would be a second schema for one document, and the two would
  // disagree the first time either moved.
  verdict: z.unknown(),
  metCriteria: z.array(z.string()).optional(),
  /**
   * Attributed claims that this stage's JUDGED criteria are met — each naming who
   * asserts it, why, and where in the artifact to look.
   *
   * `unknown` for the same reason `verdict` is: `CriterionAttestationSchema`
   * validates them inside the handler, where a rejection carries the reason, and a
   * second shape declared here would disagree with it the first time either moved.
   */
  attestations: z.array(z.unknown()).optional(),
  /**
   * The design and plan artifacts as data, validated inside the handler by
   * `DesignRecordSchema` / `PlanRecordSchema`.
   *
   * `unknown` here for the same reason `verdict` is: one schema per document, and a
   * second shape declared at the wire boundary would disagree with it the first time
   * either moved.
   */
  /**
   * ⚠️ `.optional()` IS LOAD-BEARING, not decoration. Under zod 4 a bare
   * `z.unknown()` is NOT optional — `safeParse({})` fails with "expected
   * nonoptional" — so the MCP SDK derived these as REQUIRED while this tool's
   * own published descriptor (`../review/tool-definitions.ts`) listed only
   * `stage`/`changeSetId`/`verdict`. Every caller that obeyed the published
   * contract was refused, and the stages that legitimately have no design and no
   * plan — `research` first among them — could not record a verdict at all.
   *
   * Measured driving owner ruling R7's staged run; defect
   * `docs/evidence/criteria-closeout/defects/25-review-submit-requires-a-design-it-cannot-have.md`.
   * `./review-submit-shape.test.ts` now derives both required sets and compares
   * them, so the descriptor and this shape cannot drift apart again in silence.
   */
  design: z.unknown().optional(),
  plan: z.unknown().optional(),
  /**
   * The object id being merged, for `integrate-final-candidate-gate`.
   *
   * A FACT the server then checks, not a criterion the caller asserts: naming an
   * object id produces no passing gates for it, and the criterion still requires
   * every gate's latest verdict to be green at that exact id. Omitted, the
   * criterion simply does not derive and the integrate stage cannot close.
   */
  candidateObjectId: z.string().optional(),
};
const REVIEW_CALIBRATE_SHAPE = {
  /** Omit both to ask where the corpus stands and what to ask the owner next. */
  findingId: z.string().optional(),
  /**
   * The OWNER's call, and the only thing this tool takes. The classifier's own
   * call is read from the finding store — accepting it here would let a caller
   * record manufactured agreement and certify the classifier itself.
   */
  ownerClassification: z.enum(["blocking", "advisory"]).optional(),
};
const CAPABILITY_AUDIT_SHAPE = { candidate: z.unknown() };
const CAPABILITY_APPROVE_SHAPE = { digest: z.string(), token: z.string() };

/** 11's two tools, bound to the durable registries the `run` command writes. */
function buildIntakeTools(
  deps: ProductionGatewayToolRegistryDeps,
): readonly AnyGatewayToolDefinition[] {
  const projectInspectDeps: ProjectInspectDeps = {
    journal: deps.journal,
    changeSets: deps.changeSets,
  };

  const projectInspect: GatewayToolDefinition<typeof PROJECT_INSPECT_SHAPE> = {
    name: PROJECT_INSPECT_TOOL.name,
    description: PROJECT_INSPECT_TOOL.description,
    inputSchema: PROJECT_INSPECT_SHAPE,
    handler: async (args) =>
      jsonResult(
        await runProjectInspectTool(
          args.changeSetId !== undefined ? { changeSetId: args.changeSetId } : {},
          projectInspectDeps,
        ),
      ),
  };

  const contractApprove: GatewayToolDefinition<typeof CONTRACT_APPROVE_SHAPE> = {
    name: CONTRACT_APPROVE_TOOL.name,
    description: CONTRACT_APPROVE_TOOL.description,
    inputSchema: CONTRACT_APPROVE_SHAPE,
    handler: async (args) => {
      // The requirement set is resolved SERVER-SIDE from this ChangeSet's
      // own IntentContract — never taken from the caller — for the same
      // confused-deputy reason `runContractApprove` derives the expected
      // digest from the ChangeSet's own envelope.
      const changeSet = deps.changeSets.get(args.changeSetId);
      if (changeSet === undefined) {
        return errorResult(`unknown ChangeSet "${args.changeSetId}"`);
      }
      const contract = deps.intentContracts.get(changeSet.intentContractId);
      if (contract === undefined) {
        return errorResult(
          `ChangeSet "${args.changeSetId}" has no resolvable IntentContract — refusing to approve without its declared requirements`,
        );
      }

      return jsonResult(
        await runContractApprove(args, {
          secretKey: deps.approvalSigningKey,
          journal: deps.journal,
          changeSets: deps.changeSets,
          envelopes: deps.envelopes,
          workUnits: deps.workUnits.list(),
          requirementIds: contract.requirementIds,
          requirements: resolveRequirements(deps.requirements, contract.requirementIds),
          // R8. The gateway can approve an ENVELOPE; it still cannot approve a
          // design — no tool writes an OwnerDesignVerdict, so this read can only
          // reflect what the owner typed on their own terminal.
          stageCompletions: await loadStageCompletions(deps.reviewStageCompletionsPath),
        }),
      );
    },
  };

  return [projectInspect, contractApprove];
}

/** 12's two tools, bound to the pinned capability store. */
function buildCapabilityTools(
  deps: ProductionGatewayToolRegistryDeps,
): readonly AnyGatewayToolDefinition[] {
  const capabilityAudit: GatewayToolDefinition<typeof CAPABILITY_AUDIT_SHAPE> = {
    name: CAPABILITY_AUDIT_TOOL.name,
    description: CAPABILITY_AUDIT_TOOL.description,
    inputSchema: CAPABILITY_AUDIT_SHAPE,
    handler: async (args) =>
      jsonResult(await runCapabilityAudit({ candidate: args.candidate }, deps.capability)),
  };

  const capabilityApprove: GatewayToolDefinition<typeof CAPABILITY_APPROVE_SHAPE> = {
    name: CAPABILITY_APPROVE_TOOL.name,
    description: CAPABILITY_APPROVE_TOOL.description,
    inputSchema: CAPABILITY_APPROVE_SHAPE,
    handler: async (args) => {
      const storeKey = deps.resolveCapabilityStoreKey(args.digest);
      if (storeKey === undefined) {
        return errorResult(`no audited capability is stored under digest "${args.digest}"`);
      }
      return jsonResult(
        await runCapabilityApprove(args, {
          minter: deps.approvalTokenVerifier,
          store: deps.capability.store,
          storeKey,
        }),
      );
    },
  };

  return [capabilityAudit, capabilityApprove];
}

/**
 * Assembles every tool the shipped `gateway mcp` server exposes: 16's 18
 * native leaves across five families, plus 11's two and 12's two.
 */
export function buildProductionGatewayToolRegistry(
  deps: ProductionGatewayToolRegistryDeps,
): GatewayToolRegistry {
  const registry = buildNativeToolRegistry({
    connections: deps.connections,
    providers: deps.providers,
    mutationApplyClients: deps.mutationApplyClients,
    journal: deps.journal,
    supervisorSocketPath: deps.supervisorSocketPath,
    ...(deps.activateConnection !== undefined
      ? { activateConnection: deps.activateConnection }
      : {}),
  });

  // `report.render` (design §L1). Registered unconditionally and without deps:
  // it is a pure function of its arguments — no I/O, no state, no authority —
  // so unlike every other family here it is gated on nothing.
  const reportRender: GatewayToolDefinition<typeof REPORT_RENDER_SHAPE> = {
    name: REPORT_RENDER_TOOL.name,
    description: REPORT_RENDER_TOOL.description,
    inputSchema: REPORT_RENDER_SHAPE,
    // Async to satisfy the handler seam; this one has nothing to await, because
    // it is a pure function of its arguments.
    handler: async (args) => {
      const result = runReportRenderTool(args as ReportRenderArgs);
      // The markdown goes back as TEXT, not JSON-wrapped: the caller's job is to
      // emit it verbatim, and a JSON envelope would make it re-serialise the
      // very thing this rendered for it.
      return "markdown" in result
        ? { content: [{ type: "text" as const, text: result.markdown }] }
        : errorResult(result.error);
    },
  };
  registry.register(reportRender);

  for (const tool of buildIntakeTools(deps)) registry.register(tool);
  for (const tool of buildCapabilityTools(deps)) registry.register(tool);
  for (const tool of buildReviewTools(deps)) registry.register(tool);

  return registry;
}
