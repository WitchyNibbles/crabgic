/**
 * Unit tests for the vendor-support-window advance-warning lane and its
 * auto-renewal tripwire.
 *
 * TWO SEPARATE SUBJECTS, and they fail for different reasons.
 *
 * 1. THE ADVANCE WARNING. `e2e/attestation`'s `checkVersionSupportWindows`
 *    refuses a release once the committed record is more than 30 days old, or
 *    once a vendor window has closed. It runs in NO per-push channel — its only
 *    invocation is in a suite that runs solely under
 *    `npm run test:e2e:release-evidence`, which `publish.yml` blocks on at a
 *    `v*` tag. So the first anyone would learn of an expired bound is inside a
 *    tag-triggered publish. These tests pin a lane that says so 21 days early,
 *    naming the exact date each target turns red.
 *
 * 2. THE AUTO-RENEWAL TRIPWIRE, which is the durable half. The bound is worth
 *    something only while refreshing it is a deliberate, reviewable act.
 *    `drift-ci.yml` runs the probe weekly and uploads the rewritten record as an
 *    ARTIFACT; the release gate reads the COMMITTED file. Nothing pinned that
 *    distinction, and one `git commit` step would make the gate renew its own
 *    input forever. The owner accepted probe-based confirmation (2026-08-07) and
 *    explicitly did NOT accept auto-renewal; this is where that line is drawn.
 *
 * EVERY DATE IS INJECTED. Nothing here reads the wall clock, so no assertion
 * quietly changes meaning tomorrow — and, pointedly, none of them stops meaning
 * anything the day the record is re-stamped.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  addDays,
  assessSupportWindows,
  assessTarget,
  daysBetween,
  MAX_RECORD_AGE_DAYS,
  readCommittedRecords,
  readWorkflows,
  REQUIRED_SUPPORT_WINDOW_TARGETS,
  runSupportWindowFreshnessCheck,
  scanWorkflowsForAutoRenewal,
  SUPPORT_WINDOW_RECORD_PATH,
  WARN_LEAD_DAYS,
} from "./check-support-window-freshness.mjs";

const REPO_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const VERSION_SUPPORT_WINDOWS_SOURCE = readFileSync(
  path.join(REPO_ROOT, "e2e/attestation/src/versionSupportWindows.ts"),
  "utf8",
);

/** The shape the record file carries, at the date it carried on 2026-08-04. */
function record(overrides = {}) {
  return {
    target: "jira-dc-10.3",
    pinnedVersion: "10.3",
    lifecycle: "versioned",
    supportEndsOn: "2026-12-05",
    confirmedOn: "2026-07-25",
    source: "https://example.invalid/policy",
    tagPublished: true,
    ...overrides,
  };
}

const levels = (assessment) => assessment.findings.map((f) => f.level);

afterEach(() => vi.restoreAllMocks());

describe("the freshness bound — the arm that goes red at a release cut", () => {
  it("crosses the threshold on the first day the release gate would refuse a cut", () => {
    // RED-FIRST. Written against the real committed date (2026-07-25) and the
    // real limit (30) before the check existed: the gate fails at `age > 30`, so
    // the first blocked day is 2026-08-25.
    expect(assessTarget(record(), "2026-08-25").staleOn).toBe("2026-08-25");
    // AT RELEASE the threshold is a FAIL...
    expect(assessTarget(record(), "2026-08-25", { enforceStaleness: true }).findings).toEqual([
      expect.objectContaining({ level: "fail" }),
    ]);
    // ...and PER-PUSH it is a WARN. See the ruling in the module header: a
    // stale probe stamp bars shipping, not merging.
    expect(assessTarget(record(), "2026-08-25").findings).toEqual([
      expect.objectContaining({ level: "warn" }),
    ]);
  });

  it("says, in the message itself, that a stale stamp does not block the push", () => {
    // The consequence has to be legible to whoever reads the annotation, not
    // only to whoever reads this file.
    const [warned] = assessTarget(record(), "2026-08-25").findings;
    expect(warned.message).toContain("RELEASE CUT HAS BEEN BLOCKED SINCE 2026-08-25");
    expect(warned.message).toContain("does NOT block your push");
    // ...and the release-cut caller must NOT carry that reassurance.
    const [failed] = assessTarget(record(), "2026-08-25", { enforceStaleness: true }).findings;
    expect(failed.message).not.toContain("does NOT block your push");
  });

  it("does NOT cross it one day earlier — the control that rules out 'fires every day'", () => {
    // `docs/verification-playbook.md:400-403`. Without this, a check that fired
    // unconditionally would satisfy the assertion above just as well. Asserted
    // in the AT-RELEASE mode, where the threshold is a fail, so the control is
    // about the threshold rather than about the level.
    const assessed = assessTarget(record(), "2026-08-24", { enforceStaleness: true });
    expect(assessed.findings.some((f) => f.level === "fail")).toBe(false);
    expect(daysBetween("2026-07-25", "2026-08-24")).toBe(30);
  });

  it("NEVER fails per-push on staleness alone, however stale — the anti-brick control", () => {
    // THE POINT OF THE SPLIT. Before the ruling this arm failed per-push in a
    // required `meta-checks` step, so from the 31st day every PR in the
    // repository would have gone red until a human ran the probe. A 30-day
    // clock must not be able to brick the repository for work unrelated to
    // releasing. Measured a year out, not just a day past the bound.
    for (const day of ["2026-08-25", "2026-09-30", "2027-08-07"]) {
      const assessed = assessTarget(record({ supportEndsOn: "2099-01-01" }), day);
      expect(
        assessed.findings.map((f) => f.level),
        day,
      ).toEqual(["warn"]);
    }
  });

  it("warns from exactly T-21, and not the day before that", () => {
    // The lead window is the whole product of this lane, so its edge is pinned
    // in both directions rather than only the side that fires.
    const firstWarnDay = addDays("2026-07-25", MAX_RECORD_AGE_DAYS - WARN_LEAD_DAYS + 1);
    expect(firstWarnDay).toBe("2026-08-04");
    expect(assessTarget(record(), firstWarnDay).findings.some((f) => f.level === "warn")).toBe(
      true,
    );
    expect(assessTarget(record(), "2026-08-03").findings).toEqual([]);
  });

  it("computes the first warning day, not just the first blocked day", () => {
    // A committed transcript in the first version of this PR claimed the warn
    // day was `confirmedOn + 21`. It is not: the arm fires at
    // `age > maxAgeDays - leadDays`, i.e. `staleOn - leadDays`. Eleven days
    // apart on the real record. Both are now computed AND printed.
    const assessed = assessTarget(record(), "2026-08-07");
    expect(assessed.warnFrom).toBe("2026-08-04");
    expect(assessed.staleOn).toBe("2026-08-25");
    expect(daysBetween(assessed.warnFrom, assessed.staleOn)).toBe(WARN_LEAD_DAYS);
  });

  it("names the exact date the gate turns red, in the warning text", () => {
    // A warning that says "soon" is not actionable. This is what the annotation
    // has to carry for the lane to be worth having.
    const [warning] = assessTarget(record(), "2026-08-07").findings;
    expect(warning.level).toBe("warn");
    expect(warning.message).toContain("2026-08-25");
    expect(warning.message).toContain("jira-dc-10.3");
    expect(warning.message).toContain("probe:support-windows");
  });

  it("FAILS a record dated in the future rather than reporting it as very fresh", () => {
    expect(assessTarget(record({ confirmedOn: "2026-09-01" }), "2026-08-07").findings).toEqual([
      expect.objectContaining({ level: "fail" }),
    ]);
  });
});

describe("the vendor window itself", () => {
  it("FAILS the day after a real vendor support-end date", () => {
    // jira-dc-10.3's genuine window, from the committed record.
    const assessed = assessTarget(record({ confirmedOn: "2026-12-01" }), "2026-12-06");
    expect(assessed.findings).toEqual([
      expect.objectContaining({
        level: "fail",
        message: expect.stringContaining("ENDED 2026-12-05"),
      }),
    ]);
  });

  it("does NOT fail on the day before it — the control for the expiry arm", () => {
    const assessed = assessTarget(record({ confirmedOn: "2026-12-01" }), "2026-12-04");
    expect(assessed.findings.some((f) => f.level === "fail")).toBe(false);
  });

  it("warns inside the 90-day run-up, naming the date and the days left", () => {
    const assessed = assessTarget(record({ confirmedOn: "2026-10-01" }), "2026-10-05");
    expect(assessed.findings).toEqual([
      expect.objectContaining({
        level: "warn",
        message: expect.stringContaining("ends 2026-12-05"),
      }),
    ]);
  });

  it("exempts a continuous target from the window rule but NOT from freshness", () => {
    const cloud = record({
      target: "jira-cloud",
      lifecycle: "continuous",
      supportEndsOn: undefined,
    });
    expect(assessTarget(cloud, "2026-08-03").findings).toEqual([]);
    // Freshness still applies to a hosted target — as a warn per-push...
    expect(assessTarget(cloud, "2026-08-25").findings).toEqual([
      expect.objectContaining({ level: "warn" }),
    ]);
    // ...and as a fail at a release cut.
    expect(assessTarget(cloud, "2026-08-25", { enforceStaleness: true }).findings).toEqual([
      expect.objectContaining({ level: "fail" }),
    ]);
  });

  it("FAILS a versioned target carrying no support-end date at all", () => {
    const assessed = assessTarget(record({ supportEndsOn: undefined }), "2026-08-03");
    expect(assessed.findings).toEqual([
      expect.objectContaining({ message: expect.stringContaining("no vendor support-end date") }),
    ]);
  });
});

describe("coverage — a target cannot be deleted to silence its warning", () => {
  it("FAILS a required target with no record, rather than skipping it", () => {
    const assessment = assessSupportWindows({
      records: [
        record({ target: "jira-cloud", lifecycle: "continuous", supportEndsOn: undefined }),
      ],
      today: "2026-08-03",
    });
    expect(assessment.level).toBe("fail");
    expect(assessment.findings).toHaveLength(REQUIRED_SUPPORT_WINDOW_TARGETS.length - 1);
  });
});

describe("this lane is calibrated against the gate it warns about", () => {
  it("uses the same 30-day limit the release gate uses", () => {
    // Bound by reading the real source, because `e2e/attestation` is a
    // self-contained TypeScript project this script cannot import. A warning
    // lane calibrated against a different limit than its gate is worse than no
    // lane at all.
    const match = /DEFAULT_MAX_RECORD_AGE_DAYS = (\d+);/.exec(VERSION_SUPPORT_WINDOWS_SOURCE);
    expect(match?.[1]).toBeDefined();
    expect(Number(match[1])).toBe(MAX_RECORD_AGE_DAYS);
  });

  it("requires the same target set the release gate requires", () => {
    const block = /REQUIRED_SUPPORT_WINDOW_TARGETS = \[([\s\S]*?)\] as const;/.exec(
      VERSION_SUPPORT_WINDOWS_SOURCE,
    );
    const declared = [...block[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
    expect(declared).toEqual(REQUIRED_SUPPORT_WINDOW_TARGETS);
  });

  it("fails on the gate's condition, not a stricter one", () => {
    // The lane must never block a push for something no release would refuse.
    // At age exactly 30 the gate passes, so this must not fail.
    expect(
      assessTarget(record(), addDays("2026-07-25", 30)).findings.some((f) => f.level === "fail"),
    ).toBe(false);
  });
});

describe("the auto-renewal tripwire", () => {
  it("flags a workflow that BOTH runs the probe AND commits its output", () => {
    // RED-FIRST, against the real `drift-ci.yml` text with one step added — the
    // exact edit that would make the bound self-satisfying.
    const driftCi = readFileSync(path.join(REPO_ROOT, ".github/workflows/drift-ci.yml"), "utf8");
    const mutated = `${driftCi}\n      - name: Commit the refreshed record\n        run: git commit -am "chore: refresh support windows" && git push\n`;
    expect(scanWorkflowsForAutoRenewal([{ path: "drift-ci.yml", text: mutated }])).toEqual([
      { path: "drift-ci.yml", mechanisms: expect.arrayContaining(["`git commit`", "`git push`"]) },
    ]);
  });

  it("does NOT flag the real drift-ci.yml, which uploads an artifact instead", () => {
    // The control. Without it, a scanner that flagged everything would satisfy
    // the assertion above — and this is also the assertion that pins today's
    // safety, which until now was an undocumented accident of that workflow.
    const driftCi = readFileSync(path.join(REPO_ROOT, ".github/workflows/drift-ci.yml"), "utf8");
    expect(driftCi).toContain("probe:support-windows");
    expect(driftCi).toContain("upload-artifact");
    expect(scanWorkflowsForAutoRenewal([{ path: "drift-ci.yml", text: driftCi }])).toEqual([]);
  });

  it("does NOT flag a workflow that commits but never runs the probe", () => {
    // The conjunction is the rule. Plenty of workflows legitimately commit.
    expect(
      scanWorkflowsForAutoRenewal([
        { path: "release.yml", text: "steps:\n  - run: git commit -am x && git push\n" },
      ]),
    ).toEqual([]);
  });

  it("flags `contents: write` on a probe-running workflow, before any commit step exists", () => {
    // The permission alone is enough: a workflow that writes the gate's input
    // has no business holding it, and requiring that to be argued for is the
    // point.
    expect(
      scanWorkflowsForAutoRenewal([
        {
          path: "w.yml",
          text: "permissions:\n  contents: write\nsteps:\n  - run: npm run probe:support-windows\n",
        },
      ]),
    ).toEqual([{ path: "w.yml", mechanisms: ["`contents: write` permission"] }]);
  });

  it("catches the probe invoked through its CLI module rather than the npm script", () => {
    // The obvious evasion: `tsx e2e/provisioning/src/supportWindowsCli.ts`
    // bypasses a scan that only knows the npm script name.
    expect(
      scanWorkflowsForAutoRenewal([
        {
          path: "w.yml",
          text: "steps:\n  - run: npx tsx e2e/provisioning/src/supportWindowsCli.ts\n  - run: git push\n",
        },
      ]),
    ).toEqual([{ path: "w.yml", mechanisms: ["`git push`"] }]);
  });

  it("finds NO offender among the repository's real workflows", () => {
    // THE PER-PUSH BEARER for this half.
    expect(scanWorkflowsForAutoRenewal(readWorkflows(REPO_ROOT))).toEqual([]);
  });

  it("actually reads a non-trivial set of real workflows (rules out an empty-scan pass)", () => {
    const workflows = readWorkflows(REPO_ROOT);
    expect(workflows.length).toBeGreaterThan(3);
    expect(workflows.some((w) => w.path.endsWith("drift-ci.yml"))).toBe(true);
    expect(workflows.filter((w) => RUNS_PROBE_SANITY.test(w.text))).toHaveLength(1);
  });
});

const RUNS_PROBE_SANITY = /probe:support-windows|supportWindowsCli/;

describe("the REAL committed record", () => {
  const records = readCommittedRecords(REPO_ROOT);

  it("covers every required target with a well-formed entry", () => {
    expect(records.map((r) => r.target).sort()).toEqual(
      [...REQUIRED_SUPPORT_WINDOW_TARGETS].sort(),
    );
    for (const r of records) {
      expect(r.confirmedOn, r.target).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it("is inside every bound on the day it was probed", () => {
    // THE PER-PUSH BEARER for the freshness half, written so it stays true —
    // and stays MEANINGFUL — after each re-stamp: it asserts the record is
    // clean at its OWN probe date, which is a property of the record rather
    // than of the calendar.
    const probedOn = records[0].confirmedOn;
    expect(assessSupportWindows({ records, today: probedOn }).level).toBe("pass");
  });

  it("still warns, from the real record, once the lead window opens", () => {
    // Non-vacuity for the warn arm against real data rather than a fixture: at
    // T-21 from the record's own date it must warn, and the annotation must
    // name the day the gate turns red.
    const probedOn = records[0].confirmedOn;
    const inLead = addDays(probedOn, MAX_RECORD_AGE_DAYS - WARN_LEAD_DAYS + 1);
    const assessment = assessSupportWindows({ records, today: inLead });
    expect(assessment.level).toBe("warn");
    expect(levels(assessment)).toEqual(Array(REQUIRED_SUPPORT_WINDOW_TARGETS.length).fill("warn"));
    expect(assessment.findings[0].message).toContain(addDays(probedOn, MAX_RECORD_AGE_DAYS + 1));
  });

  it("goes RED from the real record on the day the release gate would — AT RELEASE", () => {
    const probedOn = records[0].confirmedOn;
    const atRelease = (today) => assessSupportWindows({ records, today, enforceStaleness: true });
    expect(atRelease(addDays(probedOn, MAX_RECORD_AGE_DAYS + 1)).level).toBe("fail");
    expect(atRelease(addDays(probedOn, MAX_RECORD_AGE_DAYS)).level).toBe("warn");
  });

  it("stays at WARN per-push on the same day — the split, on real data", () => {
    const probedOn = records[0].confirmedOn;
    expect(
      assessSupportWindows({ records, today: addDays(probedOn, MAX_RECORD_AGE_DAYS + 1) }).level,
    ).toBe("warn");
  });
});

describe("the reporting channel actually speaks", () => {
  it("emits a ::warning:: annotation and exit 0 in the warn window", () => {
    // `docs/verification-playbook.md:811-819`: silence evidences nothing until
    // the channel has been seen speaking for a value known to be interesting.
    const records = readCommittedRecords(REPO_ROOT);
    const inLead = addDays(records[0].confirmedOn, MAX_RECORD_AGE_DAYS - WARN_LEAD_DAYS + 1);
    const out = [];
    vi.spyOn(console, "log").mockImplementation((m) => out.push(String(m)));
    vi.spyOn(console, "error").mockImplementation((m) => out.push(String(m)));
    expect(runSupportWindowFreshnessCheck(REPO_ROOT, inLead)).toBe(0);
    expect(out.join("\n")).toContain("::warning::check-support-window-freshness:");
    expect(out.join("\n")).toContain("WARN —");
  });

  it("still exits 0 once the bound has expired — staleness does not block a merge", () => {
    // The CLI-level half of the anti-brick control. `meta-checks` is a required
    // check; if this returned 1 here, every PR in the repository would be red
    // from the 31st day.
    const records = readCommittedRecords(REPO_ROOT);
    const expired = addDays(records[0].confirmedOn, MAX_RECORD_AGE_DAYS + 1);
    const out = [];
    vi.spyOn(console, "log").mockImplementation((m) => out.push(String(m)));
    vi.spyOn(console, "error").mockImplementation((m) => out.push(String(m)));
    expect(runSupportWindowFreshnessCheck(REPO_ROOT, expired)).toBe(1 - 1);
    expect(out.join("\n")).toContain("RELEASE CUT HAS BEEN BLOCKED SINCE");
    expect(out.join("\n")).toContain("does NOT block your push");
  });

  it("exits 1 on the same day when the caller IS a release cut", () => {
    const records = readCommittedRecords(REPO_ROOT);
    const expired = addDays(records[0].confirmedOn, MAX_RECORD_AGE_DAYS + 1);
    const errors = [];
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation((m) => errors.push(String(m)));
    expect(runSupportWindowFreshnessCheck(REPO_ROOT, expired, { enforceStaleness: true })).toBe(1);
    expect(errors.join("\n")).toContain("RELEASE CUT HAS BEEN BLOCKED SINCE");
  });

  it("exits 1 per-push for an EXPIRED VENDOR WINDOW — the arm that blocks everywhere", () => {
    // Arm B. Unlike a stale stamp, this is a fact about what the repository
    // pins today, so it blocks a merge as well as a cut.
    const records = readCommittedRecords(REPO_ROOT).map((r) =>
      r.target === "jira-dc-10.3" ? { ...r, supportEndsOn: "2026-01-01" } : r,
    );
    const errors = [];
    vi.spyOn(console, "error").mockImplementation((m) => errors.push(String(m)));
    const assessment = assessSupportWindows({ records, today: records[0].confirmedOn });
    expect(assessment.level).toBe("fail");
    expect(assessment.findings).toEqual([
      expect.objectContaining({ message: expect.stringContaining("BLOCKS EVERYWHERE") }),
    ]);
  });

  it("prints BOTH the warn day and the blocked day, so a claim about them is checkable", () => {
    // A committed transcript claimed "both printed" while the passing branch
    // printed only the red date — and named the wrong warn day. Pinned here so
    // the prose and the program cannot diverge again.
    const records = readCommittedRecords(REPO_ROOT);
    const probedOn = records[0].confirmedOn;
    const out = [];
    vi.spyOn(console, "log").mockImplementation((m) => out.push(String(m)));
    runSupportWindowFreshnessCheck(REPO_ROOT, probedOn);
    const joined = out.join("\n");
    expect(joined).toContain(
      `warns from ${addDays(probedOn, MAX_RECORD_AGE_DAYS - WARN_LEAD_DAYS + 1)}`,
    );
    expect(joined).toContain(
      `release cut blocked from ${addDays(probedOn, MAX_RECORD_AGE_DAYS + 1)}`,
    );
  });

  it("passes quietly at the record's own probe date", () => {
    const records = readCommittedRecords(REPO_ROOT);
    const out = [];
    vi.spyOn(console, "log").mockImplementation((m) => out.push(String(m)));
    vi.spyOn(console, "error").mockImplementation((m) => out.push(String(m)));
    expect(runSupportWindowFreshnessCheck(REPO_ROOT, records[0].confirmedOn)).toBe(0);
    expect(out.join("\n")).toContain("PASS —");
    expect(out.join("\n")).not.toContain("::warning::");
  });
});

describe("the release-time half is REAL, not a promise in a comment", () => {
  /**
   * The split only holds if something still fails at a release cut. Asserting
   * that by grepping `versionSupportWindows.ts` for a `fail` branch would be a
   * textual presence check — the exact instrument class this repository has
   * been bitten by twice. So this imports the ACTUAL gate and drives records
   * through it.
   *
   * `e2e/attestation` is a self-contained TypeScript project and is not part of
   * the workspace graph, but vitest transforms the module directly, so the
   * production function is genuinely under test here rather than a copy of it.
   */
  const gate = async () => await import("../e2e/attestation/src/versionSupportWindows.ts");

  it("the release gate STILL refuses a record past the freshness bound", async () => {
    const { checkVersionSupportWindows, DEFAULT_MAX_RECORD_AGE_DAYS } = await gate();
    const records = readCommittedRecords(REPO_ROOT);
    const probedOn = records[0].confirmedOn;
    const result = checkVersionSupportWindows({
      releaseCutDate: addDays(probedOn, DEFAULT_MAX_RECORD_AGE_DAYS + 1),
      records,
      requiredTargets: REQUIRED_SUPPORT_WINDOW_TARGETS,
    });
    expect(result.reasons.length).toBeGreaterThan(0);
    expect(result.reasons.join("\n")).toContain("PROBE last ran");
  });

  it("...and does NOT refuse it one day earlier — the control", async () => {
    // Without this, a gate that refused every record would satisfy the
    // assertion above.
    const { checkVersionSupportWindows, DEFAULT_MAX_RECORD_AGE_DAYS } = await gate();
    const records = readCommittedRecords(REPO_ROOT);
    const result = checkVersionSupportWindows({
      releaseCutDate: addDays(records[0].confirmedOn, DEFAULT_MAX_RECORD_AGE_DAYS),
      records,
      requiredTargets: REQUIRED_SUPPORT_WINDOW_TARGETS,
    });
    expect(result.reasons).toEqual([]);
  });

  it("this lane and the real gate agree on the threshold, day for day", async () => {
    // The two implementations must cross at the same instant or the advance
    // warning is calibrated against a bound nothing enforces. Swept across the
    // boundary rather than sampled at it.
    const { checkVersionSupportWindows, DEFAULT_MAX_RECORD_AGE_DAYS } = await gate();
    const records = readCommittedRecords(REPO_ROOT);
    const probedOn = records[0].confirmedOn;
    for (
      let offset = DEFAULT_MAX_RECORD_AGE_DAYS - 2;
      offset <= DEFAULT_MAX_RECORD_AGE_DAYS + 2;
      offset += 1
    ) {
      const day = addDays(probedOn, offset);
      const gateRefuses =
        checkVersionSupportWindows({
          releaseCutDate: day,
          records,
          requiredTargets: REQUIRED_SUPPORT_WINDOW_TARGETS,
        }).reasons.length > 0;
      const laneFails =
        assessSupportWindows({ records, today: day, enforceStaleness: true }).level === "fail";
      expect({ day, gateRefuses }).toEqual({ day, gateRefuses: laneFails });
    }
  });
});

describe("repo wiring", () => {
  it("is reachable as `npm run check:support-windows` and chained into check:all", () => {
    const root = JSON.parse(readFileSync(path.join(REPO_ROOT, "package.json"), "utf8"));
    expect(root.scripts["check:support-windows"]).toBe(
      "node scripts/check-support-window-freshness.mjs",
    );
    expect(root.scripts["check:all"]).toContain("check:support-windows");
  });

  it("runs as a `meta-checks` step in ci.yml — the per-push channel it claims", () => {
    const workflow = readFileSync(path.join(REPO_ROOT, ".github/workflows/ci.yml"), "utf8");
    expect(workflow).toContain("npm run check:support-windows");
  });

  it("reads the COMMITTED record path, which is what the release gate reads", () => {
    // The distinction the whole tripwire rests on: the probe writes a file, the
    // gate reads the committed one. If this lane ever read the probe's fresh
    // output it would be measuring nothing.
    expect(SUPPORT_WINDOW_RECORD_PATH).toBe("docs/evidence/phase-23/vendor-support-windows.json");
    expect(VERSION_SUPPORT_WINDOWS_SOURCE).toContain(
      `VENDOR_SUPPORT_WINDOWS_RECORD_PATH =\n  "${SUPPORT_WINDOW_RECORD_PATH}"`,
    );
  });
});
