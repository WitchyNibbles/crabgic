import { z } from "zod";
import { SchemaVersionField } from "../shared/schema-version.js";
import { IdSchema, NonEmptyStringSchema, TimestampSchema } from "../shared/ids.js";

/**
 * `ResearchRecord` — the research stage's artifact, as data.
 * roadmap/25 work item 2; `docs/staged-review-pipeline.md` §8.7.
 *
 * WHY THIS EXISTS. §8.7 gave the design and plan stages a shape and five of
 * their criteria stopped being judgements. It then named the research stage as
 * "the same shape of problem" and left it: `research-questions-answered` and
 * `research-no-silent-assumptions` are coverage-of-a-list and
 * citation-on-each-answer, which are list walks, and they spent this whole time
 * filed as things a reviewer forms an opinion about.
 *
 * THE THREE STATES, copied from `DesignRecord` deliberately. A record can prove
 * a criterion, contradict it, or be silent on it. Flattening the last two is
 * what makes an absent artifact read as a compliant one — `[].every(...)` is
 * `true`, so an empty question list would satisfy "every question has a cited
 * answer" vacuously. Silence is left to an attestation; contradiction voids one.
 *
 * WHAT THIS DOES NOT DECIDE, stated so nobody infers otherwise: it decides
 * CLAIMED coverage. A `citations` entry can point at a page that does not say
 * what the answer says, and every check below still passes. Structure removes
 * the OMISSION failure — an answer nobody sourced, an assumption nobody wrote
 * down. The quality half stays with the `source-quality` lens, where it belongs.
 *
 * `research-prior-art-checked` is deliberately NOT derivable here. Whether a
 * search was diligent is not a property of the record it produced, and a record
 * that could assert its own diligence would be the design supplying its own list
 * of what it must satisfy, which §8.7 already refused for a different criterion.
 */

/**
 * Where an answer came from.
 *
 * `repository` is the kind that existed before ruling R1 — prior art in this
 * checkout, cited by path. `web` is what R1 (2026-08-15) granted the
 * manager-side research agent, and it carries an extra obligation: `retrievedAt`
 * is REQUIRED, because fetched content is untrusted input that also changes
 * under you. A design argued from a page must remain traceable to the version of
 * that page it was argued from, and a URL with no date does not survive the page
 * being edited.
 *
 * The union is discriminated rather than a single shape with an optional date,
 * so "web citation with no retrieval date" is unrepresentable instead of
 * discouraged (Gap 20 doctrine).
 */
export const RepositoryCitationSchema = z
  .object({
    kind: z.literal("repository"),
    locator: NonEmptyStringSchema,
  })
  .strict();

export const WebCitationSchema = z
  .object({
    kind: z.literal("web"),
    locator: NonEmptyStringSchema,
    retrievedAt: TimestampSchema,
  })
  .strict();

export const ResearchCitationSchema = z.union([RepositoryCitationSchema, WebCitationSchema]);
export type ResearchCitation = z.infer<typeof ResearchCitationSchema>;

/**
 * One question the contract's sections depend on.
 *
 * `answer` is OPTIONAL and that is deliberate: an open question is what research
 * looks like halfway through, and a schema that refused it would mean the stage
 * had nothing to converge on. The criterion goes unmet; the document is not
 * rejected. Same reasoning `DesignRecord` gives for an unanswered risk.
 */
export const ResearchQuestionSchema = z
  .object({
    id: NonEmptyStringSchema,
    question: NonEmptyStringSchema,
    answer: NonEmptyStringSchema.optional(),
    citations: z.array(ResearchCitationSchema).default([]),
  })
  .strict();
export type ResearchQuestion = z.infer<typeof ResearchQuestionSchema>;

/**
 * Something taken as true without a citation, written down as such.
 *
 * `coversQuestion` points at the question whose answer rests on it, which is
 * what turns "we listed some assumptions" into "this specific uncited answer is
 * accounted for". An assumption list that floats free of the answers it supports
 * cannot discharge the criterion, because nothing connects the two.
 */
export const ResearchAssumptionSchema = z
  .object({
    id: NonEmptyStringSchema,
    statement: NonEmptyStringSchema,
    coversQuestion: NonEmptyStringSchema,
  })
  .strict();
export type ResearchAssumption = z.infer<typeof ResearchAssumptionSchema>;

export const ResearchRecordSchema = z
  .object({
    schemaVersion: SchemaVersionField,
    id: IdSchema,
    questions: z.array(ResearchQuestionSchema).default([]),
    assumptions: z.array(ResearchAssumptionSchema).default([]),
  })
  .strict();
export type ResearchRecord = z.infer<typeof ResearchRecordSchema>;

/** `research-questions-answered` — every question has an answer, and each answer a citation. */
export const RESEARCH_QUESTIONS_CRITERION = "research-questions-answered";
/** `research-no-silent-assumptions` — every uncited answer is declared as an assumption. */
export const RESEARCH_ASSUMPTIONS_CRITERION = "research-no-silent-assumptions";

const isAnswered = (question: ResearchQuestion): boolean =>
  (question.answer ?? "").trim().length > 0;

const isCited = (question: ResearchQuestion): boolean => question.citations.length > 0;

/**
 * An uncited answer is "silent" unless some assumption names its question.
 *
 * An UNANSWERED question is not silent — nothing has been taken as true yet.
 * Treating an open question as an undeclared assumption would make the two
 * criteria collapse into one, and a stage would then be unable to report which
 * of the two problems it actually has.
 */
function isSilentlyAssumed(question: ResearchQuestion, record: ResearchRecord): boolean {
  if (!isAnswered(question) || isCited(question)) return false;
  return !record.assumptions.some((assumption) => assumption.coversQuestion === question.id);
}

/**
 * The research criteria the RECORD decides.
 *
 * Both guards require a non-empty list before deriving anything. That is the
 * vacuity rule this repository has now paid for at three separate criteria: an
 * empty list satisfies a universal quantifier, so an absent artifact would close
 * the stage it was supposed to describe.
 */
export function deriveResearchCriteria(record: ResearchRecord): readonly string[] {
  const derived: string[] = [];
  if (record.questions.length > 0 && record.questions.every((q) => isAnswered(q) && isCited(q))) {
    derived.push(RESEARCH_QUESTIONS_CRITERION);
  }
  if (
    record.questions.length > 0 &&
    !record.questions.some((question) => isSilentlyAssumed(question, record))
  ) {
    derived.push(RESEARCH_ASSUMPTIONS_CRITERION);
  }
  return derived;
}

/**
 * Criteria the record actively CONTRADICTS.
 *
 * An uncited answer that no assumption covers is not silence — it is the record
 * stating a thing it cannot source and not owning up to it. An attestation
 * claiming `research-no-silent-assumptions` over that is void, because a claim
 * cannot outvote the artifact it describes.
 *
 * `RESEARCH_QUESTIONS_CRITERION` is deliberately never contradicted: an
 * unanswered question is an honest mid-research state, not a false claim.
 */
export function researchContradictions(record: ResearchRecord): readonly string[] {
  const contradicted: string[] = [];
  if (record.questions.some((question) => isSilentlyAssumed(question, record))) {
    contradicted.push(RESEARCH_ASSUMPTIONS_CRITERION);
  }
  return contradicted;
}
