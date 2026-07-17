import { z } from "zod";
import { CURRENT_SCHEMA_VERSION, SchemaVersionField } from "../shared/schema-version.js";
import { NonEmptyStringSchema } from "../shared/ids.js";

/**
 * `CommunicationPolicy` (roadmap/02 In-scope "CommunicationPolicy
 * constants" bullet; one of the 21 contracts in "Contracts (zod + JSON
 * Schema export, 21)"). Every length/section limit every rendered
 * artifact must satisfy, plus the closed set of content categories phase
 * 17's `lint()` pipeline rejects outright. Consumed by 08 (branch/commit
 * constants + evidence-attachment templates), 17 (all constants, template
 * enforcement), 18/19/20 (Jira/Grafana limits) — interface-ledger's
 * "CommunicationPolicy constants" row, "`CommunicationPolicy` | 08, 17,
 * 18, 19, 20" row.
 *
 * interface-ledger.md Gap 6 ruling (consulted, never edited by this
 * file): review comment gained a `≤6 lines (one finding, evidence,
 * action)` limit and PR title gained a `≤72 chars` /
 * `type(scope): outcome` limit (same convention as the commit subject,
 * per roadmap/08 and roadmap/17's own Templates section); the previously
 * proposed `dashboard version message ≤160` constant was **dropped
 * entirely** — Grafana's "dashboard version" is only ever a REST
 * precondition/ETag token, never rendered communication text. There is
 * deliberately NO dashboard-version constant anywhere in this file
 * (roadmap/02 exit criterion: "CommunicationPolicy golden snapshot ...
 * contains no dashboard-version-message entry" — asserted in this
 * contract's own test file).
 */

/**
 * The closed set of content categories phase 17's attribution-neutral-
 * language `lint()` stage rejects outright (roadmap/02 In-scope bullet:
 * "prohibited-content categories (attribution, first-person, signatures,
 * mentions, secrets, unsafe links)"). Member spelling is deliberate and
 * must be cited byte-identically by every consumer (08's belt-and-
 * suspenders assertion; 17's lint stage; 18/19/20's provider-payload
 * templates):
 *
 * - `attribution` — "Generated with…", engine-name credit lines, any text
 *   crediting an AI tool/model/engine for authorship (`renderer-core`'s
 *   `attribution-scanner.ts` detects the concrete token set).
 * - `first_person` — "I"/"we"/"our" self-referential authorial voice.
 * - `signatures` — sign-off lines/closings (e.g. "— Claude", "Regards,").
 * - `mentions` — @-mention/notification-triggering tokens outside the
 *   mention/notification policy's own allowlist.
 * - `secrets` — credential/token/private-key/connection-string material
 *   (17's secret/URL-policy stage owns the actual pattern set — AWS-style
 *   keys, PEM headers, DB connection strings, bearer/PAT-shaped tokens).
 * - `unsafe_links` — non-allowlisted URL schemes, raw HTML, embedded
 *   remote images (17's URL-policy stage owns the actual scheme
 *   allowlist).
 *
 * Snake-case members follow this codebase's existing closed-union
 * convention for cross-cutting enums (`JournalEntryType`'s
 * `run_transition`/`work_unit_transition`/etc.,
 * `WorkUnitAttemptStatus`'s `parked:rate_limit`) rather than the roadmap
 * prose's hyphenated English ("first-person", "unsafe links") — the prose
 * is descriptive, not a literal token spelling; `first_person` and
 * `unsafe_links` are this file's own deliberate rendering of that prose
 * into code-safe, grep-able identifiers.
 */
export const PROHIBITED_CONTENT_CATEGORIES = [
  "attribution",
  "first_person",
  "signatures",
  "mentions",
  "secrets",
  "unsafe_links",
] as const;

export const ProhibitedContentCategorySchema = z.enum(PROHIBITED_CONTENT_CATEGORIES);
export type ProhibitedContentCategory = z.infer<typeof ProhibitedContentCategorySchema>;

/**
 * Canonical, deeply-readonly limit constants (roadmap/02 In-scope bullet,
 * verbatim numbers): branch name, commit subject/body, PR title/body,
 * Jira summary/comment, Grafana annotation, review comment. `as const`
 * makes every nested object/array readonly at the type level — there is
 * no separate mutable working copy anywhere in this module, satisfying
 * this phase's immutability convention.
 *
 * `prTitle` shares the `commitSubject` shape (`maxChars` + `format`) —
 * roadmap/17 §Templates: "PR title (≤72 chars, `type(scope): outcome` —
 * same convention as the commit subject, 08)".
 *
 * `prBody.sections` are the literal section headings phase 17's PR-body
 * template renders (Outcome/Validation/Risk/Tracking); `jiraComment
 * .milestoneTemplate` are the literal section headings phase 17's Jira
 * milestone-comment template renders (roadmap/17 §Templates:
 * "Jira milestone comment (Outcome/Evidence/Risk/Next/Ref)").
 * `reviewComment.shape` is deliberately a different field name from
 * `sections`/`milestoneTemplate`: it names the review comment's three
 * structural components ("one finding, evidence, action" — interface-
 * ledger Gap 6) rather than literal rendered headings, since 17's review-
 * comment template is not specified as heading-per-line the way the PR
 * body and Jira comment are.
 */
export const COMMUNICATION_POLICY_LIMITS = {
  branchName: {
    maxChars: 64,
  },
  commitSubject: {
    maxChars: 72,
    format: "type(scope): outcome",
  },
  commitBody: {
    maxLines: 5,
  },
  prTitle: {
    maxChars: 72,
    format: "type(scope): outcome",
  },
  prBody: {
    maxLines: 12,
    sections: ["Outcome", "Validation", "Risk", "Tracking"],
  },
  jiraSummary: {
    maxChars: 120,
  },
  jiraComment: {
    maxChars: 800,
    maxLines: 6,
    milestoneTemplate: ["Outcome", "Evidence", "Risk", "Next", "Ref"],
  },
  grafanaAnnotation: {
    maxChars: 240,
  },
  reviewComment: {
    maxLines: 6,
    shape: ["finding", "evidence", "action"],
  },
} as const;

const CharLimitSchema = z
  .object({
    maxChars: z.number().int().positive(),
  })
  .strict();

const FormattedLengthLimitSchema = z
  .object({
    maxChars: z.number().int().positive(),
    format: NonEmptyStringSchema,
  })
  .strict();

const LineCountLimitSchema = z
  .object({
    maxLines: z.number().int().positive(),
  })
  .strict();

const SectionedLineLimitSchema = z
  .object({
    maxLines: z.number().int().positive(),
    sections: z.array(NonEmptyStringSchema).length(4),
  })
  .strict();

const JiraCommentLimitSchema = z
  .object({
    maxChars: z.number().int().positive(),
    maxLines: z.number().int().positive(),
    milestoneTemplate: z.array(NonEmptyStringSchema).min(1),
  })
  .strict();

const ReviewCommentLimitSchema = z
  .object({
    maxLines: z.number().int().positive(),
    shape: z.array(NonEmptyStringSchema).length(3),
  })
  .strict();

const CommunicationPolicyLimitsSchema = z
  .object({
    branchName: CharLimitSchema,
    commitSubject: FormattedLengthLimitSchema,
    commitBody: LineCountLimitSchema,
    prTitle: FormattedLengthLimitSchema,
    prBody: SectionedLineLimitSchema,
    jiraSummary: CharLimitSchema,
    jiraComment: JiraCommentLimitSchema,
    grafanaAnnotation: CharLimitSchema,
    reviewComment: ReviewCommentLimitSchema,
  })
  .strict();

/**
 * `CommunicationPolicy` models a *policy instance* — the limits above plus
 * the prohibited-category set that instance enforces — not just a bag of
 * constants. `DEFAULT_COMMUNICATION_POLICY` below is the canonical
 * instance every consumer reads; the schema still models the general case
 * (rather than hardcoding the canonical values as literals) so a future
 * policy variant is a data change, not a shape change. `schemaVersion` is
 * this contract's first field, per this phase's own Risks note ("carried
 * on every contract from day one").
 */
export const CommunicationPolicySchema = z
  .object({
    schemaVersion: SchemaVersionField,
    limits: CommunicationPolicyLimitsSchema,
    prohibitedContentCategories: z.array(ProhibitedContentCategorySchema).min(1),
  })
  .strict();

export type CommunicationPolicy = z.infer<typeof CommunicationPolicySchema>;

/**
 * The canonical policy instance. Constructed from
 * `COMMUNICATION_POLICY_LIMITS` and the full `PROHIBITED_CONTENT_CATEGORIES`
 * set (every category is prohibited under the canonical policy — there is
 * no opt-out instance in play today), then round-tripped through
 * `CommunicationPolicySchema.parse` — not merely type-asserted — so a
 * future drift between the constants above and the schema shape fails at
 * module-load time, not just at `tsc -b`.
 */
export const DEFAULT_COMMUNICATION_POLICY: CommunicationPolicy = CommunicationPolicySchema.parse({
  schemaVersion: CURRENT_SCHEMA_VERSION,
  limits: COMMUNICATION_POLICY_LIMITS,
  prohibitedContentCategories: [...PROHIBITED_CONTENT_CATEGORIES],
});
