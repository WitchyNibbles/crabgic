import { describe, expect, it } from "vitest";
import {
  SUPPORT_WINDOW_TARGETS,
  VendorSupportPolicySchema,
  buildSupportWindowRecords,
  dockerHubTagUrl,
  probeTagPublished,
  type HttpProbe,
  type VendorSupportPolicyEntry,
} from "../src/supportWindows.js";

const PROBED_ON = "2026-07-25";

/** A stub registry: every URL not listed answers 404. No network is touched. */
function stubHttp(byUrl: Readonly<Record<string, number>>): HttpProbe {
  return (url) => Promise.resolve({ status: byUrl[url] ?? 404 });
}

function policyEntry(overrides: Partial<VendorSupportPolicyEntry> = {}): VendorSupportPolicyEntry {
  return {
    target: "grafana-11.6",
    lifecycle: "versioned",
    supportEndsOn: "2027-06-01",
    source: "https://grafana.com/docs/grafana/latest/upgrade-guide/",
    ...overrides,
  };
}

const SPEC = {
  target: "grafana-11.6",
  pinnedVersion: "11.6.0",
  image: "grafana/grafana-oss",
  tag: "11.6.0",
};
const URL = dockerHubTagUrl("grafana/grafana-oss", "11.6.0");

describe("dockerHubTagUrl", () => {
  it("builds the public tag endpoint for an image and tag", () => {
    expect(URL).toBe("https://hub.docker.com/v2/repositories/grafana/grafana-oss/tags/11.6.0");
  });
});

describe("probeTagPublished", () => {
  it("reports published on a 200", async () => {
    expect(await probeTagPublished(SPEC, stubHttp({ [URL]: 200 }))).toBe(true);
  });

  it("reports unpublished on a 404 — the Grafana OSS 13.1 vector", async () => {
    expect(await probeTagPublished(SPEC, stubHttp({ [URL]: 404 }))).toBe(false);
  });

  /**
   * A rate limit or outage must never be recorded as "the vendor
   * unpublished this version" — that would manufacture a release blocker
   * out of a transient network condition.
   */
  it("reports undetermined on any other status rather than collapsing to unpublished", async () => {
    expect(await probeTagPublished(SPEC, stubHttp({ [URL]: 429 }))).toBeUndefined();
    expect(await probeTagPublished(SPEC, stubHttp({ [URL]: 503 }))).toBeUndefined();
  });

  it("treats a hosted target with no pinned artifact as published", async () => {
    const hosted = { target: "grafana-cloud", pinnedVersion: "cloud" };
    expect(await probeTagPublished(hosted, stubHttp({}))).toBe(true);
  });
});

describe("buildSupportWindowRecords", () => {
  it("merges the attested date with the probed publication status", async () => {
    const result = await buildSupportWindowRecords({
      targets: [SPEC],
      policy: [policyEntry()],
      http: stubHttp({ [URL]: 200 }),
      probedOn: PROBED_ON,
    });
    expect(result.skipped).toEqual([]);
    expect(result.records).toHaveLength(1);
    expect(result.records[0]).toMatchObject({
      target: "grafana-11.6",
      pinnedVersion: "11.6.0",
      supportEndsOn: "2027-06-01",
      confirmedOn: PROBED_ON,
      tagPublished: true,
    });
  });

  it("records an unpublished artifact truthfully", async () => {
    const result = await buildSupportWindowRecords({
      targets: [SPEC],
      policy: [policyEntry()],
      http: stubHttp({ [URL]: 404 }),
      probedOn: PROBED_ON,
    });
    expect(result.records[0]?.tagPublished).toBe(false);
  });

  /** Inventing a support-end date is the aspirational evidence this phase forbids. */
  it("SKIPS a target with no policy entry rather than defaulting a date", async () => {
    const result = await buildSupportWindowRecords({
      targets: [SPEC],
      policy: [],
      http: stubHttp({ [URL]: 200 }),
      probedOn: PROBED_ON,
    });
    expect(result.records).toEqual([]);
    expect(result.skipped.join(" ")).toContain("is not invented");
  });

  it("SKIPS a target whose publication status could not be determined", async () => {
    const result = await buildSupportWindowRecords({
      targets: [SPEC],
      policy: [policyEntry()],
      http: stubHttp({ [URL]: 429 }),
      probedOn: PROBED_ON,
    });
    expect(result.records).toEqual([]);
    expect(result.skipped.join(" ")).toContain("left undetermined");
  });

  it("carries a recorded fixture refresh through to the record", async () => {
    const result = await buildSupportWindowRecords({
      targets: [SPEC],
      policy: [policyEntry({ fixtureRefresh: "cassettes regenerated 2026-07-21" })],
      http: stubHttp({ [URL]: 200 }),
      probedOn: PROBED_ON,
    });
    expect(result.records[0]?.fixtureRefresh).toBe("cassettes regenerated 2026-07-21");
  });

  it("never silently drops a target — every input is either recorded or explained", async () => {
    const result = await buildSupportWindowRecords({
      targets: SUPPORT_WINDOW_TARGETS,
      policy: [policyEntry()],
      http: stubHttp({ [URL]: 200 }),
      probedOn: PROBED_ON,
    });
    expect(result.records.length + result.skipped.length).toBe(SUPPORT_WINDOW_TARGETS.length);
  });
});

describe("SUPPORT_WINDOW_TARGETS", () => {
  it("covers every target the release commits to, with no duplicates", () => {
    const targets = SUPPORT_WINDOW_TARGETS.map((spec) => spec.target);
    expect(new Set(targets).size).toBe(targets.length);
    expect(targets).toEqual([
      "jira-cloud",
      "jira-dc-10.3",
      "jira-dc-11.3",
      "grafana-cloud",
      "grafana-11.6",
      "grafana-12.4",
      "grafana-13.1",
    ]);
  });
});

describe("VendorSupportPolicySchema", () => {
  it("rejects an uncited date — an uncited confirmation is not a confirmation", () => {
    expect(() =>
      VendorSupportPolicySchema.parse([{ target: "x", supportEndsOn: "2027-01-01", source: "" }]),
    ).toThrow();
  });

  it("rejects a malformed date", () => {
    expect(() =>
      VendorSupportPolicySchema.parse([{ target: "x", supportEndsOn: "soon", source: "s" }]),
    ).toThrow();
  });

  it("accepts a well-formed entry", () => {
    expect(VendorSupportPolicySchema.parse([policyEntry()])).toHaveLength(1);
  });
});
