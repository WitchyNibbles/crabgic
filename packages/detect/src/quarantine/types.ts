/**
 * Quarantine-pipeline shared types — roadmap/12 §In scope, "Quarantine
 * pipeline" bullet's 6 stages: "(1) fetch without credentials → (2) pin
 * immutable digest → (3) verify signature/provenance where available →
 * (4) SBOM + scan deps/licenses/secrets/scripts/hooks/prompts/permissions
 * → (5) test without credentials or egress, inside a sandbox jail → (6)
 * manifest entry for approval." `CapabilityKind` is the 5 digest-pinned
 * entry kinds `CapabilityManifestEntrySchema` (02) actually accepts for a
 * quarantine-produced entry (its `engine`/`model` kinds are populated
 * elsewhere, never by this pipeline).
 */
import { z } from "zod";
import type { CapabilityDecision } from "@eo/contracts";
import { DeclaredOperationSchema, type SandboxTestResult } from "./sandbox/types.js";

export const CAPABILITY_KINDS = ["skill", "plugin", "hook", "mcp_server", "external_tool"] as const;
export const CapabilityKindSchema = z.enum(CAPABILITY_KINDS);
export type CapabilityKind = z.infer<typeof CapabilityKindSchema>;

/** One file inside a candidate capability bundle. Text-only (UTF-8) — sufficient for skill bodies, plugin/hook manifests, MCP server descriptors, and script source; this pipeline never handles opaque binary blobs. */
export const CandidateFileSchema = z
  .object({
    path: z.string().trim().min(1),
    content: z.string(),
    /** POSIX file mode if known (e.g. `0o755` for an executable script) — consumed by `./scanners/script-scanner.ts`. */
    executable: z.boolean().optional(),
  })
  .strict();
export type CandidateFile = z.infer<typeof CandidateFileSchema>;

/** Provenance metadata — stage 3's own input. Per roadmap/12 §Risks: "SLSA/CycloneDX stored as evidence, not proof of benignity" — `signature`/`sbomRef` are opaque strings this pipeline records, never independently re-derives trust from. */
export const CandidateProvenanceSchema = z
  .object({
    sourceRef: z.string().trim().min(1).optional(),
    signature: z.string().trim().min(1).optional(),
    sbomRef: z.string().trim().min(1).optional(),
  })
  .strict();
export type CandidateProvenance = z.infer<typeof CandidateProvenanceSchema>;

/**
 * A raw candidate-capability descriptor as it enters the pipeline at stage
 * 1 (fetch). Deliberately NEVER carries a `credentials`/`token`/`apiKey`/
 * `authorization` field — `./stages/fetch.ts`'s own validation rejects one
 * that does (roadmap/12's "fetch without credentials" requirement,
 * enforced structurally at this boundary since this phase has no real
 * network transport of its own to withhold credentials from in the first
 * place).
 */
export const CandidateSourceSchema = z
  .object({
    kind: CapabilityKindSchema,
    name: z.string().trim().min(1),
    files: z.array(CandidateFileSchema).min(1),
    /** Declared tool/path permission patterns this capability wants (e.g. `"Bash(*)"`, `"Read(~/.ssh/**)"`) — `./scanners/permission-scanner.ts`'s input. */
    permissionFootprint: z.array(z.string()),
    provenance: CandidateProvenanceSchema.optional(),
    /** Operations the candidate's own self-test declares it will attempt — stage 5 (`./stages/sandbox-stage.ts`)'s input. `undefined`/absent is treated as "declares nothing" (an empty plan), never a validation failure. */
    selfTestPlan: z.array(DeclaredOperationSchema).optional(),
  })
  .strict();
export type CandidateSource = z.infer<typeof CandidateSourceSchema>;

/** `CandidateSource` plus the digest pinned at stage 2. */
export interface PinnedCandidate extends CandidateSource {
  readonly digest: string;
}

export const PIPELINE_STAGES = [
  "fetch",
  "pin",
  "verify_provenance",
  "scan",
  "sandbox_test",
  "manifest_entry",
] as const;
export type PipelineStage = (typeof PIPELINE_STAGES)[number];

export interface StageResult {
  readonly stage: PipelineStage;
  readonly passed: boolean;
  readonly detail: string;
}

export const SCAN_SEVERITIES = ["info", "low", "medium", "high", "critical"] as const;
export type ScanSeverity = (typeof SCAN_SEVERITIES)[number];

export interface ScanFinding {
  readonly scanner: string;
  readonly severity: ScanSeverity;
  readonly detail: string;
  readonly path?: string;
}

/**
 * The full audit trail for one candidate — roadmap/12 §In scope, "Pipeline
 * stages" bullet: "audit-report artifact." `stages` is always a PREFIX of
 * `PIPELINE_STAGES` in order (never a skip) — enforced by `./pipeline.ts`,
 * proven by `./pipeline.property.test.ts`.
 */
export interface AuditReport {
  readonly candidateName: string;
  readonly kind: CapabilityKind;
  readonly digest: string;
  readonly permissionFootprint: readonly string[];
  readonly stages: readonly StageResult[];
  readonly scanFindings: readonly ScanFinding[];
  readonly sandboxResult?: SandboxTestResult;
  /** `CapabilityDecision` (02) — reused verbatim, not redefined, so this pipeline's own decision states can never drift from 02's schema. */
  readonly decision: CapabilityDecision;
  readonly auditedAt: string;
}

/** `true` iff every stage in `report.stages` passed and stage 6 (`manifest_entry`) was reached. */
export function auditReachedManifestEntry(report: AuditReport): boolean {
  const last = report.stages.at(-1);
  return last !== undefined && last.stage === "manifest_entry" && last.passed;
}
