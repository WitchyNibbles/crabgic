import { z } from "zod";
import { SchemaVersionField } from "../shared/schema-version.js";
import { IdSchema, NonEmptyStringSchema, TimestampSchema } from "../shared/ids.js";

/**
 * The 9 named `IntentContract` sections, cited verbatim by
 * roadmap/11-intake-contract-approval.md §In scope, "Contract assembly"
 * bullet: "scope/non-goals/audience/compatibility/security/performance/
 * observability/rollout/acceptance" — and reconfirmed by
 * roadmap/14-quality-security-gates.md §In scope, "Gate framework &
 * registry" bullet, which keys its risk-tag vocabulary off this exact list.
 * `"non-goals"` keeps the roadmap's own hyphenated spelling (rather than a
 * `nonGoals` camelCase rewrite) so the token stays byte-identical to both
 * citing phase files.
 */
export const INTENT_CONTRACT_SECTION_KEYS = [
  "scope",
  "non-goals",
  "audience",
  "compatibility",
  "security",
  "performance",
  "observability",
  "rollout",
  "acceptance",
] as const;

export const IntentContractSectionKeySchema = z.enum(INTENT_CONTRACT_SECTION_KEYS);
export type IntentContractSectionKey = z.infer<typeof IntentContractSectionKeySchema>;

/**
 * The 9 sections' narrative content. Each is required and non-empty because
 * roadmap/11's own Goal states the assembly output must be
 * "decision-complete" (roadmap/11 §Goal, first sentence) — an
 * `IntentContract` with a blank section is not decision-complete. Minimal
 * shape chosen for each section's value: roadmap/11 never pins a structured
 * shape beyond "named sections" of narrative text, so free-form non-empty
 * strings are the smallest sufficient representation.
 */
export const IntentContractSectionsSchema = z
  .object({
    scope: NonEmptyStringSchema,
    "non-goals": NonEmptyStringSchema,
    audience: NonEmptyStringSchema,
    compatibility: NonEmptyStringSchema,
    security: NonEmptyStringSchema,
    performance: NonEmptyStringSchema,
    observability: NonEmptyStringSchema,
    rollout: NonEmptyStringSchema,
    acceptance: NonEmptyStringSchema,
  })
  .strict();
export type IntentContractSections = z.infer<typeof IntentContractSectionsSchema>;

/**
 * `IntentContract` (roadmap/02-contracts-and-schemas.md §Interfaces
 * produced, row "IntentContract | 11 (assembles instance), 18, 21"):
 * assembled by 11 for a `ChangeSet` (`changeSetId` — cross-contract
 * reference per this phase's hard convention, never an embedded object);
 * `requirementIds` carries the "stable requirement IDs" roadmap/11 §In
 * scope's "Contract assembly" bullet says this phase's assembly step
 * produces, forward-linking to standalone `Requirement` (./requirement.ts)
 * records — an empty array is valid for a contract still being drafted,
 * before IDs are assigned (roadmap/11 §In scope: "11 (assigns IDs)").
 * Consumed by 18 (Jira requirement sync, "intake's authoritative source",
 * roadmap/18-jira-cloud-adapter.md:87) and 21.
 */
export const IntentContractSchema = z
  .object({
    schemaVersion: SchemaVersionField,
    id: IdSchema,
    changeSetId: IdSchema,
    createdAt: TimestampSchema,
    sections: IntentContractSectionsSchema,
    requirementIds: z.array(IdSchema),
  })
  .strict();
export type IntentContract = z.infer<typeof IntentContractSchema>;
