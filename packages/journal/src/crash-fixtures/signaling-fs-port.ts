import { signalFaultPoint } from "../kill-harness.js";
import type { FsPort, FsStat, OpaqueHandle, OpenFlags } from "../store/fs-port.js";

/**
 * Wraps a REAL `FsPort` (typically `createNodeFsPort()`) so that every
 * `open`/`write`/`fsync`/`close`/`rename` call — in the exact order the
 * real durable-io functions (`durablyAppendLine`/`durablyWriteFileAtomic`,
 * `../store/durable-io.ts`) actually invoke them — signals a named fault
 * point (via the real `signalFaultPoint`, the same marker mechanism
 * `runKillHarness` watches for) immediately AFTER the real syscall
 * completes, then sleeps briefly so the harness has time to observe the
 * marker and `SIGKILL` this process before the next real syscall runs.
 *
 * This is what makes the crash suite (`append-chain-snapshot-operation.ts`)
 * a genuine test of the REAL append/snapshot path rather than a simulated
 * corruption: every byte written and every fsync/rename that happens
 * happens for real, against a real file on a real filesystem — this
 * wrapper only inserts an observable pause between real steps, it never
 * fakes or skips any of them.
 *
 * `pointNames` must have exactly as many entries as the wrapped sequence
 * makes intercepted calls (7 for `durablyAppendLine`: open, write, fsync,
 * close, open, fsync, close; 8 for `durablyWriteFileAtomic`: open, write,
 * fsync, close, RENAME, open, fsync, close) — see
 * `APPEND_STEP_POINT_NAMES`/`SNAPSHOT_STEP_POINT_NAMES` below.
 */
export function createSignalingFsPort(
  real: FsPort,
  pointNames: readonly string[],
  sleepMs: number,
): FsPort {
  let stepIndex = 0;

  async function afterStep<T>(value: T): Promise<T> {
    const name = pointNames[stepIndex];
    stepIndex += 1;
    if (name !== undefined) {
      signalFaultPoint(name);
      await new Promise<void>((resolve) => setTimeout(resolve, sleepMs));
    }
    return value;
  }

  return {
    async open(path: string, flags: OpenFlags, mode?: number): Promise<OpaqueHandle> {
      const handle = await real.open(path, flags, mode);
      return afterStep(handle);
    },
    async write(handle: OpaqueHandle, data: Uint8Array): Promise<void> {
      await real.write(handle, data);
      await afterStep(undefined);
    },
    async truncate(handle: OpaqueHandle, length: number): Promise<void> {
      await real.truncate(handle, length);
      await afterStep(undefined);
    },
    async fsync(handle: OpaqueHandle): Promise<void> {
      await real.fsync(handle);
      await afterStep(undefined);
    },
    async close(handle: OpaqueHandle): Promise<void> {
      await real.close(handle);
      await afterStep(undefined);
    },
    async mkdir(
      path: string,
      options: { readonly recursive: boolean; readonly mode: number },
    ): Promise<void> {
      await real.mkdir(path, options);
    },
    async rename(oldPath: string, newPath: string): Promise<void> {
      await real.rename(oldPath, newPath);
      await afterStep(undefined);
    },
    async unlink(path: string): Promise<void> {
      await real.unlink(path);
    },
    async readFile(path: string): Promise<string> {
      return real.readFile(path);
    },
    async readdir(path: string): Promise<readonly string[]> {
      return real.readdir(path);
    },
    async stat(path: string): Promise<FsStat> {
      return real.stat(path);
    },
  };
}

/** Matches `durablyAppendLine`'s real call sequence exactly: open(file,"a") -> write -> fsync(file) -> close(file) -> open(dir,"r") -> fsync(dir) -> close(dir). */
export const APPEND_STEP_POINT_NAMES = [
  "after-open-file",
  "after-write",
  "after-fsync-file",
  "after-close-file",
  "after-open-dir",
  "after-fsync-dir",
  "after-close-dir",
] as const;

/** Matches `durablyWriteFileAtomic`'s real call sequence exactly: open(temp,"wx") -> write -> fsync(temp) -> close(temp) -> rename(temp,final) -> open(dir,"r") -> fsync(dir) -> close(dir). */
export const SNAPSHOT_STEP_POINT_NAMES = [
  "after-open-temp",
  "after-write",
  "after-fsync-temp",
  "after-close-temp",
  "after-rename",
  "after-open-dir",
  "after-fsync-dir",
  "after-close-dir",
] as const;

/** Every fault point name this fixture can ever signal, across both modes, plus the manual "before-*" points signalled outside the fs-port wrapper — the full set a caller can pass as `runKillHarness`'s `faultPoints`. */
export const ALL_CRASH_SUITE_FAULT_POINTS = [
  "before-append",
  ...APPEND_STEP_POINT_NAMES,
  "before-snapshot",
  ...SNAPSHOT_STEP_POINT_NAMES,
] as const;
