import { describe, expect, it } from "vitest";
import type { ReviewFinding } from "@crabgic/contracts";
import {
  admissibilityOf,
  closureVerdict,
  findingKey,
  novelFindings,
  partitionByAdmissibility,
  unrunObligations,
} from "./admissibility.js";

/**
 * The four admissibility bounds — ruling R4 (2026-08-15),
 * `docs/design/owner-pipeline-conformance.md` §4.3, roadmap/25 work item 6.
 *
 * WHAT THESE TESTS ARE ACTUALLY FOR. The owner asked for a loop that ends when
 * the reviewers find no issues. Rounds 21-32 measured that loop running twelve
 * times without converging, every finding real. The diagnosis recorded then —
 * "a codebase contains an inexhaustible supply of true defects" — was half
 * right: what was actually unbounded was the SEARCH SPACE, not the defect
 * supply. The reviewer had a whole subsystem in scope, no enumerated list of
 * what it owed an answer about, and no key by which two findings were the same
 * finding.
 *
 * These bounds make the space finite, so a zero-findings round is a statement
 * about a finite set rather than about a reviewer's imagination. The suite below
 * is written to fail if any one of them is removed — which is the property the
 * phase's exit criteria require and the reason each bound has its own describe
 * block.
 */

const finding = (overrides: Partial<ReviewFinding> = {}): ReviewFinding =>
  ({
    id: "11111111-2222-4333-8444-555555555555",
    claim: "The token is compared with a non-constant-time equality.",
    evidence: { reproduction: "run x", observed: "early return", expected: "constant time" },
    verification: "confirmed",
    classification: "advisory",
    paths: ["packages/gateway/src/auth.ts"],
    ...overrides,
  }) as ReviewFinding;

const WRITE_SET = ["packages/gateway/src/auth.ts", "packages/cli/src/review/"];

describe("bound 1 — scope", () => {
  it("admits a finding about a path this change set writes", () => {
    expect(admissibilityOf(finding(), WRITE_SET).admissible).toBe(true);
  });

  it("refuses a finding about code this change set does not touch", () => {
    // This is the bound that turns "the whole subsystem" into "the diff". Code
    // nobody is changing is pre-existing: it belongs to the debt index, which
    // reopens it when that code is next touched (§7.3), not to this loop.
    const elsewhere = finding({ paths: ["packages/journal/src/chain.ts"] });
    const verdict = admissibilityOf(elsewhere, WRITE_SET);
    expect(verdict.admissible).toBe(false);
    expect(verdict.reason).toMatch(/outside/i);
  });

  it("admits a finding under a directory the change set writes", () => {
    // Write sets name directories as well as files. Matching only exact paths
    // would make a whole tree inadmissible and quietly shrink the loop.
    const nested = finding({ paths: ["packages/cli/src/review/finding-store.ts"] });
    expect(admissibilityOf(nested, WRITE_SET).admissible).toBe(true);
  });

  it("normalizes both sides before comparing", () => {
    // The index and the overlap analyzer must not disagree about what a path
    // names. Round 31's lesson: two functions answering one question diverge.
    const messy = finding({ paths: ["./packages/gateway/src//auth.ts"] });
    expect(admissibilityOf(messy, ["packages/gateway/src/auth.ts"]).admissible).toBe(true);
  });

  it("refuses a finding that names no path at all", () => {
    // DISCLOSED TRADE-OFF, tested so it is a decision rather than an accident.
    // A pathless finding can never be excluded by a scope bound, so admitting
    // it would restore the unbounded space this rule exists to close. It is
    // refused HERE and recorded to the debt index instead -- never dropped.
    const pathless = finding({ paths: [] });
    const verdict = admissibilityOf(pathless, WRITE_SET);
    expect(verdict.admissible).toBe(false);
    expect(verdict.reason).toMatch(/no path/i);
  });
});

describe("bound 3 — identity", () => {
  it("gives the same finding the same key across rounds", () => {
    expect(findingKey(finding(), "security")).toBe(findingKey(finding(), "security"));
  });

  it("ignores the finding's own id, which changes every round", () => {
    // Keying on `id` would make every re-raising novel, which is precisely the
    // state that ran twelve rounds.
    const reRaised = finding({ id: "99999999-8888-4777-8666-555555555555" });
    expect(findingKey(reRaised, "security")).toBe(findingKey(finding(), "security"));
  });

  it("collapses a reworded claim that says the same thing", () => {
    // Whitespace and case are not new information. A reviewer that rephrases
    // its way to a novel finding is the verbosity bias §3 of the pipeline
    // design warns about, expressed as a hash collision failure.
    const reworded = finding({
      claim: "  The token is compared   with a NON-constant-time equality.  ",
    });
    expect(findingKey(reworded, "security")).toBe(findingKey(finding(), "security"));
  });

  it("separates two genuinely different claims", () => {
    // The negative control. Without it a key that returned a constant would
    // pass every test above and silence the entire review loop.
    const different = finding({ claim: "The session id is logged in cleartext." });
    expect(findingKey(different, "security")).not.toBe(findingKey(finding(), "security"));
  });

  it("separates the same claim raised under a different lens", () => {
    // Two lenses reaching the same conclusion by different routes is
    // corroboration, and each owes its own disposition.
    expect(findingKey(finding(), "correctness")).not.toBe(findingKey(finding(), "security"));
  });

  it("separates the same claim about a different path", () => {
    const otherPath = finding({ paths: ["packages/cli/src/review/other.ts"] });
    expect(findingKey(otherPath, "security")).not.toBe(findingKey(finding(), "security"));
  });

  it("treats path order as immaterial", () => {
    const oneOrder = finding({ paths: ["a/b.ts", "c/d.ts"] });
    const otherOrder = finding({ paths: ["c/d.ts", "a/b.ts"] });
    expect(findingKey(oneOrder, "security")).toBe(findingKey(otherOrder, "security"));
  });
});

describe("novelFindings", () => {
  it("returns a finding nobody has raised before", () => {
    expect(novelFindings([finding()], new Set(), "security").length).toBe(1);
  });

  it("drops a finding already on record", () => {
    expect(
      novelFindings([finding()], new Set([findingKey(finding(), "security")]), "security"),
    ).toEqual([]);
  });

  it("deduplicates within a single round", () => {
    // Two lenses can raise the same finding in one round. It is one finding and
    // owes one disposition; counting it twice would inflate the round.
    expect(novelFindings([finding(), finding()], new Set(), "security").length).toBe(1);
  });
});

describe("bound 2 — obligation", () => {
  it("names an obligation the lens never answered", () => {
    expect(unrunObligations(["o1", "o2"], ["o1"])).toEqual(["o2"]);
  });

  it("names nothing when every obligation was answered", () => {
    expect(unrunObligations(["o1"], ["o1", "o-extra"])).toEqual([]);
  });

  it("treats an EMPTY obligation list as unmet, not as satisfied", () => {
    // A lens issued no checklist has not answered everything it owed -- it was
    // never told what it owed. `[].every(...)` is `true`, and letting that read
    // as coverage is the vacuity failure this repository has now paid for at
    // five separate criteria.
    expect(unrunObligations([], [])).toEqual(["<no obligations were issued to this lens>"]);
  });
});

describe("closureVerdict — the owner's zero-findings exit", () => {
  const dispositioned = finding({
    disposition: "fixed",
    dispositionEvidence: "commit abc123 adds a constant-time compare",
  });

  it("closes a round that produced no admissible novel finding", () => {
    // THE OWNER'S EXIT, literally. Not "no blocking finding" and not "a round
    // that closed nothing" -- zero findings, with severity playing no part.
    const verdict = closureVerdict({
      lens: "security",
      findings: [],
      seenKeys: new Set(),
      plannedWritePaths: WRITE_SET,
      obligationsIssued: ["o1"],
      obligationsAnswered: ["o1"],
      round: 1,
      runawayGuard: 20,
    });
    expect(verdict.closed).toBe(true);
  });

  it("does NOT close on a round that raised a NEW advisory, even though it was answered", () => {
    // Severity plays no part. An advisory raised this round holds the stage
    // open exactly as a blocker would -- which is the clause the superseded
    // rule could not honour and the reason R4 re-opened it. The fixture is
    // dispositioned deliberately, so this isolates NOVELTY: were it
    // undispositioned the stage would fail on that older rule instead and this
    // test would prove nothing about the owner's exit.
    const verdict = closureVerdict({
      lens: "security",
      findings: [
        finding({
          classification: "advisory",
          disposition: "fixed",
          dispositionEvidence: "answered in the same round",
        }),
      ],
      seenKeys: new Set(),
      plannedWritePaths: WRITE_SET,
      obligationsIssued: ["o1"],
      obligationsAnswered: ["o1"],
      round: 1,
      runawayGuard: 20,
    });
    expect(verdict.closed).toBe(false);
    expect(verdict.reason).toMatch(/novel/i);
  });

  it("closes once that advisory has been dispositioned and is no longer novel", () => {
    // The negative control for the row above: same finding, now answered and on
    // record, and the round goes quiet. Without this the rule could be "never
    // closes" and every other assertion would still pass.
    const verdict = closureVerdict({
      lens: "security",
      findings: [dispositioned],
      seenKeys: new Set([findingKey(dispositioned, "security")]),
      plannedWritePaths: WRITE_SET,
      obligationsIssued: ["o1"],
      obligationsAnswered: ["o1"],
      round: 2,
      runawayGuard: 20,
    });
    expect(verdict.closed).toBe(true);
  });

  it("does NOT close while an obligation went unanswered, even with no findings", () => {
    // A silent lens and a satisfied lens look identical from the findings
    // alone. This is what stops "nobody reported anything" reading as "nothing
    // is wrong" -- the inert-control failure, applied to review coverage.
    const verdict = closureVerdict({
      lens: "security",
      findings: [],
      seenKeys: new Set(),
      plannedWritePaths: WRITE_SET,
      obligationsIssued: ["o1", "o2"],
      obligationsAnswered: ["o1"],
      round: 1,
      runawayGuard: 20,
    });
    expect(verdict.closed).toBe(false);
    expect(verdict.reason).toMatch(/obligation/i);
  });

  it("does NOT close while a finding on record has no disposition", () => {
    // Preserved from the superseded rule and not softened by R4: a stage may
    // not advance holding an undispositioned finding of any severity.
    const verdict = closureVerdict({
      lens: "security",
      findings: [finding()],
      seenKeys: new Set([findingKey(finding(), "security")]),
      plannedWritePaths: WRITE_SET,
      obligationsIssued: ["o1"],
      obligationsAnswered: ["o1"],
      round: 3,
      runawayGuard: 20,
    });
    expect(verdict.closed).toBe(false);
    expect(verdict.reason).toMatch(/disposition/i);
  });

  it("ignores an out-of-scope finding when deciding closure", () => {
    // The scope bound doing its job end to end: a real finding about untouched
    // code does not hold this stage open. It is still returned as deferred, so
    // the caller can record it -- inadmissible never means discarded.
    const outOfScope = finding({ paths: ["packages/journal/src/chain.ts"] });
    const verdict = closureVerdict({
      lens: "security",
      findings: [outOfScope],
      seenKeys: new Set(),
      plannedWritePaths: WRITE_SET,
      obligationsIssued: ["o1"],
      obligationsAnswered: ["o1"],
      round: 1,
      runawayGuard: 20,
    });
    expect(verdict.closed).toBe(true);
    expect(verdict.deferred.map((f) => f.id)).toContain(outOfScope.id);
  });

  it("stops at the runaway guard and says the loop stalled rather than closed", () => {
    // The guard is not the closure rule. A run that ends here has NOT converged,
    // and reporting it as closed would be the syntactic kill-switch pretending
    // to be a verdict.
    const verdict = closureVerdict({
      lens: "security",
      findings: [finding()],
      seenKeys: new Set(),
      plannedWritePaths: WRITE_SET,
      obligationsIssued: ["o1"],
      obligationsAnswered: ["o1"],
      round: 20,
      runawayGuard: 20,
    });
    expect(verdict.closed).toBe(false);
    expect(verdict.stalled).toBe(true);
    expect(verdict.reason).toMatch(/guard/i);
  });

  it("is not stalled on an ordinary non-closing round", () => {
    const verdict = closureVerdict({
      lens: "security",
      findings: [finding()],
      seenKeys: new Set(),
      plannedWritePaths: WRITE_SET,
      obligationsIssued: ["o1"],
      obligationsAnswered: ["o1"],
      round: 2,
      runawayGuard: 20,
    });
    expect(verdict.stalled).toBe(false);
  });
});

describe("the convergence property the superseded rule never had", () => {
  it("terminates when a reviewer raises the same finding every round", () => {
    // The literal shape of the twelve-round failure: a reviewer with more to
    // say every time. Under the identity bound the second raising is not novel,
    // so the loop goes quiet on round two instead of running forever.
    const seen = new Set<string>();
    let round = 1;
    let closed = false;
    while (round <= 20 && !closed) {
      const raised = [
        finding({ disposition: "fixed", dispositionEvidence: "answered in round 1" }),
      ];
      const verdict = closureVerdict({
        lens: "security",
        findings: raised,
        seenKeys: seen,
        plannedWritePaths: WRITE_SET,
        obligationsIssued: ["o1"],
        obligationsAnswered: ["o1"],
        round,
        runawayGuard: 20,
      });
      for (const novel of verdict.novel) seen.add(findingKey(novel, "security"));
      closed = verdict.closed;
      round += 1;
    }
    expect(closed).toBe(true);
    expect(round).toBeLessThanOrEqual(3);
  });

  it("terminates on the round after the last genuinely new finding", () => {
    // Three distinct findings, one per round, each answered. The loop should
    // close on round four -- not earlier (that would drop a finding) and not at
    // the guard (that would be a stall wearing a verdict).
    const claims = ["claim one is here", "claim two is here", "claim three is here"];
    const seen = new Set<string>();
    let round = 1;
    let closed = false;
    while (round <= 20 && !closed) {
      const raised =
        round <= claims.length
          ? [
              finding({
                claim: claims[round - 1] as string,
                disposition: "fixed",
                dispositionEvidence: "answered",
              }),
            ]
          : [];
      const verdict = closureVerdict({
        lens: "security",
        findings: raised,
        seenKeys: seen,
        plannedWritePaths: WRITE_SET,
        obligationsIssued: ["o1"],
        obligationsAnswered: ["o1"],
        round,
        runawayGuard: 20,
      });
      for (const novel of verdict.novel) seen.add(findingKey(novel, "security"));
      closed = verdict.closed;
      round += 1;
    }
    expect(closed).toBe(true);
    expect(round - 1).toBe(4);
  });
});

describe("partitionByAdmissibility", () => {
  it("puts every finding in exactly one side", () => {
    // A finding that is neither admitted nor deferred is a finding nobody can
    // notice went missing -- the same partition property the domain-lens roster
    // is built on.
    const inScope = finding();
    const outOfScope = finding({ paths: ["packages/journal/src/chain.ts"] });
    const split = partitionByAdmissibility([inScope, outOfScope], WRITE_SET);
    expect(split.admissible.length + split.deferred.length).toBe(2);
    expect(split.admissible.map((f) => f.paths)).toContainEqual(inScope.paths);
    expect(split.deferred.map((f) => f.paths)).toContainEqual(outOfScope.paths);
  });
});
