import { readFileSync } from "node:fs";
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
    // Wording updated 2026-08-07 with the provenance reword. The SUBJECT is
    // unchanged — a stale record is still an unconditional FAIL at a cut — and
    // the assertion now names the arithmetic (days, limit) rather than a phrase
    // that could survive the check being gutted.
    expect(result.reasons.join(" ")).toContain("PROBE last ran 205 days before the release cut");
    expect(result.reasons.join(" ")).toContain("limit 30 days");
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
    expect(result.reasons.join(" ")).toContain("PROBE last ran 570 days before the release cut");
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

/**
 * The retirement of Grafana 11.6, pinned so it cannot silently come back.
 *
 * 11.6 left vendor support on 2026-06-25 — a month before this cut — and was
 * withdrawn from the supported matrix rather than waived (roadmap/23:134,
 * "fixtures refreshed if vendor support windows moved"). These assertions run
 * against the REAL committed artifacts, so a target re-added to one list but
 * not the other, or a matrix row reinstated, goes red here rather than at a
 * release cut.
 */
describe("Grafana 11.6 is retired, consistently, across every artifact that names targets", () => {
  const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

  it("is not a required support-window target", () => {
    expect(REQUIRED_SUPPORT_WINDOW_TARGETS).not.toContain("grafana-11.6");
  });

  it("keeps the two targets that ARE still in vendor support", () => {
    expect(REQUIRED_SUPPORT_WINDOW_TARGETS).toContain("grafana-12.4");
    expect(REQUIRED_SUPPORT_WINDOW_TARGETS).toContain("grafana-13.1");
  });

  it("is absent from the attested vendor-support policy and the probe's own output", () => {
    for (const relative of [
      "docs/vendor-support-policy.json",
      "docs/evidence/phase-23/vendor-support-windows.json",
    ]) {
      const entries = JSON.parse(readFileSync(join(REPO, relative), "utf-8")) as {
        target: string;
      }[];
      expect(entries.map((entry) => entry.target)).not.toContain("grafana-11.6");
    }
  });

  it("no longer appears as a supported row in the compatibility matrix", () => {
    const matrix = readFileSync(join(REPO, "docs", "compatibility-matrix.md"), "utf-8");
    expect(matrix).not.toMatch(/^\| Grafana (OSS|Enterprise) \*\*11\.6\*\*/m);
    // ...but the withdrawal is stated, never silent.
    expect(matrix).toContain("RETIRED from the supported matrix");
  });

  it("is not what the containerized traceability binding boots", () => {
    const binding = readFileSync(
      join(REPO, "e2e", "attestation", "src", "requirementTraceabilityBinding.live.test.ts"),
      "utf-8",
    );
    expect(binding).not.toContain("docker/grafana/11.6/");
    expect(binding).toContain("docker/grafana/12.4/docker-compose.yml");
  });

  it("pins the binding's image to the exact tag its compose file pins, so the two cannot drift", () => {
    const binding = readFileSync(
      join(REPO, "e2e", "attestation", "src", "requirementTraceabilityBinding.live.test.ts"),
      "utf-8",
    );
    const compose = readFileSync(
      join(REPO, "docker", "grafana", "12.4", "docker-compose.yml"),
      "utf-8",
    );
    const composeImage = /image:\s*(\S+)/.exec(compose)?.[1];
    expect(composeImage).toBeDefined();
    expect(binding).toContain(`CONTAINER_IMAGE = "${composeImage ?? ""}"`);
  });
});
