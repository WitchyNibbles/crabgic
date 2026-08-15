import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { submitLiveRound, type LiveReviewerVerdict } from "./live-round-submit.js";
import { loadFindings } from "./finding-store.js";

/**
 * The live-round harness — roadmap/25.
 *
 * Its one job is to NOT be a judge. It transcribes a reviewer's verdict into
 * `review.submit` and returns what the server said, so these tests are mostly
 * about what it must not do: not decide closure, not disposition a finding
 * nobody answered, and not let a reviewer widen its own obligation list.
 */

let home: string;
let storePath: string;

const WRITE_SET = ["packages/cli/src/review/"];

const reviewer = (overrides: Partial<LiveReviewerVerdict> = {}): LiveReviewerVerdict => ({
  lens: "security",
  verdict: "revise",
  answeredObligations: [
    "implement-gates-pass",
    "implement-task-done-criteria-met",
    "implement-tests-first",
    "no-open-debt-in-touched-paths",
  ],
  findings: [
    {
      claim: "The token comparison is not constant time.",
      paths: ["packages/cli/src/review/admissibility.ts"],
      classification: "advisory",
      evidence: { reproduction: "run it", observed: "early return", expected: "constant time" },
    },
  ],
  ...overrides,
});

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "crabgic-live-round-"));
  storePath = join(home, "state", "crabgic", "proj", "review-findings.json");
});

afterEach(async () => {
  await rm(home, { recursive: true, force: true });
});

const input = {
  stage: "implement" as const,
  round: 1,
  artifactRef: "packages/cli/src/review/admissibility.ts",
  plannedWritePaths: WRITE_SET,
  stateHome: "",
  findingStorePath: "",
};

describe("submitLiveRound", () => {
  it("returns the SERVER's closure decision, not its own", async () => {
    // The property the whole harness exists for. It contains no closure rule,
    // and `stageClosable` comes back from `runReviewSubmit`.
    const result = await submitLiveRound({
      ...input,
      stateHome: join(home, "state"),
      findingStorePath: storePath,
      reviewer: reviewer(),
    });
    expect(result.ok).toBe(true);
    expect(typeof result.stageClosable).toBe("boolean");
    // A newly raised, undispositioned finding holds the stage open. The harness
    // did not decide that -- the handler did.
    expect(result.stageClosable).toBe(false);
  });

  it("does NOT disposition a finding the caller has not answered", async () => {
    // A harness that dispositioned on the reviewer's behalf would be answering
    // the reviewer's own findings for it, and `raised -> verified -> classified
    // -> dispositioned` is a walk rather than a leap.
    const result = await submitLiveRound({
      ...input,
      stateHome: join(home, "state"),
      findingStorePath: storePath,
      reviewer: reviewer(),
    });
    expect(result.findings?.every((f) => f.disposition === undefined)).toBe(true);
  });

  it("records the disposition when the caller supplies one", async () => {
    const result = await submitLiveRound(
      {
        ...input,
        stateHome: join(home, "state"),
        findingStorePath: storePath,
        reviewer: reviewer(),
      },
      { value: "fixed", evidence: "closed by the constant-time compare" },
    );
    expect(result.findings?.every((f) => f.disposition === "fixed")).toBe(true);
  });

  it("REFUSES to let a reviewer widen its own obligation list", async () => {
    // A reviewer claiming an obligation the stage never issued is not evidence
    // of coverage. Passing its list through unfiltered would let the reviewer
    // decide what it owed an answer about.
    const result = await submitLiveRound({
      ...input,
      stateHome: join(home, "state"),
      findingStorePath: storePath,
      reviewer: reviewer({ answeredObligations: ["an-obligation-nobody-issued"] }),
    });
    expect(result.unmetCriteria?.length ?? 0).toBeGreaterThan(0);
  });

  it("persists what the server computed, not what the reviewer sent", async () => {
    // The store must hold the merged, debt-reclassified set the closure
    // decision was actually taken on.
    await submitLiveRound(
      {
        ...input,
        stateHome: join(home, "state"),
        findingStorePath: storePath,
        reviewer: reviewer(),
      },
      { value: "fixed", evidence: "closed" },
    );
    const stored = await loadFindings(storePath);
    expect(stored).toHaveLength(1);
    expect(stored[0]?.disposition).toBe("fixed");
  });

  it("defers a finding outside the write set rather than counting it", async () => {
    const result = await submitLiveRound({
      ...input,
      stateHome: join(home, "state"),
      findingStorePath: storePath,
      reviewer: reviewer({
        findings: [
          {
            claim: "Unrelated module leaks a handle.",
            paths: ["packages/journal/src/chain.ts"],
            classification: "advisory",
            evidence: { reproduction: "r", observed: "o", expected: "e" },
          },
        ],
      }),
    });
    expect(result.deferredFindings?.length).toBe(1);
  });
});
