import { CONTRACT_SECTIONS } from "./intent-contract.js";
import { DOMAIN_LENS_IDS } from "./domain-lenses.js";

/**
 * The staged review pipeline's stages and their exit criteria —
 * `docs/staged-review-pipeline.md` §4.4, promoted from an illustrative table to
 * the checkable list §4.1's termination rule requires.
 *
 * WHY THIS IS DATA AND NOT PROSE. §4.1 closes a stage when "every one of its
 * written exit criteria is met". A stage whose criteria live only in a document
 * has exactly the termination problem the superseded loop had, one level up:
 * nothing to check against, so closure becomes a judgement about whether enough
 * has been done. Criteria carry stable ids because a `blocking` finding must
 * name the one it violates, and a name that does not resolve to anything is not
 * a constraint.
 *
 * These are deliberately about ARTIFACT COMPLETENESS, not quality. "Every
 * acceptance criterion is addressed by some element of the design" is
 * checkable; "the design is good" is the thing twelve rounds proved
 * inexhaustible.
 */

export const PIPELINE_STAGE_IDS = [
  "research",
  "clarify",
  "design",
  "design-gate",
  "plan",
  "implement",
  "integrate",
  "audit",
  "document",
] as const;
export type PipelineStageId = (typeof PIPELINE_STAGE_IDS)[number];

export interface ExitCriterion {
  /** Stable, referenced by a blocking finding's `violates`. */
  readonly id: string;
  /** What must be true, phrased so a reviewer can answer yes or no. */
  readonly statement: string;
}

export interface PipelineStage {
  readonly id: PipelineStageId;
  /** What a human reads. */
  readonly label: string;
  /**
   * The reviewer lenses for this stage. Empty means the stage is not closed by
   * a judged review at all — clarify closes on the owner's answers, integrate
   * on the final-candidate gate.
   *
   * Where there are lenses there are at least two: diversity of perspective is
   * what replaced repeating one hostile pass, and a single-lens stage is that
   * repetition wearing a different name.
   */
  readonly lenses: readonly string[];
  readonly exitCriteria: readonly ExitCriterion[];
}

/**
 * Clarify's criteria are DERIVED from the nine contract sections.
 *
 * This stage already terminates correctly in the shipped product and is the
 * model the rest of the pipeline copies, so its criteria are generated from the
 * same list the contract schema declares rather than transcribed. A transcribed
 * copy is a copy that drifts.
 */
const CLARIFY_CRITERIA: readonly ExitCriterion[] = [
  ...CONTRACT_SECTIONS.map((section) => ({
    id: `contract-section-${section}`,
    statement: `The IntentContract's "${section}" section is answerable from what the owner has said and what research established.`,
  })),
  {
    id: "acceptance-criteria-testable",
    statement:
      "Every requirement carries acceptance criteria that name an observable outcome, so a later stage can check them rather than judge them.",
  },
];

export const PIPELINE_STAGES: readonly PipelineStage[] = [
  {
    id: "research",
    label: "Research",
    lenses: ["completeness", "source-quality", "assumption-audit"],
    exitCriteria: [
      {
        id: "research-questions-answered",
        statement:
          "Every question the contract's sections depend on has an answer, and each answer cites where it came from.",
      },
      {
        id: "research-no-silent-assumptions",
        statement:
          "Anything taken as true without a citation is written down as an assumption, so a later stage can see what it is standing on.",
      },
      {
        id: "research-prior-art-checked",
        statement:
          "Existing implementations in this repository and its dependencies have been looked for before anything new is proposed.",
      },
    ],
  },
  {
    id: "clarify",
    label: "Clarify with the owner",
    lenses: [],
    exitCriteria: CLARIFY_CRITERIA,
  },
  {
    id: "design",
    label: "Design",
    lenses: ["contract-fit", "security", "operability"],
    exitCriteria: [
      {
        id: "design-addresses-every-acceptance-criterion",
        statement:
          "Every acceptance criterion in the contract is addressed by a named element of the design.",
      },
      {
        id: "design-interfaces-named",
        statement:
          "Every interface the design introduces or changes is named, with the package that owns it.",
      },
      {
        id: "design-risks-have-mitigations",
        statement:
          "Every risk the design records carries either a mitigation or an explicit statement that it is accepted, and why.",
      },
      {
        id: "design-reconciled-with-ledger",
        statement:
          "Any cross-phase interface ruling the design touches is reconciled with docs/interface-ledger.md rather than contradicted silently.",
      },
    ],
  },
  {
    id: "design-gate",
    label: "Owner confirms the design",
    /**
     * No lenses, by construction. Ruling R2 (2026-08-15) added this stage so the
     * owner can say "this is not what I meant" BEFORE any worker is dispatched —
     * steps 6 and 7 of the owner's pipeline. A reviewer lens here would create a
     * second route to closure that is not the owner, which is the difference
     * between a gate and a checkpoint the model can satisfy for itself.
     */
    lenses: [],
    exitCriteria: [
      {
        id: "design-gate-owner-verdict-recorded",
        statement:
          "The owner has recorded a verdict on this exact design revision. No reviewer verdict, attestation or server-side derivation closes this stage — only the owner does, and a rejection returns to the design stage carrying their reason.",
      },
    ],
  },
  {
    id: "plan",
    label: "Plan",
    lenses: ["coverage-of-design", "sequencing"],
    exitCriteria: [
      {
        id: "plan-covers-every-design-element",
        statement: "Every element of the approved design maps to at least one task.",
      },
      {
        id: "plan-tasks-have-done-criteria",
        statement:
          "Every task states how it will be known to be done, in terms something other than the author can check.",
      },
      {
        id: "plan-dependencies-acyclic",
        statement:
          "Task dependencies form a directed acyclic graph, so the plan can actually be executed in some order.",
      },
    ],
  },
  {
    id: "implement",
    label: "Implement",
    /**
     * FOUR evaluators, not two (owner request 2026-08-15, roadmap/25).
     *
     * The owner asked for four specialised agents to evaluate the work:
     * security, code review, compliance, and best practice for the stack. Two
     * existed already as pipeline lenses; `compliance` and `clean-code` are the
     * two the audit found missing, and they are taken from `DOMAIN_LENSES`
     * rather than invented here so that "compliance" means one thing whether it
     * is raised at the implement stage or at the audit.
     */
    lenses: ["correctness", "security", "compliance", "clean-code"],
    exitCriteria: [
      {
        id: "implement-gates-pass",
        statement:
          "Every deterministic gate for this work unit returns a passing GateVerdict. Gate territory is decided by the gate, never re-argued by a reviewer.",
      },
      {
        id: "implement-task-done-criteria-met",
        statement: "The task's own stated done-criteria are met.",
      },
      {
        id: "implement-tests-first",
        statement:
          "The work has tests that failed before it and pass after it, per the repository's TDD ground rule.",
      },
      {
        id: "no-open-debt-in-touched-paths",
        statement:
          "No advisory finding previously deferred as accepted-debt concerns a path this change set writes. Touching that code is what reopens it.",
      },
    ],
  },
  {
    id: "integrate",
    label: "Integrate",
    lenses: [],
    exitCriteria: [
      {
        id: "integrate-final-candidate-gate",
        statement:
          "The final-candidate gate passes on the exact merge candidate, not on an earlier commit.",
      },
    ],
  },
  {
    id: "audit",
    label: "Audit the end product",
    /**
     * The audit reuses `DOMAIN_LENS_IDS` rather than declaring a vocabulary of
     * its own. A second roster would make "backend" name two different
     * questions depending on which stage raised the finding, and a blocking
     * finding identifies itself by lens — so the two rosters would have to be
     * kept in step by hand, which is the drift this repository has paid for
     * more than once.
     */
    lenses: DOMAIN_LENS_IDS,
    exitCriteria: [
      {
        id: "audit-every-applicable-lens-ran",
        statement:
          "Every domain lens applicable to this project's detected stack has returned a verdict, and every lens that did not run is recorded as skipped with its reason.",
      },
      {
        id: "audit-no-admissible-novel-findings",
        statement:
          "The final round produced no admissible novel finding under any applicable lens, where admissible means the finding concerns a path this change set writes and has not been raised before.",
      },
    ],
  },
  {
    id: "document",
    label: "Document",
    /**
     * "Easy to read and detailed" was the owner's phrasing, and readability is
     * genuinely a judgement — so it is a LENS. The exit criteria below are
     * coverage claims instead, because coverage is the half a record can
     * decide, and a stage that closed on "the prose is good" would be the
     * taste-based closure §4.3 of the design doc rules out everywhere else.
     */
    lenses: ["completeness", "readability"],
    exitCriteria: [
      {
        id: "document-user-guide-covers-every-command",
        statement:
          "Every public command and gateway tool this change set adds or changes appears in the user guide.",
      },
      {
        id: "document-maintenance-guide-covers-every-failure-mode",
        statement:
          "Every operational failure mode the design records appears in the maintenance guide, with what an operator sees and what they do about it.",
      },
      {
        id: "document-claims-resolve",
        statement:
          "Every command, path and flag a guide names actually exists. This is what separates a guide from a plausible guide.",
      },
    ],
  },
];

export function stageById(id: PipelineStageId): PipelineStage {
  const stage = PIPELINE_STAGES.find((candidate) => candidate.id === id);
  if (stage === undefined) throw new Error(`unknown stage: ${id}`);
  return stage;
}

/**
 * The criterion ids a stage must satisfy to close.
 *
 * Throws for an unknown stage rather than returning an empty list: an empty
 * list satisfies §4.1 vacuously, so a typo would close a stage instead of
 * failing loudly.
 */
export function exitCriteriaFor(id: PipelineStageId): readonly string[] {
  return stageById(id).exitCriteria.map((criterion) => criterion.id);
}
