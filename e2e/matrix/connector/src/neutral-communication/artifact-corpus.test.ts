/**
 * roadmap/23-release-hardening.md work item 6: "Neutral-communication:
 * golden/property suites across every artifact class (branch/commit/
 * PR-title/PR-body/review-comment/jira-milestone-comment/grafana-
 * annotation) ... reuse 17's lint (validateAdfSafeSubset/lint) + goldens."
 *
 * This suite drives the REAL `@eo/renderer` `lint()` pipeline (never a
 * reimplementation) against one valid fixture per `ArtifactKind`, plus a
 * small property sweep, proving every legitimate rendered artifact clears
 * every stage. The negative fixtures (confusable domain, secret-shaped
 * payload) live in their own dedicated fail-first files alongside this one
 * — `./confusable-domain.test.ts`, `./secret-leakage.test.ts`.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  ARTIFACT_KINDS,
  lint,
  renderGrafanaAnnotation,
  renderJiraMilestoneComment,
  renderPrBody,
  renderPrTitle,
  renderReviewComment,
  type ArtifactKind,
} from "@eo/renderer";
import { DEFAULT_COMMUNICATION_POLICY } from "@eo/contracts";
import {
  CONNECTOR_MATRIX_GATE_TAG,
  createScenarioJournal,
  emitScenarioEvidence,
} from "../support/evidence.js";
import type { ScenarioJournal } from "../support/evidence.js";

/** One genuinely valid candidate per `ArtifactKind` — mirrors `@eo/renderer`'s own `golden.test.ts` fixture choices, reusing the SAME real template functions (never a bespoke re-derivation). */
function validCandidateFor(kind: ArtifactKind): string {
  switch (kind) {
    case "branch_name":
      return "feature/connector-matrix-harness";
    case "commit_subject":
      return renderPrTitle({
        type: "feat",
        scope: "connector-matrix",
        outcome: "add release-gate harness",
      });
    case "commit_body":
      return "Adds the phase-23 connector matrix E2E harness over real gateway/renderer/connector logic.";
    case "pr_title":
      return renderPrTitle({
        type: "feat",
        scope: "connector-matrix",
        outcome: "add release-gate harness",
      });
    case "pr_body":
      return renderPrBody({
        outcome: "shipped the phase-23 connector matrix harness",
        validation: "unit + property + cassette-replay suites green",
        risk: "low, harness-only, no production code touched",
        tracking: "PROJ-23",
      });
    case "review_comment":
      return renderReviewComment({
        finding: "missing null check on parsed input",
        evidence: "src/parser.ts:42",
        action: "add a guard clause before dereferencing",
      });
    case "jira_milestone_comment":
      return renderJiraMilestoneComment({
        outcome: "connector matrix harness shipped",
        evidence: "https://ci.example.com/build/23",
        risk: "none",
        next: "monitor the release-e2e job",
        ref: "PROJ-23",
      });
    case "grafana_annotation":
      return renderGrafanaAnnotation({
        state: "resolved",
        service: "connector-matrix-harness",
        change: "deployed v1.0.0",
        evidenceRef: "https://ci.example.com/build/23",
      });
    /* c8 ignore next 2 -- exhaustiveness guard; ARTIFACT_KINDS is a closed union */
    default: {
      const _exhaustive: never = kind;
      throw new Error(`unhandled ArtifactKind: ${String(_exhaustive)}`);
    }
  }
}

let tj: ScenarioJournal;

beforeEach(async () => {
  tj = await createScenarioJournal();
});

afterEach(async () => {
  await tj.cleanup();
});

describe("neutral-communication — real @eo/renderer lint() over every ArtifactKind (golden)", () => {
  it("every ArtifactKind's one valid golden fixture clears the full real lint() pipeline", async () => {
    const outcomes: Record<string, unknown> = {};
    for (const kind of ARTIFACT_KINDS) {
      const candidate = validCandidateFor(kind);
      const outcome = lint(candidate, kind, DEFAULT_COMMUNICATION_POLICY);
      outcomes[kind] = outcome;
      expect(outcome.ok, `${kind} unexpectedly blocked: ${JSON.stringify(outcome)}`).toBe(true);
    }
    // All 8 members of the closed ArtifactKind union are covered — a future
    // addition to that union fails this length assertion, not silently
    // skips coverage.
    expect(ARTIFACT_KINDS).toHaveLength(8);

    const record = await emitScenarioEvidence({
      journal: tj.store,
      command:
        "connector-matrix: neutral-communication golden corpus (all 8 ArtifactKinds, real lint())",
      exitStatus: 0,
      outcomeContent: JSON.stringify(outcomes),
    });

    // Scoped to this record's own freshly-minted `changeSetId`: what is
    // proved is unchanged — that one `emitScenarioEvidence` call appended
    // exactly ONE durable, correctly-tagged, readable-back entry. A bare
    // journal-wide count only means that while the journal is private;
    // under `EO_RELEASE_GATE_JOURNAL_DIR` (see `../support/evidence.ts`)
    // every sibling harness's evidence is visible here too.
    const evidence: unknown[] = [];
    for await (const entry of tj.store.queryEntries({
      type: "evidence_pointer",
      changeSetId: record.changeSetId,
    })) {
      evidence.push(entry);
    }
    expect(evidence).toHaveLength(1);
    expect((evidence[0] as { payload: { gateTag?: string } }).payload.gateTag).toBe(
      CONNECTOR_MATRIX_GATE_TAG,
    );
  });
});

// A short alphanumeric "word" — bounded well under every ArtifactKind's
// tightest maxChars limit (branch_name's 64) even after several are
// concatenated by a template, and never overlapping any lint stage's
// forbidden-content patterns (no URLs, no secret-shaped substrings, no
// non-ASCII/control codepoints).
// Excludes `@eo/renderer`'s own `attribution-neutral` first-person-pronoun
// set (I/we/our/my/mine, case-insensitive whole-word) and its
// `evidence-claims` completion-claim words (fixed/resolved/verified/
// working/completed) — both real, intentional lint blocks this property
// is not scoped to exercising (that is `attribution-neutral.test.ts` /
// `evidence-claims.test.ts`'s own job, upstream in `@eo/renderer` itself).
const FIRST_PERSON_OR_CLAIM_WORDS = new Set([
  "i",
  "we",
  "our",
  "my",
  "mine",
  "fixed",
  "resolved",
  "verified",
  "working",
  "completed",
]);
const wordArb = fc
  .stringMatching(/^[A-Za-z][A-Za-z0-9]{0,9}$/)
  .filter((w) => !FIRST_PERSON_OR_CLAIM_WORDS.has(w.toLowerCase()));
const shortPhraseArb = fc
  .array(wordArb, { minLength: 1, maxLength: 4 })
  .map((words) => words.join(" "));
const commitTypeArb = fc.constantFrom("feat", "fix", "chore", "refactor", "docs", "test");

describe("neutral-communication — property: real render*() + real lint() over randomized (but structurally valid) content", () => {
  it("branch_name: any short alnum-hyphen name clears lint()", () => {
    fc.assert(
      fc.property(wordArb, wordArb, (a, b) => {
        const candidate = `feature/${a}-${b}`;
        return lint(candidate, "branch_name", DEFAULT_COMMUNICATION_POLICY).ok === true;
      }),
      { numRuns: 100 },
    );
  });

  it("commit_subject / pr_title: renderPrTitle's own conventional-commit shape always clears lint()", () => {
    fc.assert(
      fc.property(commitTypeArb, wordArb, shortPhraseArb, (type, scope, outcome) => {
        const candidate = renderPrTitle({ type, scope, outcome });
        const bothKindsOk =
          lint(candidate, "commit_subject", DEFAULT_COMMUNICATION_POLICY).ok === true &&
          lint(candidate, "pr_title", DEFAULT_COMMUNICATION_POLICY).ok === true;
        return bothKindsOk;
      }),
      { numRuns: 100 },
    );
  });

  it("commit_body: any 1-5 line benign phrase clears lint()", () => {
    const bodyArb = fc
      .array(shortPhraseArb, { minLength: 1, maxLength: 5 })
      .map((lines) => lines.join("\n"));
    fc.assert(
      fc.property(bodyArb, (candidate) => {
        return lint(candidate, "commit_body", DEFAULT_COMMUNICATION_POLICY).ok === true;
      }),
      { numRuns: 100 },
    );
  });

  it("pr_body: renderPrBody's own section shape always clears lint()", () => {
    fc.assert(
      fc.property(
        shortPhraseArb,
        shortPhraseArb,
        shortPhraseArb,
        wordArb,
        (outcome, validation, risk, tracking) => {
          const candidate = renderPrBody({ outcome, validation, risk, tracking });
          return lint(candidate, "pr_body", DEFAULT_COMMUNICATION_POLICY).ok === true;
        },
      ),
      { numRuns: 100 },
    );
  });

  it("review_comment: renderReviewComment's own section shape always clears lint()", () => {
    fc.assert(
      fc.property(shortPhraseArb, shortPhraseArb, shortPhraseArb, (finding, evidence, action) => {
        const candidate = renderReviewComment({ finding, evidence, action });
        return lint(candidate, "review_comment", DEFAULT_COMMUNICATION_POLICY).ok === true;
      }),
      { numRuns: 100 },
    );
  });

  it("jira_milestone_comment: renderJiraMilestoneComment's own section shape always clears lint()", () => {
    fc.assert(
      fc.property(
        shortPhraseArb,
        shortPhraseArb,
        shortPhraseArb,
        shortPhraseArb,
        wordArb,
        (outcome, evidence, risk, next, ref) => {
          const candidate = renderJiraMilestoneComment({ outcome, evidence, risk, next, ref });
          return (
            lint(candidate, "jira_milestone_comment", DEFAULT_COMMUNICATION_POLICY).ok === true
          );
        },
      ),
      { numRuns: 100 },
    );
  });

  it("grafana_annotation: renderGrafanaAnnotation's own shape always clears lint()", () => {
    fc.assert(
      fc.property(
        wordArb,
        wordArb,
        shortPhraseArb,
        wordArb,
        (state, service, change, evidenceRef) => {
          const candidate = renderGrafanaAnnotation({ state, service, change, evidenceRef });
          return lint(candidate, "grafana_annotation", DEFAULT_COMMUNICATION_POLICY).ok === true;
        },
      ),
      { numRuns: 100 },
    );
  });
});
