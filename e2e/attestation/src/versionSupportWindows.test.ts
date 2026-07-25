import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  REQUIRED_SUPPORT_WINDOW_TARGETS,
  checkVersionSupportWindows,
  readVersionSupportWindowsInput,
  type SupportWindowRecord,
} from "./versionSupportWindows.js";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const CUT = "2026-07-25";

function record(overrides: Partial<SupportWindowRecord> = {}): SupportWindowRecord {
  return {
    target: "grafana-11.6",
    pinnedVersion: "11.6.0",
    lifecycle: "versioned",
    supportEndsOn: "2027-06-01",
    confirmedOn: "2026-07-20",
    source: "https://vendor.example/support-policy",
    tagPublished: true,
    ...overrides,
  };
}

/** One fresh, in-window, published record per required target — the passing baseline. */
function allTargetsFresh(): SupportWindowRecord[] {
  return REQUIRED_SUPPORT_WINDOW_TARGETS.map((target) => record({ target }));
}

describe("checkVersionSupportWindows — PASS", () => {
  it("passes when every target is fresh, in-window, and published", () => {
    const result = checkVersionSupportWindows({
      releaseCutDate: CUT,
      records: allTargetsFresh(),
      requiredTargets: REQUIRED_SUPPORT_WINDOW_TARGETS,
    });
    expect(result.verdict).toBe("PASS");
    expect(result.details).toHaveLength(REQUIRED_SUPPORT_WINDOW_TARGETS.length);
  });
});

describe("checkVersionSupportWindows — seeded defects each FAIL", () => {
  it("FAILs when no record exists at all", () => {
    const result = checkVersionSupportWindows({
      releaseCutDate: CUT,
      records: [],
      requiredTargets: REQUIRED_SUPPORT_WINDOW_TARGETS,
    });
    expect(result.verdict).toBe("FAIL");
    expect(result.reasons).toHaveLength(REQUIRED_SUPPORT_WINDOW_TARGETS.length);
  });

  it("FAILs when one target is uncovered", () => {
    const records = allTargetsFresh().filter((entry) => entry.target !== "jira-dc-11.3");
    const result = checkVersionSupportWindows({
      releaseCutDate: CUT,
      records,
      requiredTargets: REQUIRED_SUPPORT_WINDOW_TARGETS,
    });
    expect(result.verdict).toBe("FAIL");
    expect(result.reasons.join(" ")).toContain("jira-dc-11.3: no vendor support-window");
  });

  it("FAILs on a stale re-confirmation — 'current at release time' is a freshness claim", () => {
    const result = checkVersionSupportWindows({
      releaseCutDate: CUT,
      records: [record({ confirmedOn: "2026-01-01" })],
      requiredTargets: ["grafana-11.6"],
    });
    expect(result.verdict).toBe("FAIL");
    expect(result.reasons.join(" ")).toContain("days stale at the release cut");
  });

  it("FAILs on a re-confirmation dated after the release cut", () => {
    const result = checkVersionSupportWindows({
      releaseCutDate: CUT,
      records: [record({ confirmedOn: "2026-08-01" })],
      requiredTargets: ["grafana-11.6"],
    });
    expect(result.verdict).toBe("FAIL");
    expect(result.reasons.join(" ")).toContain("AFTER the release cut");
  });

  /**
   * The defect the old `status: "supported"` enum could not express: a
   * record can be freshly confirmed and still describe a version whose
   * vendor support has already lapsed.
   */
  it("FAILs when the support window ended on or before the release cut", () => {
    const result = checkVersionSupportWindows({
      releaseCutDate: CUT,
      records: [record({ supportEndsOn: "2026-07-01" })],
      requiredTargets: ["grafana-11.6"],
    });
    expect(result.verdict).toBe("FAIL");
    expect(result.reasons.join(" ")).toContain("shipping an out-of-support version");
  });

  it("still FAILs on a lapsed window with a refresh recorded, but drops the refresh complaint", () => {
    const result = checkVersionSupportWindows({
      releaseCutDate: CUT,
      records: [record({ supportEndsOn: "2026-07-01", fixtureRefresh: "moved to 12.4 fixtures" })],
      requiredTargets: ["grafana-11.6"],
    });
    expect(result.verdict).toBe("FAIL");
    expect(result.reasons.join(" ")).not.toContain("no fixture refresh is recorded");
  });

  /** The known-open Grafana OSS 13.1 case: recipe pinned to a tag the vendor never published. */
  it("FAILs when the pinned artifact is unpublished and no follow-up is recorded", () => {
    const result = checkVersionSupportWindows({
      releaseCutDate: CUT,
      records: [record({ target: "grafana-13.1", pinnedVersion: "13.1.0", tagPublished: false })],
      requiredTargets: ["grafana-13.1"],
    });
    expect(result.verdict).toBe("FAIL");
    expect(result.reasons.join(" ")).toContain("NOT published by the vendor");
  });

  it("accepts an unpublished artifact once the follow-up is explicitly recorded", () => {
    const result = checkVersionSupportWindows({
      releaseCutDate: CUT,
      records: [
        record({
          target: "grafana-13.1",
          pinnedVersion: "13.1.0",
          tagPublished: false,
          fixtureRefresh: "vendor has not published OSS 13.1; enterprise recipe used, tracked",
        }),
      ],
      requiredTargets: ["grafana-13.1"],
    });
    expect(result.verdict).toBe("PASS");
  });

  /**
   * A hosted service has no per-version EOL to confirm. Forcing a date onto
   * it would mean inventing one, so the window rule is skipped — but
   * freshness and sourcing still apply.
   */
  it("exempts a continuously-supported hosted service from the window rule", () => {
    const result = checkVersionSupportWindows({
      releaseCutDate: CUT,
      records: [
        {
          target: "grafana-cloud",
          pinnedVersion: "cloud",
          lifecycle: "continuous",
          confirmedOn: "2026-07-20",
          source: "https://grafana.com/docs/grafana-cloud/",
          tagPublished: true,
        },
      ],
      requiredTargets: ["grafana-cloud"],
    });
    expect(result.verdict).toBe("PASS");
    expect(result.details.join(" ")).toContain("continuously supported");
  });

  it("still applies freshness to a continuously-supported service", () => {
    const result = checkVersionSupportWindows({
      releaseCutDate: CUT,
      records: [
        {
          target: "grafana-cloud",
          pinnedVersion: "cloud",
          lifecycle: "continuous",
          confirmedOn: "2025-01-01",
          source: "https://grafana.com/docs/grafana-cloud/",
          tagPublished: true,
        },
      ],
      requiredTargets: ["grafana-cloud"],
    });
    expect(result.verdict).toBe("FAIL");
    expect(result.reasons.join(" ")).toContain("days stale");
  });

  it("honours a caller-supplied freshness window", () => {
    const stale = { releaseCutDate: CUT, records: [record({ confirmedOn: "2026-07-01" })] };
    expect(
      checkVersionSupportWindows({ ...stale, requiredTargets: ["grafana-11.6"], maxAgeDays: 60 })
        .verdict,
    ).toBe("PASS");
    expect(
      checkVersionSupportWindows({ ...stale, requiredTargets: ["grafana-11.6"], maxAgeDays: 5 })
        .verdict,
    ).toBe("FAIL");
  });
});

describe("readVersionSupportWindowsInput — against the real repository", () => {
  it("reads whatever record file exists and carries the required target list", () => {
    const input = readVersionSupportWindowsInput(REPO_ROOT, CUT);
    expect(input.releaseCutDate).toBe(CUT);
    expect(input.requiredTargets).toEqual(REQUIRED_SUPPORT_WINDOW_TARGETS);
    expect(Array.isArray(input.records)).toBe(true);
  });
});
