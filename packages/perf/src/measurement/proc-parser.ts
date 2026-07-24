/**
 * Pure parsers for `/proc/<pid>/{stat,status,io}` content — split out from
 * any actual filesystem I/O (`./process-sampler.ts`) so they're unit
 * testable against fixture strings with no real process required
 * (roadmap/15 §Test plan, Unit: "measurement-wrapper parsing of
 * `/proc`/`getrusage` fixtures").
 */

/** Linux's `sysconf(_SC_CLK_TCK)` — universally 100 on every mainstream Linux distribution/kernel this repo targets (x86_64/arm64, glibc and musl alike); there is no portable way to read the true runtime value from Node without a native addon, so this is a documented, pinned assumption (see docs/evidence/phase-15/README.md). */
export const CLOCK_TICKS_PER_SECOND = 100;

export function ticksToMs(ticks: number): number {
  return (ticks / CLOCK_TICKS_PER_SECOND) * 1000;
}

export interface ProcStatFields {
  readonly ppid: number;
  readonly utimeTicks: number;
  readonly stimeTicks: number;
  readonly rssPages: number;
}

/**
 * Parses `/proc/<pid>/stat` content. Field 2 (`comm`, the process name) is
 * parenthesized and MAY itself contain spaces or even literal parens, so
 * this splits on the LAST `)` in the line (the kernel's own documented
 * quirk/convention for this file) rather than a naive whitespace split,
 * then treats every field after it as space-separated and 0-indexed from
 * field 3 onward. `ppid` is field 4 (1-indexed) => index 1 after the `)`;
 * `utime`/`stime` are fields 14/15 => index 11/12; `rss` is field 24 =>
 * index 21. `ppid` is what `./process-sampler.ts`'s `sampleProcessTree`
 * uses to walk the FULL descendant tree of a spawned pid — a `shell: true`
 * spawn's pid is not reliably the pid that ends up doing the measured CPU
 * work (some `/bin/sh` implementations exec-replace in place; this repo's
 * own dev/CI environment has been observed to fork instead, leaving the
 * spawned pid's own `/proc/<pid>/stat` at a permanent `utime=0`) — see
 * `docs/evidence/phase-15/README.md`'s deviations section.
 */
export function parseProcStat(content: string): ProcStatFields {
  const lastParen = content.lastIndexOf(")");
  const afterComm = content.slice(lastParen + 1).trim();
  const fields = afterComm.split(/\s+/);
  // fields[0] is field 3 (state) in the original 1-indexed numbering.
  const ppid = Number(fields[4 - 3]);
  const utimeTicks = Number(fields[14 - 3]);
  const stimeTicks = Number(fields[15 - 3]);
  const rssPages = Number(fields[24 - 3]);
  return {
    ppid: Number.isFinite(ppid) ? ppid : -1,
    utimeTicks: Number.isFinite(utimeTicks) ? utimeTicks : 0,
    stimeTicks: Number.isFinite(stimeTicks) ? stimeTicks : 0,
    rssPages: Number.isFinite(rssPages) ? rssPages : 0,
  };
}

export interface ProcStatusFields {
  /** Peak resident set size ("high water mark"), kilobytes. */
  readonly vmHwmKb?: number;
  /** Current resident set size, kilobytes. */
  readonly vmRssKb?: number;
}

const STATUS_LINE_PATTERN = /^(Vm\w+):\s*(\d+)\s*kB\s*$/;

/** Parses `/proc/<pid>/status` content (`Key:\tValue [kB]` lines) for the `VmHWM`/`VmRSS` fields this module cares about. */
export function parseProcStatus(content: string): ProcStatusFields {
  let vmHwmKb: number | undefined;
  let vmRssKb: number | undefined;
  for (const line of content.split("\n")) {
    const match = STATUS_LINE_PATTERN.exec(line.trim());
    if (match === null) continue;
    const [, key, rawValue] = match;
    const value = Number(rawValue);
    if (key === "VmHWM") vmHwmKb = value;
    if (key === "VmRSS") vmRssKb = value;
  }
  return {
    ...(vmHwmKb !== undefined ? { vmHwmKb } : {}),
    ...(vmRssKb !== undefined ? { vmRssKb } : {}),
  };
}

export interface ProcIoFields {
  readonly rcharBytes?: number;
  readonly wcharBytes?: number;
  readonly readBytes?: number;
  readonly writeBytes?: number;
}

const IO_LINE_PATTERN = /^(\w+):\s*(\d+)\s*$/;

/** Parses `/proc/<pid>/io` content (`key: value` lines; not exposed inside every sandbox/container, so callers must treat this as best-effort). */
export function parseProcIo(content: string): ProcIoFields {
  const values: Record<string, number> = {};
  for (const line of content.split("\n")) {
    const match = IO_LINE_PATTERN.exec(line.trim());
    if (match === null) continue;
    const [, key, rawValue] = match;
    if (key !== undefined) values[key] = Number(rawValue);
  }
  return {
    ...(values["rchar"] !== undefined ? { rcharBytes: values["rchar"] } : {}),
    ...(values["wchar"] !== undefined ? { wcharBytes: values["wchar"] } : {}),
    ...(values["read_bytes"] !== undefined ? { readBytes: values["read_bytes"] } : {}),
    ...(values["write_bytes"] !== undefined ? { writeBytes: values["write_bytes"] } : {}),
  };
}
