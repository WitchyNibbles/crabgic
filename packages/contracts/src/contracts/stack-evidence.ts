import { z } from "zod";
import { SchemaVersionField } from "../shared/schema-version.js";
import { IdSchema, NonEmptyStringSchema, TimestampSchema } from "../shared/ids.js";

/**
 * The 10 detection categories named verbatim by
 * roadmap/12-stack-detection-quarantine.md §In scope, "Detection" bullet:
 * "manifests, lockfiles, language/runtime versions, source composition, CI,
 * containers, infrastructure, migrations, deployment config, observability
 * integrations → `StackEvidence` (02)".
 */
export const STACK_EVIDENCE_CATEGORIES = [
  "manifest",
  "lockfile",
  "language_runtime",
  "source_composition",
  "ci",
  "container",
  "infrastructure",
  "migration",
  "deployment_config",
  "observability_integration",
] as const;

export const StackEvidenceCategorySchema = z.enum(STACK_EVIDENCE_CATEGORIES);
export type StackEvidenceCategory = z.infer<typeof StackEvidenceCategorySchema>;

/**
 * A normalized confidence score. Minimal shape chosen: roadmap/12 says
 * detection carries "confidence" (§In scope, "Detection" bullet) but never
 * pins a scale; 0..1 is the smallest sufficient representation.
 */
export const ConfidenceSchema = z.number().min(0).max(1);

/**
 * A single detected fact. `ecosystem` is free-form (matching
 * `ProjectProfile.EcosystemProfileSchema`'s own choice, ../contracts/
 * project-profile.ts) since roadmap/12's fixture matrix ("node/ts monorepo,
 * python, go, rust, mixed, containerized") never pins a closed taxonomy.
 * `path` anchors the finding to the file/directory that produced it —
 * matching 14's later use of `StackEvidence` to decide "no JS-specific SAST
 * ruleset fires without Node evidence; IaC adapters fire only when
 * Terraform/CloudFormation files are detected" (roadmap/14-quality-
 * security-gates.md §In scope, "Test execution" bullet), which requires
 * knowing *where* evidence for a given ecosystem/category was found.
 */
export const StackEvidenceFindingSchema = z
  .object({
    category: StackEvidenceCategorySchema,
    ecosystem: NonEmptyStringSchema,
    detail: NonEmptyStringSchema,
    path: NonEmptyStringSchema,
    confidence: ConfidenceSchema,
  })
  .strict();
export type StackEvidenceFinding = z.infer<typeof StackEvidenceFindingSchema>;

/**
 * A detected contradiction between two or more findings — roadmap/12's own
 * worked example: "conflicting `engines.node` across a monorepo's packages"
 * (§Test plan, "Unit" bullet).
 */
export const StackEvidenceContradictionSchema = z
  .object({
    description: NonEmptyStringSchema,
    conflictingPaths: z.array(NonEmptyStringSchema).min(2),
  })
  .strict();
export type StackEvidenceContradiction = z.infer<typeof StackEvidenceContradictionSchema>;

/**
 * `StackEvidence` (roadmap/02-contracts-and-schemas.md §Interfaces
 * produced, row "StackEvidence | 12 (populates), 11, 14, 15"): the
 * evidence-based stack profile roadmap/12-stack-detection-quarantine.md
 * populates via "Pure file analysis; never executes repo content" (§In
 * scope, "Detection" bullet), consumed by 11's `project.inspect` (graceful
 * degradation before 12), and by 14/15 to decide which gate/risk categories
 * apply at all (see `StackEvidenceCategorySchema`'s doc comment).
 * `unresolvedAmbiguity` is free-text (roadmap/12's own vocabulary,
 * §Goal: "confidence, contradictions, unresolved ambiguity") since no
 * structured shape for an open question is pinned upstream.
 */
export const StackEvidenceSchema = z
  .object({
    schemaVersion: SchemaVersionField,
    id: IdSchema,
    createdAt: TimestampSchema,
    findings: z.array(StackEvidenceFindingSchema),
    contradictions: z.array(StackEvidenceContradictionSchema),
    unresolvedAmbiguity: z.array(NonEmptyStringSchema),
  })
  .strict();
export type StackEvidence = z.infer<typeof StackEvidenceSchema>;
