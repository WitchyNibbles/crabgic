import { readdir, readFile } from "node:fs/promises";
import { ProcessSampleUnavailableError } from "../errors.js";
import {
  parseProcIo,
  parseProcStat,
  parseProcStatus,
  type ProcIoFields,
  type ProcStatFields,
  type ProcStatusFields,
} from "./proc-parser.js";

export interface ProcessSample {
  readonly stat: ProcStatFields;
  readonly status: ProcStatusFields;
  /** Absent when `/proc/<pid>/io` isn't exposed (not every sandbox/container mounts it) — best-effort, never required. */
  readonly io?: ProcIoFields;
}

/**
 * Best-effort `/proc/<pid>/*` sample for a live (or very-recently-exited)
 * pid — roadmap/15 §In scope, "Resource capture": "`/proc` … wrappers
 * around the benchmarked base/candidate processes." Throws
 * `ProcessSampleUnavailableError` only when `/proc/<pid>/stat` itself can't
 * be read (process already exited, or `/proc` unsupported on this
 * platform, e.g. non-Linux) — `status`/`io` are each independently
 * best-effort (missing entirely inside some sandbox/container profiles)
 * and degrade to an empty/absent value rather than failing the whole
 * sample.
 */
export async function sampleProcess(pid: number): Promise<ProcessSample> {
  let statContent: string;
  try {
    statContent = await readFile(`/proc/${String(pid)}/stat`, "utf8");
  } catch {
    throw new ProcessSampleUnavailableError(pid);
  }
  const stat = parseProcStat(statContent);

  let status: ProcStatusFields = {};
  try {
    status = parseProcStatus(await readFile(`/proc/${String(pid)}/status`, "utf8"));
  } catch {
    // best-effort: leave status empty.
  }

  let io: ProcIoFields | undefined;
  try {
    io = parseProcIo(await readFile(`/proc/${String(pid)}/io`, "utf8"));
  } catch {
    io = undefined;
  }

  return { stat, status, ...(io !== undefined ? { io } : {}) };
}

/** Never throws — `undefined` instead of `ProcessSampleUnavailableError`, for a polling loop that treats "no sample this tick" (process already gone) as routine, not exceptional. */
export async function trySampleProcess(pid: number): Promise<ProcessSample | undefined> {
  try {
    return await sampleProcess(pid);
  } catch {
    return undefined;
  }
}

/**
 * Every pid currently reachable from `rootPid` by following `ppid` links —
 * i.e. `rootPid` plus every (transitive) child. Needed because a `{shell:
 * true}` spawn's own pid is NOT reliably the pid that ends up doing the
 * measured work: some `/bin/sh` implementations exec-replace a simple
 * single command in place (same pid becomes the real command), while
 * others fork a child and wait (the real work happens on a DIFFERENT,
 * child pid — observed in this repo's own dev/CI environment, see
 * `docs/evidence/phase-15/README.md`). Scans every numeric entry under
 * `/proc` once (best-effort — entries that vanish mid-scan, e.g. a process
 * exiting between `readdir` and the individual `readFile`, are silently
 * skipped rather than failing the whole scan).
 */
export async function listDescendantPids(rootPid: number): Promise<readonly number[]> {
  let entries: string[];
  try {
    entries = await readdir("/proc");
  } catch {
    return [rootPid];
  }

  const ppidByPid = new Map<number, number>();
  await Promise.all(
    entries
      .filter((name) => /^\d+$/.test(name))
      .map(async (name) => {
        const pid = Number(name);
        try {
          const content = await readFile(`/proc/${name}/stat`, "utf8");
          ppidByPid.set(pid, parseProcStat(content).ppid);
        } catch {
          // Process vanished between readdir and readFile — skip it.
        }
      }),
  );

  const descendants = new Set<number>([rootPid]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const [pid, ppid] of ppidByPid) {
      if (descendants.has(ppid) && !descendants.has(pid)) {
        descendants.add(pid);
        grew = true;
      }
    }
  }
  return [...descendants];
}

export interface ProcessTreeSample {
  readonly utimeTicks: number;
  readonly stimeTicks: number;
  /** Sum of each live descendant's own peak-RSS water mark, kilobytes — an approximation of the whole tree's total memory footprint (documented: not a true combined "peak at one instant", since each process's own `VmHWM` is itself already a per-process running maximum). */
  readonly peakRssKb: number;
  readonly ioReadBytes?: number;
  readonly ioWriteBytes?: number;
}

/**
 * Sums CPU-time and peak-RSS across `rootPid`'s ENTIRE process tree (see
 * `listDescendantPids`) at this instant — the tree-aware counterpart to
 * `sampleProcess`, used by `./command-runner.ts` so a `{shell: true}`
 * spawn is measured correctly regardless of whether the shell exec-replaced
 * itself or forked a child to do the real work.
 */
export async function sampleProcessTree(rootPid: number): Promise<ProcessTreeSample> {
  const pids = await listDescendantPids(rootPid);
  const samples = await Promise.all(pids.map((pid) => trySampleProcess(pid)));

  let utimeTicks = 0;
  let stimeTicks = 0;
  let peakRssKb = 0;
  let ioReadBytes: number | undefined;
  let ioWriteBytes: number | undefined;

  for (const sample of samples) {
    if (sample === undefined) continue;
    utimeTicks += sample.stat.utimeTicks;
    stimeTicks += sample.stat.stimeTicks;
    if (sample.status.vmHwmKb !== undefined) peakRssKb += sample.status.vmHwmKb;
    if (sample.io?.readBytes !== undefined) {
      ioReadBytes = (ioReadBytes ?? 0) + sample.io.readBytes;
    }
    if (sample.io?.writeBytes !== undefined) {
      ioWriteBytes = (ioWriteBytes ?? 0) + sample.io.writeBytes;
    }
  }

  return {
    utimeTicks,
    stimeTicks,
    peakRssKb,
    ...(ioReadBytes !== undefined ? { ioReadBytes } : {}),
    ...(ioWriteBytes !== undefined ? { ioWriteBytes } : {}),
  };
}
