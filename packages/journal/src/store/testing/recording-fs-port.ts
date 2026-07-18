/**
 * Test-only helper: wraps a real `FsPort` and records the ordered sequence
 * of operations it performs, so a test can assert fsync ordering (work
 * item 2's exit criterion: "fsync ordering (write -> fsync(file) ->
 * fsync(dir)) asserted on the real append path — evidence: strace-based CI
 * assertion (Linux), or an injected fs-shim equivalent where strace is
 * unavailable"). Not a `.test.ts` file itself — imported by several test
 * files under `../` that need this recording behavior.
 */

import type { FsPort, FsStat, OpaqueHandle, OpenFlags } from "../fs-port.js";

export interface RecordedOp {
  readonly kind: "open" | "write" | "truncate" | "fsync" | "close" | "mkdir" | "rename" | "unlink";
  readonly path?: string;
}

export interface RecordingFsPort extends FsPort {
  readonly ops: readonly RecordedOp[];
}

/** Wraps `inner` (typically a real `createNodeFsPort()` pointed at a real tmp dir) so every call is appended to `.ops` in call order, alongside the target path resolved from the handle where relevant. */
export function wrapWithRecording(inner: FsPort): RecordingFsPort {
  const ops: RecordedOp[] = [];
  const pathByHandle = new WeakMap<object, string>();

  function rememberPath(handle: OpaqueHandle, path: string): void {
    if (typeof handle === "object" && handle !== null) {
      pathByHandle.set(handle, path);
    }
  }

  function pathOf(handle: OpaqueHandle): string | undefined {
    return typeof handle === "object" && handle !== null ? pathByHandle.get(handle) : undefined;
  }

  /** Records one op, attaching `path` only when known (never `path: undefined` — required under `exactOptionalPropertyTypes`). */
  function recordOp(kind: RecordedOp["kind"], handle: OpaqueHandle): void {
    const path = pathOf(handle);
    ops.push(path !== undefined ? { kind, path } : { kind });
  }

  return {
    ops,
    async open(path: string, flags: OpenFlags, mode?: number) {
      const handle = await inner.open(path, flags, mode);
      rememberPath(handle, path);
      ops.push({ kind: "open", path });
      return handle;
    },
    async write(handle: OpaqueHandle, data: Uint8Array) {
      await inner.write(handle, data);
      recordOp("write", handle);
    },
    async truncate(handle: OpaqueHandle, length: number) {
      await inner.truncate(handle, length);
      recordOp("truncate", handle);
    },
    async fsync(handle: OpaqueHandle) {
      await inner.fsync(handle);
      recordOp("fsync", handle);
    },
    async close(handle: OpaqueHandle) {
      await inner.close(handle);
      recordOp("close", handle);
    },
    async mkdir(path: string, options: { readonly recursive: boolean; readonly mode: number }) {
      await inner.mkdir(path, options);
      ops.push({ kind: "mkdir", path });
    },
    async rename(oldPath: string, newPath: string) {
      await inner.rename(oldPath, newPath);
      ops.push({ kind: "rename", path: `${oldPath} -> ${newPath}` });
    },
    async unlink(path: string) {
      await inner.unlink(path);
      ops.push({ kind: "unlink", path });
    },
    async readFile(path: string): Promise<string> {
      return await inner.readFile(path);
    },
    async readdir(path: string): Promise<readonly string[]> {
      return await inner.readdir(path);
    },
    async stat(path: string): Promise<FsStat> {
      return await inner.stat(path);
    },
  };
}
