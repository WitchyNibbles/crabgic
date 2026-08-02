/**
 * Unit tests for the `ci-run` citation resolver.
 *
 * `check-criteria-closeout.mjs` is offline, so the strongest thing it can say
 * about a `ci-run` citation is that it NAMES a run in this repository. An
 * adversarial review showed that is not enough: a wholly forged `phase-13.json`
 * — real checkbox texts, so every frozen baseline hash matched, every criterion
 * `EVIDENCE-EXISTS`, every citation `job 00000000000` / `runs/1` — passed the
 * validator, the baseline `--check` and CI. This resolver is what makes a cited
 * run have to exist.
 *
 * The resolver is injected, so these tests cover the decision logic without
 * touching the network.
 */
import { describe, expect, it } from "vitest";
import { apiPathFor, auditCiRunCitations, parseActionsUrl } from "./check-citation-runs.mjs";

const RUN_URL = "https://github.com/WitchyNibbles/crabgic/actions/runs/30711622357";
const JOB_URL = "https://github.com/WitchyNibbles/crabgic/actions/jobs/91419417929";

const recordWith = (citations) => [
  {
    fileName: "phase-13.json",
    record: { criteria: [{ index: 1, citations }] },
  },
];

describe("parseActionsUrl", () => {
  it("recognises the three URL forms the committed records use", () => {
    expect(parseActionsUrl(RUN_URL)).toEqual({ kind: "run", id: "30711622357" });
    expect(parseActionsUrl(`${RUN_URL}/job/91399985018`)).toEqual({
      kind: "run",
      id: "30711622357",
    });
    expect(parseActionsUrl(JOB_URL)).toEqual({ kind: "job", id: "91419417929" });
  });

  it("refuses another repository's Actions URL", () => {
    expect(parseActionsUrl("https://github.com/someone/else/actions/runs/1")).toBeUndefined();
  });

  it("maps each form to the right API endpoint", () => {
    expect(apiPathFor({ kind: "run", id: "7" })).toBe(
      "/repos/WitchyNibbles/crabgic/actions/runs/7",
    );
    expect(apiPathFor({ kind: "job", id: "7" })).toBe(
      "/repos/WitchyNibbles/crabgic/actions/jobs/7",
    );
  });
});

describe("auditCiRunCitations", () => {
  const found = async () => ({ found: true });
  const missing = async () => ({ found: false });

  it("accepts a citation whose run resolves", async () => {
    const { errors, checked } = await auditCiRunCitations(
      recordWith([{ kind: "ci-run", url: RUN_URL }]),
      found,
    );
    expect(errors).toEqual([]);
    expect(checked).toBe(1);
  });

  /** The forged phase-13 closeout, exactly as the reviewer built it. */
  it("rejects the fabricated `runs/1` citation the forged closeout used", async () => {
    const { errors } = await auditCiRunCitations(
      recordWith([
        {
          kind: "ci-run",
          ref: "CI / unit-test, job 00000000000",
          url: RUN_URL.replace(/\d+$/, "1"),
        },
      ]),
      missing,
    );
    expect(errors.join("\n")).toContain("does not exist");
  });

  /**
   * The asymmetry is the design: only a definitive negative fails. An API blip
   * must not red an honest PR, and it cannot be turned into a bypass, because
   * an attacker cannot make the API return 404-shaped success.
   */
  it("warns rather than failing when the API cannot be asked", async () => {
    const { errors, warnings } = await auditCiRunCitations(
      recordWith([{ kind: "ci-run", url: RUN_URL }]),
      async () => ({ found: false, unavailable: "HTTP 503" }),
    );
    expect(errors).toEqual([]);
    expect(warnings.join("\n")).toContain("503");
  });

  it("resolves each distinct run once, however many criteria cite it", async () => {
    const calls = [];
    await auditCiRunCitations(
      [
        {
          fileName: "phase-03.json",
          record: {
            criteria: [
              { index: 1, citations: [{ kind: "ci-run", url: RUN_URL }] },
              { index: 2, citations: [{ kind: "ci-run", url: RUN_URL }] },
              { index: 3, citations: [{ kind: "ci-run", url: JOB_URL }] },
            ],
          },
        },
      ],
      async (target) => {
        calls.push(`${target.kind}:${target.id}`);
        return { found: true };
      },
    );
    expect(calls).toEqual(["run:30711622357", "job:91419417929"]);
  });

  it("ignores non-ci-run citations and leaves malformed urls to the offline validator", async () => {
    const { errors, checked } = await auditCiRunCitations(
      recordWith([
        { kind: "test", ref: "packages/x/y.test.ts:1" },
        { kind: "ci-run", url: "https://example.invalid/whatever" },
      ]),
      missing,
    );
    expect(errors).toEqual([]);
    expect(checked).toBe(0);
  });

  it("does not require a run to have SUCCEEDED — phase 01 cites red runs as evidence a gate bites", async () => {
    const { errors } = await auditCiRunCitations(
      recordWith([{ kind: "ci-run", url: RUN_URL }]),
      async () => ({ found: true, conclusion: "failure" }),
    );
    expect(errors).toEqual([]);
  });
});
