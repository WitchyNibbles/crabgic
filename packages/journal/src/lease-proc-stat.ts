import { readFile } from "node:fs/promises";

/**
 * Robustly parses a Linux `/proc/<pid>/stat` line and returns field 22
 * (`starttime`, in clock ticks since boot — see `man 5 proc`). Field 2
 * (`comm`, the executable's basename) is parenthesized and MAY itself
 * contain spaces or parentheses (a process can rename itself via `prctl`
 * to something adversarial), so the only robust split point is the LAST
 * ')' in the line: everything up to and including it is `pid (comm)`,
 * everything after is space-separated fields starting at field 3
 * (`state`) — this is the parsing strategy `man proc` itself recommends.
 */
export function parseProcStatStartTimeTicks(statContents: string): number | undefined {
  const lastParen = statContents.lastIndexOf(")");
  if (lastParen === -1) return undefined;

  const afterComm = statContents.slice(lastParen + 1).trim();
  if (afterComm.length === 0) return undefined;
  const fieldsAfterComm = afterComm.split(/\s+/);

  // field 3 (`state`) is fieldsAfterComm[0]; field N is fieldsAfterComm[N - 3].
  const STARTTIME_FIELD_NUMBER = 22;
  const starttimeRaw = fieldsAfterComm[STARTTIME_FIELD_NUMBER - 3];
  if (starttimeRaw === undefined) return undefined;

  const startTimeTicks = Number(starttimeRaw);
  return Number.isInteger(startTimeTicks) && startTimeTicks >= 0 ? startTimeTicks : undefined;
}

export type ProcessStartTimeReader = (pid: number) => Promise<number | undefined>;

/**
 * Real, Linux-only process-start-time reader — the default
 * `readProcessStartTime` for `Lease.acquire`, and injectable/overridable
 * via `LeaseAcquireOptions.readProcessStartTime` so tests never touch a
 * real `/proc` filesystem or depend on this test process's own PID/start
 * time. Returns `undefined` for every failure mode (no such process,
 * permission denied, non-Linux `/proc` absence, malformed contents) — the
 * takeover logic (`./lease-record.ts`'s `isTakeoverEligible`) treats every
 * failure mode identically: "cannot confirm this PID is still the recorded
 * process."
 */
export const readProcessStartTimeFromProc: ProcessStartTimeReader = async (pid) => {
  try {
    const contents = await readFile(`/proc/${pid}/stat`, "utf8");
    return parseProcStatStartTimeTicks(contents);
  } catch {
    return undefined;
  }
};
