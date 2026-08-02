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
    // The `/job/<jid>` form hits the RUN endpoint, and carries the job id
    // along so it can be resolved separately — see the provenance suite.
    expect(parseActionsUrl(`${RUN_URL}/job/91399985018`)).toEqual({
      kind: "run",
      id: "30711622357",
      jobId: "91399985018",
    });
    expect(parseActionsUrl(JOB_URL)).toEqual({
      kind: "job",
      id: "91419417929",
      jobId: undefined,
    });
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

  /**
   * Adversarial-review finding, round 7 (optional 1). With a bad token or an
   * unreachable API every citation warns and the script printed
   * "PASS — N resolve, N unresolvable". A dead check reporting PASS is the
   * exact failure mode this whole effort exists to prevent, so verifying
   * NOTHING is now its own outcome rather than a pass with footnotes.
   */
  it("reports that it verified nothing when every citation was unresolvable", async () => {
    const { errors, warnings, checked, verified } = await auditCiRunCitations(
      recordWith([{ kind: "ci-run", url: RUN_URL }]),
      async () => ({ found: false, unavailable: "HTTP 401" }),
    );
    expect(errors).toEqual([]);
    expect(warnings).toHaveLength(1);
    expect(checked).toBe(1);
    expect(verified).toBe(0);
  });

  it("counts how many citations it actually verified", async () => {
    const { checked, verified } = await auditCiRunCitations(
      [
        {
          fileName: "phase-03.json",
          record: {
            criteria: [
              { index: 1, citations: [{ kind: "ci-run", url: RUN_URL }] },
              { index: 2, citations: [{ kind: "ci-run", url: JOB_URL }] },
            ],
          },
        },
      ],
      async (t) => (t.kind === "run" ? { found: true } : { found: false, unavailable: "HTTP 502" }),
    );
    expect(checked).toBe(2);
    expect(verified).toBe(1);
  });

  it("does not require a run to have SUCCEEDED — phase 01 cites red runs as evidence a gate bites", async () => {
    const { errors } = await auditCiRunCitations(
      recordWith([{ kind: "ci-run", url: RUN_URL }]),
      async () => ({ found: true, conclusion: "failure" }),
    );
    expect(errors).toEqual([]);
  });
});

/**
 * Adversarial-review finding, round 8 (bypass 17b), demonstrated live.
 * Existence was the ONLY thing this check proved. A reviewer repointed phase
 * 01's criterion 1 at run **30250453824** — a months-old `release-e2e` run,
 * wrong workflow, wrong commit, predating the criterion — set `commit` to the
 * null object id, and fabricated the `quotedAssertion`. The offline validator
 * returned zero errors and this check would have passed too: the run is real,
 * so the 404 probe is satisfied, and nothing anywhere read `commit`.
 *
 * Both `/actions/runs/<id>` and `/actions/jobs/<id>` carry `head_sha`, and jobs
 * additionally carry `workflow_name`, so both halves of the provenance a
 * citation claims are checkable with the request this check already makes.
 *
 * The asymmetry is preserved exactly: a MISMATCH is definite and fails, while
 * an API response that simply does not carry the field warns — an attacker
 * cannot make the API return a matching `head_sha` for a run that ran
 * elsewhere.
 */
describe("auditCiRunCitations — a cited run's provenance", () => {
  /** The decoy the reviewer used, and the commit it really ran at. */
  const DECOY_URL = "https://github.com/WitchyNibbles/crabgic/actions/runs/30250453824";
  const DECOY_SHA = "dbb83fd7e7b05ad4e7c3ed11b53534125d7dd105";
  const REAL_SHA = "4f2b33bbf68f517643a8d4f8eb5f85c793e99e3f";

  const ciRun = (extra) => ({
    kind: "ci-run",
    ref: "CI / unit-test+coverage (ubuntu-latest), job 91399985018",
    url: RUN_URL,
    commit: REAL_SHA,
    ...extra,
  });

  it("rejects the live demonstration: a real run cited at a commit it never ran", async () => {
    const { errors } = await auditCiRunCitations(
      recordWith([ciRun({ url: DECOY_URL, commit: "0".repeat(40) })]),
      async () => ({ found: true, headSha: DECOY_SHA, workflowName: "release-e2e" }),
    );
    expect(errors.join("\n")).toContain("ran at");
    expect(errors.join("\n")).toContain(DECOY_SHA);
  });

  /**
   * Caught by sweeping this change over the open closeout PRs before pushing
   * it: phase 17's criterion 2 cites two runs of the SAME workflow and labels
   * them `BUILD 1 — CI / unit-test+coverage (…)` / `BUILD 2 — CI / …`. The
   * first formulation of this check read everything before the first ` / ` as
   * the workflow name and failed both — an honest record, a wrong rule. What
   * the check is actually for is that the citation identifies the workflow of
   * the run it resolves to, and that ref does: the token immediately before the
   * first ` / ` is `CI`.
   */
  it("accepts a labelled lead, as phase 17 writes it to distinguish two runs of one workflow", async () => {
    const { errors } = await auditCiRunCitations(
      recordWith([
        ciRun({ ref: "BUILD 1 — CI / unit-test+coverage (ubuntu-latest), job 91479495615" }),
      ]),
      async () => ({ found: true, headSha: REAL_SHA, workflowName: "CI" }),
    );
    expect(errors).toEqual([]);
  });

  /**
   * And the label must not become a smuggling channel: it is the token
   * IMMEDIATELY before the first ` / ` that has to be the workflow, so merely
   * mentioning the right workflow somewhere in the lead is not enough.
   */
  it("does not let a label mention the workflow while naming a different one", async () => {
    const { errors } = await auditCiRunCitations(
      recordWith([ciRun({ ref: "CI — release-e2e / smoke, job 1" })]),
      async () => ({ found: true, headSha: REAL_SHA, workflowName: "CI" }),
    );
    expect(errors.join("\n")).toContain("workflow");
  });

  it("rejects a citation whose ref names a workflow the run is not", async () => {
    const { errors } = await auditCiRunCitations(
      recordWith([ciRun({ url: DECOY_URL, commit: DECOY_SHA })]),
      async () => ({ found: true, headSha: DECOY_SHA, workflowName: "release-e2e" }),
    );
    expect(errors.join("\n")).toContain("release-e2e");
    expect(errors.join("\n")).toContain("workflow");
  });

  it("accepts a citation whose commit and workflow both match the run", async () => {
    const { errors, commitsVerified } = await auditCiRunCitations(
      recordWith([ciRun()]),
      async () => ({ found: true, headSha: REAL_SHA, workflowName: "CI" }),
    );
    expect(errors).toEqual([]);
    expect(commitsVerified).toBe(1);
  });

  it("accepts the abbreviated commit phase 08 records, as a prefix of head_sha", async () => {
    const { errors, commitsVerified } = await auditCiRunCitations(
      recordWith([ciRun({ commit: "d11b0594" })]),
      async () => ({ found: true, headSha: "d11b05944a0b6e96dda8b468d93234dbb0e93100" }),
    );
    expect(errors).toEqual([]);
    expect(commitsVerified).toBe(1);
  });

  it("compares object ids case-insensitively rather than failing an honest record", async () => {
    const { errors } = await auditCiRunCitations(
      recordWith([ciRun({ commit: REAL_SHA.toUpperCase() })]),
      async () => ({ found: true, headSha: REAL_SHA, workflowName: "CI" }),
    );
    expect(errors).toEqual([]);
  });

  /** "Could not ask" stays a warning — the API not carrying the field is not a mismatch. */
  it("warns rather than failing when the API returned no head_sha", async () => {
    const { errors, warnings, verified, commitsChecked, commitsVerified } =
      await auditCiRunCitations(recordWith([ciRun()]), async () => ({ found: true }));
    expect(errors).toEqual([]);
    expect(warnings.join("\n")).toContain("head_sha");
    expect(verified).toBe(1);
    expect(commitsChecked).toBe(1);
    expect(commitsVerified).toBe(0);
  });

  /**
   * The dead-check guard, extended. `checked > 0 && verified === 0` catches
   * existence-probing that has silently stopped working; the commit half needs
   * its own counters or it could stop working under a green PASS line.
   */
  it("counts the commit comparisons separately, so a dead commit check is visible", async () => {
    const { commitsChecked, commitsVerified } = await auditCiRunCitations(
      [
        {
          fileName: "phase-03.json",
          record: {
            criteria: [
              { index: 1, citations: [ciRun()] },
              { index: 2, citations: [ciRun({ url: JOB_URL, commit: "abcdef1" })] },
            ],
          },
        },
      ],
      async (t) =>
        t.kind === "run" ? { found: true, headSha: REAL_SHA } : { found: true, headSha: undefined },
    );
    expect(commitsChecked).toBe(2);
    expect(commitsVerified).toBe(1);
  });

  it("does not count a commit comparison it never got to make", async () => {
    const { commitsChecked } = await auditCiRunCitations(recordWith([ciRun()]), async () => ({
      found: false,
      unavailable: "HTTP 503",
    }));
    expect(commitsChecked).toBe(0);
  });

  /**
   * Adversarial-review finding, round 8 (bypass 22, minor sibling).
   * `parseActionsUrl` discarded the `/job/<jid>` suffix, so a FABRICATED job id
   * pinned under a real run URL was never resolved — the run existed, the
   * head_sha matched, and the job number was free text. Zero merged citations
   * use that URL form, so checking it costs nothing today and stops the next
   * one being written with an invented job.
   */
  it("carries the job id out of the /runs/<rid>/job/<jid> form", () => {
    expect(parseActionsUrl(`${RUN_URL}/job/91399985018`)).toEqual({
      kind: "run",
      id: "30711622357",
      jobId: "91399985018",
    });
    expect(parseActionsUrl(RUN_URL).jobId).toBeUndefined();
  });

  it("rejects a fabricated job id pinned under a real run", async () => {
    const { errors } = await auditCiRunCitations(
      recordWith([ciRun({ url: `${RUN_URL}/job/00000000000` })]),
      async (t) =>
        t.kind === "run"
          ? { found: true, headSha: REAL_SHA, workflowName: "CI" }
          : { found: false },
    );
    expect(errors.join("\n")).toContain("00000000000");
  });

  it("rejects a real job that belongs to a DIFFERENT run", async () => {
    const { errors } = await auditCiRunCitations(
      recordWith([ciRun({ url: `${RUN_URL}/job/91399985018` })]),
      async (t) =>
        t.kind === "run"
          ? { found: true, headSha: REAL_SHA, workflowName: "CI" }
          : { found: true, runId: "30250453824" },
    );
    expect(errors.join("\n")).toContain("30250453824");
  });

  it("accepts a job that really belongs to the run it is pinned under", async () => {
    const { errors } = await auditCiRunCitations(
      recordWith([ciRun({ url: `${RUN_URL}/job/91399985018` })]),
      async (t) =>
        t.kind === "run"
          ? { found: true, headSha: REAL_SHA, workflowName: "CI" }
          : { found: true, runId: "30711622357" },
    );
    expect(errors).toEqual([]);
  });

  it("warns rather than failing when the job endpoint cannot be asked", async () => {
    const { errors, warnings } = await auditCiRunCitations(
      recordWith([ciRun({ url: `${RUN_URL}/job/91399985018` })]),
      async (t) =>
        t.kind === "run"
          ? { found: true, headSha: REAL_SHA, workflowName: "CI" }
          : { found: false, unavailable: "HTTP 502" },
    );
    expect(errors).toEqual([]);
    expect(warnings.join("\n")).toContain("502");
  });

  it("still does not require a run to have SUCCEEDED", async () => {
    const { errors } = await auditCiRunCitations(recordWith([ciRun()]), async () => ({
      found: true,
      headSha: REAL_SHA,
      workflowName: "CI",
      conclusion: "failure",
    }));
    expect(errors).toEqual([]);
  });
});
