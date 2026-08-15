import { describe, expect, it } from "vitest";
import {
  DOMAIN_LENSES,
  DomainLensSchema,
  domainLensById,
  lensesApplicableTo,
  type DomainLensId,
} from "./domain-lenses.js";
import type { StackEvidence } from "./stack-evidence.js";

/**
 * The domain roster — `docs/design/owner-pipeline-conformance.md` §5.2, and
 * roadmap/25 work item 1.
 *
 * WHY THESE ARE TESTS AND NOT A FOLDER OF AGENT FILES. The owner asked for a
 * design panel of per-domain specialists and for four evaluators on the
 * implement stage. Shipped as `.md` agent files, the roster would be a
 * plugin-packaging concern that no check can enumerate, and "we ran five of the
 * six lenses" would be indistinguishable from "we ran them all". As data it is
 * countable, and — the load-bearing half — a SKIPPED lens is stateable.
 */

const stack = (findings: readonly { category: string; ecosystem: string }[]): StackEvidence =>
  ({
    schemaVersion: 1,
    id: "stack-1",
    createdAt: "2026-08-15T00:00:00.000Z",
    findings: findings.map((finding) => ({
      category: finding.category,
      ecosystem: finding.ecosystem,
      detail: "fixture",
      path: "fixture",
      confidence: 1,
    })),
    contradictions: [],
    unresolvedAmbiguity: [],
  }) as StackEvidence;

const EMPTY_STACK = stack([]);

describe("DOMAIN_LENSES", () => {
  it("covers the owner's six domains and the four implement-stage evaluators", () => {
    // Six domains named 2026-08-15 (backend, front-end, infrastructure,
    // testing, product design, target domain) plus the evaluators. `security`
    // and `correctness` already exist as pipeline lenses, so the two this
    // roster adds are `compliance` and `clean-code` -- the two the audit found
    // missing (design doc §3, row 13: "2 of 4").
    expect(DOMAIN_LENSES.map((lens) => lens.id)).toEqual([
      "backend",
      "frontend",
      "infrastructure",
      "testing",
      "product-design",
      "target-domain",
      "compliance",
      "clean-code",
    ]);
  });

  it("gives every lens exactly one question to answer", () => {
    // `eo-reviewer`'s charter: "you answer only that question -- the other
    // lenses are other reviewers' work, and duplicating them wastes a round
    // without adding a perspective."
    for (const lens of DOMAIN_LENSES) {
      expect(lens.question.length).toBeGreaterThan(20);
      expect(lens.question.trim().endsWith("?")).toBe(true);
    }
  });

  it("keeps every lens id unique and kebab-case", () => {
    const ids = DOMAIN_LENSES.map((lens) => lens.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-z0-9-]+$/);
  });
});

describe("a lens that always applies has to say so", () => {
  it("refuses a lens with no applicability predicate", () => {
    // roadmap/25 work item 1: "a lens with no `appliesWhen` is unrepresentable
    // -- a lens that always applies is a claim, and it must be written as one."
    const withoutPredicate = {
      id: "backend",
      question: "Does the server-side design hold under the loads it will see?",
    };
    expect(DomainLensSchema.safeParse(withoutPredicate).success).toBe(false);
  });

  it("parses the same lens once the predicate is supplied", () => {
    // The positive control. Without it the refusal above could be caused by any
    // other defect in the fixture, and would prove nothing about the field.
    const withPredicate = {
      id: "backend",
      question: "Does the server-side design hold under the loads it will see?",
      appliesWhen: { kind: "always", because: "every change set writes code" },
    };
    expect(DomainLensSchema.safeParse(withPredicate).success).toBe(true);
  });

  it("refuses an `always` predicate with no stated reason", () => {
    // "Always" with no `because` is the unenumerable roster wearing a schema.
    const noReason = {
      id: "backend",
      question: "Does the server-side design hold under the loads it will see?",
      appliesWhen: { kind: "always" },
    };
    expect(DomainLensSchema.safeParse(noReason).success).toBe(false);
  });

  it("refuses a stack predicate that matches nothing", () => {
    // A `stack` predicate with neither categories nor ecosystems can never
    // fire, so the lens would silently never run -- exactly the state the
    // skipped-lens report exists to make visible.
    const matchesNothing = {
      id: "backend",
      question: "Does the server-side design hold under the loads it will see?",
      appliesWhen: { kind: "stack", anyCategory: [], anyEcosystem: [] },
    };
    expect(DomainLensSchema.safeParse(matchesNothing).success).toBe(false);
  });

  it("holds for every shipped lens, not just the fixtures", () => {
    for (const lens of DOMAIN_LENSES) {
      expect(DomainLensSchema.safeParse(lens).success).toBe(true);
    }
  });
});

describe("lensesApplicableTo", () => {
  it("returns applicable and skipped lenses, and the two together are the roster", () => {
    // Nothing may fall out of the partition. A lens that is neither applied nor
    // skipped is a lens nobody can notice went missing.
    const verdict = lensesApplicableTo(EMPTY_STACK);
    const seen = [...verdict.applicable.map((l) => l.id), ...verdict.skipped.map((s) => s.lens)];
    expect(new Set(seen).size).toBe(DOMAIN_LENSES.length);
  });

  it("gives every skipped lens a reason", () => {
    // "The pipeline can state which lenses it skipped and why" is the whole
    // reason the roster is data (design doc §5.2).
    for (const skipped of lensesApplicableTo(EMPTY_STACK).skipped) {
      expect(skipped.reason.length).toBeGreaterThan(10);
    }
  });

  it("runs no frontend lens on a repository with no frontend evidence", () => {
    const verdict = lensesApplicableTo(stack([{ category: "migration", ecosystem: "python" }]));
    expect(verdict.applicable.map((l) => l.id)).not.toContain("frontend");
    expect(verdict.skipped.map((s) => s.lens)).toContain("frontend");
  });

  it("runs the frontend lens once frontend evidence exists", () => {
    // The negative control for the row above: same function, evidence added,
    // opposite answer. Without this the skip could be a lens that never runs.
    const verdict = lensesApplicableTo(
      stack([{ category: "source_composition", ecosystem: "react" }]),
    );
    expect(verdict.applicable.map((l) => l.id)).toContain("frontend");
  });

  it("runs the infrastructure lens on container or CI evidence", () => {
    const containerised = lensesApplicableTo(
      stack([{ category: "container", ecosystem: "docker" }]),
    );
    expect(containerised.applicable.map((l) => l.id)).toContain("infrastructure");
  });

  it("always runs the lenses whose predicate says always, even on an empty stack", () => {
    // An empty StackEvidence is what a brand-new repository looks like. The
    // four unconditional lenses must still fire there, or a greenfield project
    // gets no review at all.
    const applicable = lensesApplicableTo(EMPTY_STACK).applicable.map((l) => l.id);
    for (const id of ["testing", "target-domain", "compliance", "clean-code"] as DomainLensId[]) {
      expect(applicable).toContain(id);
    }
  });

  it("never returns a lens in both partitions", () => {
    const verdict = lensesApplicableTo(stack([{ category: "ci", ecosystem: "node" }]));
    const applied = new Set(verdict.applicable.map((l) => l.id));
    for (const skipped of verdict.skipped) {
      expect(applied.has(skipped.lens)).toBe(false);
    }
  });
});

describe("domainLensById", () => {
  it("resolves a known lens", () => {
    expect(domainLensById("compliance").id).toBe("compliance");
  });

  it("throws for an unknown lens rather than returning nothing to run", () => {
    // Same reasoning as `exitCriteriaFor`: a lookup that returns `undefined`
    // for a typo turns into a lens that silently never runs.
    expect(() => domainLensById("nonsense" as DomainLensId)).toThrow(/unknown domain lens/i);
  });
});
