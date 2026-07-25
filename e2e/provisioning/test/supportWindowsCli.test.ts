import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { REPO_ROOT, runSupportWindowProbe } from "../src/supportWindowsCli.js";
import { SUPPORT_WINDOW_TARGETS, type HttpProbe } from "../src/supportWindows.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const PROBED_ON = "2026-07-25";

/** Answers 200 for everything except the known-unpublished Grafana OSS 13.1 tag. No network. */
const stubHttp: HttpProbe = (url) =>
  Promise.resolve({ status: url.includes("grafana-oss/tags/13.1.0") ? 404 : 200 });

let outDir: string;

beforeEach(async () => {
  outDir = await mkdtemp(join(tmpdir(), "eo-support-windows-"));
});

afterEach(async () => {
  await rm(outDir, { recursive: true, force: true });
});

describe("runSupportWindowProbe", () => {
  it("resolves the repo root so the committed policy file is findable", () => {
    expect(REPO_ROOT).toBe(join(HERE, "..", "..", ".."));
  });

  it("writes a record for every target in the committed policy", async () => {
    const outFile = join(outDir, "vendor-support-windows.json");
    const result = await runSupportWindowProbe({ http: stubHttp, probedOn: PROBED_ON, outFile });

    expect(result.skipped).toEqual([]);
    expect(result.records).toHaveLength(SUPPORT_WINDOW_TARGETS.length);

    const written: unknown = JSON.parse(await readFile(outFile, "utf-8"));
    expect(Array.isArray(written)).toBe(true);
    expect(written).toHaveLength(SUPPORT_WINDOW_TARGETS.length);
  });

  it("stamps every record with the injected probe date", async () => {
    const result = await runSupportWindowProbe({
      http: stubHttp,
      probedOn: PROBED_ON,
      outFile: join(outDir, "out.json"),
    });
    for (const record of result.records) {
      expect(record.confirmedOn).toBe(PROBED_ON);
    }
  });

  /**
   * The mechanical half, end to end: the committed policy says nothing
   * about whether a tag resolves, so this value can only come from the
   * probe. It is also the one target where the real registry answers 404.
   */
  it("records the probed publication status, not the policy's opinion of it", async () => {
    const result = await runSupportWindowProbe({
      http: stubHttp,
      probedOn: PROBED_ON,
      outFile: join(outDir, "out.json"),
    });
    const byTarget = new Map(result.records.map((record) => [record.target, record]));
    expect(byTarget.get("grafana-13.1")?.tagPublished).toBe(false);
    expect(byTarget.get("grafana-12.4")?.tagPublished).toBe(true);
  });

  it("carries the continuous lifecycle through for hosted services", async () => {
    const result = await runSupportWindowProbe({
      http: stubHttp,
      probedOn: PROBED_ON,
      outFile: join(outDir, "out.json"),
    });
    const byTarget = new Map(result.records.map((record) => [record.target, record]));
    expect(byTarget.get("grafana-cloud")?.lifecycle).toBe("continuous");
    expect(byTarget.get("grafana-cloud")?.supportEndsOn).toBeUndefined();
    expect(byTarget.get("jira-dc-10.3")?.lifecycle).toBe("versioned");
    expect(byTarget.get("jira-dc-10.3")?.supportEndsOn).toBe("2026-12-05");
  });

  it("never writes into the repository tree when an outFile is supplied", async () => {
    const outFile = join(outDir, "nested", "out.json");
    const result = await runSupportWindowProbe({ http: stubHttp, probedOn: PROBED_ON, outFile });
    expect(result.outFile).toBe(outFile);
    await expect(readFile(outFile, "utf-8")).resolves.toContain("grafana-12.4");
  });
});
