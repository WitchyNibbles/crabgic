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
import type {
  AuthorizationEnvelope,
  ChangeSet,
  IntentContract,
  Requirement,
  WorkUnit,
} from "@crabgic/contracts";
import { CONTRACT_APPROVE_TOOL, PROJECT_INSPECT_TOOL } from "../intake/tool-definitions.js";
import { REVIEW_CALIBRATE_TOOL, REVIEW_SUBMIT_TOOL } from "../review/tool-definitions.js";
import { runReviewCalibrate } from "../review/calibrate-handler.js";
import { runReviewSubmit } from "../review/review-submit-handler.js";
import { loadFindings, saveFindings } from "../review/finding-store.js";
import { loadAttestations, saveAttestationsForStage } from "../review/attestation-store.js";
import { loadArtifacts, saveArtifacts } from "../review/artifact-store.js";
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

  return [reviewSubmit, reviewCalibrate];
}

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
const REVIEW_SUBMIT_SHAPE = {
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
  design: z.unknown(),
  plan: z.unknown(),
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
  });

  for (const tool of buildIntakeTools(deps)) registry.register(tool);
  for (const tool of buildCapabilityTools(deps)) registry.register(tool);
  for (const tool of buildReviewTools(deps)) registry.register(tool);

  return registry;
}
