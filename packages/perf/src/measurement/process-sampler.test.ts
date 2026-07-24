import { describe, expect, it } from "vitest";
import { ProcessSampleUnavailableError } from "../errors.js";
import { sampleProcess, trySampleProcess } from "./process-sampler.js";

describe("sampleProcess", () => {
  it("samples the current (definitely-live) test process's own /proc entries", async () => {
    const sample = await sampleProcess(process.pid);
    expect(sample.stat.utimeTicks).toBeGreaterThanOrEqual(0);
    expect(sample.stat.stimeTicks).toBeGreaterThanOrEqual(0);
    expect(sample.stat.rssPages).toBeGreaterThan(0);
  });

  it("throws ProcessSampleUnavailableError for a pid that (almost certainly) does not exist", async () => {
    await expect(sampleProcess(999_999_999)).rejects.toThrow(ProcessSampleUnavailableError);
  });
});

describe("trySampleProcess", () => {
  it("never throws — returns undefined for an unavailable pid", async () => {
    await expect(trySampleProcess(999_999_999)).resolves.toBeUndefined();
  });

  it("returns a sample for the current process", async () => {
    const sample = await trySampleProcess(process.pid);
    expect(sample).toBeDefined();
  });
});
