import { describe, expect, it } from "vitest";
import { parseProcIo, parseProcStat, parseProcStatus, ticksToMs } from "./proc-parser.js";

const SYNTHETIC_STAT_LINE =
  "12345 (myproc) S 1 12345 12345 0 -1 4194304 100 0 0 0 4000 2000 0 0 20 0 1 0 12345 123456 2048 18446744073709551615 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0\n";

describe("parseProcStat", () => {
  it("parses utime/stime/rss from a synthetic /proc/<pid>/stat line", () => {
    const fields = parseProcStat(SYNTHETIC_STAT_LINE);
    expect(fields.utimeTicks).toBe(4000);
    expect(fields.stimeTicks).toBe(2000);
    expect(fields.rssPages).toBe(2048);
  });

  it("handles a comm field containing spaces and parens (the kernel's own quirk)", () => {
    const line = SYNTHETIC_STAT_LINE.replace("(myproc)", "(my (weird) proc name)");
    const fields = parseProcStat(line);
    expect(fields.utimeTicks).toBe(4000);
    expect(fields.stimeTicks).toBe(2000);
  });

  it("returns zeros rather than NaN for a malformed line", () => {
    const fields = parseProcStat("not a valid stat line at all");
    expect(fields.utimeTicks).toBe(0);
    expect(fields.stimeTicks).toBe(0);
    expect(fields.rssPages).toBe(0);
  });
});

describe("ticksToMs", () => {
  it("converts clock ticks (100/sec) to milliseconds", () => {
    expect(ticksToMs(100)).toBe(1000);
    expect(ticksToMs(50)).toBe(500);
  });
});

describe("parseProcStatus", () => {
  it("parses VmHWM and VmRSS from a synthetic /proc/<pid>/status blob", () => {
    const content =
      "Name:\tmyproc\nVmPeak:\t   9000 kB\nVmHWM:\t   4096 kB\nVmRSS:\t   3072 kB\nThreads:\t1\n";
    const fields = parseProcStatus(content);
    expect(fields.vmHwmKb).toBe(4096);
    expect(fields.vmRssKb).toBe(3072);
  });

  it("returns an empty object when neither field is present", () => {
    expect(parseProcStatus("Name:\tmyproc\nThreads:\t1\n")).toEqual({});
  });
});

describe("parseProcIo", () => {
  it("parses rchar/wchar/read_bytes/write_bytes from a synthetic /proc/<pid>/io blob", () => {
    const content =
      "rchar: 1000\nwchar: 2000\nsyscr: 5\nsyscw: 6\nread_bytes: 4096\nwrite_bytes: 8192\ncancelled_write_bytes: 0\n";
    const fields = parseProcIo(content);
    expect(fields.rcharBytes).toBe(1000);
    expect(fields.wcharBytes).toBe(2000);
    expect(fields.readBytes).toBe(4096);
    expect(fields.writeBytes).toBe(8192);
  });

  it("returns an empty object for content with none of the known keys", () => {
    expect(parseProcIo("unrelated: 1\n")).toEqual({});
  });
});
