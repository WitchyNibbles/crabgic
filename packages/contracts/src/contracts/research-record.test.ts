import { describe, expect, it } from "vitest";
import {
  RESEARCH_ASSUMPTIONS_CRITERION,
  RESEARCH_QUESTIONS_CRITERION,
  ResearchRecordSchema,
  deriveResearchCriteria,
  researchContradictions,
  type ResearchRecord,
} from "./research-record.js";

/**
 * The research stage's artifact — `docs/staged-review-pipeline.md` §8.7 named
 * its absence ("the research stage is not done"), and roadmap/25 work item 2
 * builds it.
 *
 * The pattern is `DesignRecord`'s and is copied deliberately: derive what the
 * artifact proves, report what it contradicts, and leave silence to an
 * attestation. Getting the third state wrong is what makes an absent artifact
 * read as a compliant one.
 */

const record = (overrides: Partial<ResearchRecord> = {}): ResearchRecord =>
  ResearchRecordSchema.parse({
    schemaVersion: 1,
    id: "11111111-2222-4333-8444-555555555555",
    questions: [
      {
        id: "q1",
        question: "Which HTTP client does the repository already depend on?",
        answer: "undici, via the gateway transport.",
        citations: [
          { kind: "repository", locator: "packages/gateway/src/transport/http-client.ts" },
        ],
      },
    ],
    assumptions: [],
    ...overrides,
  });

describe("ResearchRecordSchema", () => {
  it("parses a record whose every question carries a cited answer", () => {
    expect(() => record()).not.toThrow();
  });

  it("refuses a citation with no locator", () => {
    // A citation that does not say WHERE is the thing the source-quality lens
    // exists to catch, arriving pre-broken.
    expect(
      ResearchRecordSchema.safeParse({
        schemaVersion: 1,
        id: "11111111-2222-4333-8444-555555555555",
        questions: [
          {
            id: "q1",
            question: "Which HTTP client does the repository already depend on?",
            answer: "undici.",
            citations: [{ kind: "repository", locator: "" }],
          },
        ],
        assumptions: [],
      }).success,
    ).toBe(false);
  });

  it("requires a web citation to record where it came from and when", () => {
    // Ruling R1 (2026-08-15) granted the research agent WebSearch/WebFetch and
    // obliged source provenance: a design argued from a fetched page must be
    // traceable to that page afterwards, because the content is untrusted input.
    const missingRetrieval = ResearchRecordSchema.safeParse({
      schemaVersion: 1,
      id: "11111111-2222-4333-8444-555555555555",
      questions: [
        {
          id: "q1",
          question: "What is the current guidance for this API?",
          answer: "Use the streaming form.",
          citations: [{ kind: "web", locator: "https://example.invalid/doc" }],
        },
      ],
      assumptions: [],
    });
    expect(missingRetrieval.success).toBe(false);
  });

  it("accepts the same web citation once its retrieval date is supplied", () => {
    // Positive control for the row above.
    const withRetrieval = ResearchRecordSchema.safeParse({
      schemaVersion: 1,
      id: "11111111-2222-4333-8444-555555555555",
      questions: [
        {
          id: "q1",
          question: "What is the current guidance for this API?",
          answer: "Use the streaming form.",
          citations: [
            {
              kind: "web",
              locator: "https://example.invalid/doc",
              retrievedAt: "2026-08-15T00:00:00.000Z",
            },
          ],
        },
      ],
      assumptions: [],
    });
    expect(withRetrieval.success).toBe(true);
  });
});

describe("deriveResearchCriteria", () => {
  it("derives research-questions-answered when every question has a cited answer", () => {
    expect(deriveResearchCriteria(record())).toContain(RESEARCH_QUESTIONS_CRITERION);
  });

  it("does NOT derive it from an empty question list", () => {
    // `[].every(...)` is `true`. A record with no questions has not shown that
    // every question was answered -- it has shown that nobody wrote any down.
    // This is the vacuity rule `deriveDesignCriteria` already carries.
    expect(deriveResearchCriteria(record({ questions: [] }))).not.toContain(
      RESEARCH_QUESTIONS_CRITERION,
    );
  });

  it("does NOT derive it when an answer carries no citation", () => {
    const uncited = record({
      questions: [
        { id: "q1", question: "Which client is used?", answer: "undici.", citations: [] },
      ],
    });
    expect(deriveResearchCriteria(uncited)).not.toContain(RESEARCH_QUESTIONS_CRITERION);
  });

  it("does NOT derive it when a question was left unanswered", () => {
    // An open question is a legitimate mid-research state. It is simply not the
    // state that closes the stage.
    const unanswered = record({
      questions: [{ id: "q1", question: "Which client is used?", citations: [] }],
    });
    expect(deriveResearchCriteria(unanswered)).not.toContain(RESEARCH_QUESTIONS_CRITERION);
  });

  it("derives research-no-silent-assumptions when every uncited answer is declared", () => {
    // The criterion is "anything taken as true without a citation is WRITTEN
    // DOWN as an assumption" -- so an uncited answer is fine exactly when the
    // record owns up to it.
    const declared = record({
      questions: [
        { id: "q1", question: "Which client is used?", answer: "undici.", citations: [] },
      ],
      assumptions: [{ id: "a1", statement: "undici is the client", coversQuestion: "q1" }],
    });
    expect(deriveResearchCriteria(declared)).toContain(RESEARCH_ASSUMPTIONS_CRITERION);
  });

  it("does NOT derive it when an uncited answer is covered by no assumption", () => {
    const silent = record({
      questions: [
        { id: "q1", question: "Which client is used?", answer: "undici.", citations: [] },
      ],
      assumptions: [],
    });
    expect(deriveResearchCriteria(silent)).not.toContain(RESEARCH_ASSUMPTIONS_CRITERION);
  });

  it("does NOT derive it from an empty record", () => {
    // Same vacuity rule: nothing asserted is not the same as nothing assumed.
    expect(deriveResearchCriteria(record({ questions: [], assumptions: [] }))).not.toContain(
      RESEARCH_ASSUMPTIONS_CRITERION,
    );
  });

  it("never derives research-prior-art-checked, which stays judged", () => {
    // Whether a search was DILIGENT is quality, not shape. §8.7's boundary, and
    // deriving it would be the "claimed coverage read as adequate coverage"
    // failure that document warns about.
    expect(deriveResearchCriteria(record())).not.toContain("research-prior-art-checked");
  });
});

describe("researchContradictions", () => {
  it("reports a contradiction when an uncited answer has no assumption behind it", () => {
    // Distinct from "not derived": this is evidence AGAINST the criterion, so an
    // attestation claiming it is void rather than merely unsupported.
    const silent = record({
      questions: [
        { id: "q1", question: "Which client is used?", answer: "undici.", citations: [] },
      ],
    });
    expect(researchContradictions(silent)).toContain(RESEARCH_ASSUMPTIONS_CRITERION);
  });

  it("reports nothing for a record that is merely silent", () => {
    // An empty record contradicts nothing. Flattening "silent" into
    // "contradicted" is the mirror of flattening it into "proven", and both
    // make an absent artifact decide a stage.
    expect(researchContradictions(record({ questions: [], assumptions: [] }))).toEqual([]);
  });

  it("reports nothing for a fully cited record", () => {
    expect(researchContradictions(record())).toEqual([]);
  });
});
