import { describe, expect, it } from "vitest";
import { parseProcStatStartTimeTicks, readProcessStartTimeFromProc } from "./lease-proc-stat.js";

/** Builds a synthetic `/proc/<pid>/stat` line with `comm` and `starttime` set exactly, all other fields plausible-but-arbitrary. */
function fakeStatLine(pid: number, comm: string, starttime: number): string {
  // fields 3..21 (state..itrealvalue), field 22 = starttime.
  const middle = "S 1 1 1 0 -1 4194304 0 0 0 0 0 0 0 0 20 0 1 0";
  return `${pid} (${comm}) ${middle} ${starttime}`;
}

describe("parseProcStatStartTimeTicks — unit", () => {
  it("parses a normal single-word comm", () => {
    expect(parseProcStatStartTimeTicks(fakeStatLine(123, "node", 987654))).toBe(987654);
  });

  it("parses a comm containing spaces (robust split on the LAST ')')", () => {
    expect(parseProcStatStartTimeTicks(fakeStatLine(123, "my cool proc", 42))).toBe(42);
  });

  it("parses a comm containing its own parentheses", () => {
    expect(parseProcStatStartTimeTicks(fakeStatLine(123, "weird(name)proc", 555))).toBe(555);
  });

  it("parses a comm containing an unbalanced trailing paren immediately before the real close", () => {
    expect(parseProcStatStartTimeTicks(fakeStatLine(123, "a)b)c", 9001))).toBe(9001);
  });

  it("returns undefined when there is no ')' at all", () => {
    expect(parseProcStatStartTimeTicks("not a stat line")).toBeUndefined();
  });

  it("returns undefined when the line is truncated right after the comm", () => {
    expect(parseProcStatStartTimeTicks("123 (node)")).toBeUndefined();
  });

  it("returns undefined when there are too few fields after the comm to reach field 22", () => {
    expect(parseProcStatStartTimeTicks("123 (node) S 1 1")).toBeUndefined();
  });

  it("returns undefined when the starttime field is not numeric (torn/corrupt write)", () => {
    const middle = "S 1 1 1 0 -1 4194304 0 0 0 0 0 0 0 0 20 0 1 0";
    expect(parseProcStatStartTimeTicks(`123 (node) ${middle} NOTANUMBER`)).toBeUndefined();
  });

  it("returns undefined for a negative starttime (malformed)", () => {
    const middle = "S 1 1 1 0 -1 4194304 0 0 0 0 0 0 0 0 20 0 1 0";
    expect(parseProcStatStartTimeTicks(`123 (node) ${middle} -5`)).toBeUndefined();
  });
});

describe("readProcessStartTimeFromProc — integration (real /proc filesystem)", () => {
  it("reads this test process's own real start time as a non-negative integer", async () => {
    const startTime = await readProcessStartTimeFromProc(process.pid);
    expect(startTime).toBeDefined();
    expect(Number.isInteger(startTime)).toBe(true);
    expect(startTime).toBeGreaterThanOrEqual(0);
  });

  it("returns undefined for a pid that (almost certainly) does not exist", async () => {
    const startTime = await readProcessStartTimeFromProc(2 ** 30);
    expect(startTime).toBeUndefined();
  });
});
