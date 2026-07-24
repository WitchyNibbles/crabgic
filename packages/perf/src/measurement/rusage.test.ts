import { describe, expect, it } from "vitest";
import { captureSelfRusage } from "./rusage.js";

function busyWork(): number {
  let acc = 0;
  for (let i = 0; i < 5_000_000; i += 1) {
    acc += Math.sqrt(i);
  }
  return acc;
}

describe("captureSelfRusage", () => {
  it("returns numeric CPU/RSS fields only", () => {
    const sample = captureSelfRusage();
    expect(typeof sample.cpuUserMs).toBe("number");
    expect(typeof sample.cpuSystemMs).toBe("number");
    expect(typeof sample.maxRssKb).toBe("number");
    expect(sample.maxRssKb).toBeGreaterThan(0);
  });

  it("is monotonic non-decreasing across CPU-consuming work (cumulative since process start)", () => {
    const before = captureSelfRusage();
    busyWork();
    const after = captureSelfRusage();
    expect(after.cpuUserMs).toBeGreaterThanOrEqual(before.cpuUserMs);
  });

  it("the returned object contains no environment/argv-shaped keys (secret-leakage guard)", () => {
    const sample = captureSelfRusage();
    expect(Object.keys(sample).sort()).toEqual(["cpuSystemMs", "cpuUserMs", "maxRssKb"]);
  });
});
