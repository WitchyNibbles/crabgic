/// <reference types="node" />
/**
 * `FsPort` — the injectable filesystem seam roadmap/04-journal-idempotency-
 * leases.md work item 2 asks for: "expose the fsync sequence in a way an
 * injected fs-shim test can assert ordering." Every durability-sensitive
 * operation in this package (`../store/durable-io.ts` and everything built
 * on it) goes through this narrow interface instead of calling `node:fs`
 * directly, so a test can substitute a recording/faulty implementation
 * without touching real disk.
 *
 * `OpaqueHandle` is deliberately untyped from the interface's point of
 * view — the real implementation's handle is a `node:fs/promises`
 * `FileHandle`; a test double's handle can be anything (a plain object, a
 * number) as long as it round-trips through the same port instance.
 */

import { mkdir, open, readFile, readdir, rename, stat, unlink } from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";

export type OpaqueHandle = unknown;

/**
 * `a`  — append (O_APPEND|O_CREAT|O_WRONLY), used for segment appends.
 * `r`  — read-only, used to open a directory (or file) purely to `fsync` it.
 * `r+` — read-write on an existing file without truncating, used by tail repair (`ftruncate`).
 * `wx` — create-exclusive, write-only (fails if the path already exists), used for atomic temp-file writes.
 */
export type OpenFlags = "a" | "r" | "r+" | "wx";

export interface FsStat {
  readonly size: number;
  readonly mtimeMs: number;
  readonly birthtimeMs: number;
  readonly mode: number;
}

export interface FsPort {
  open(path: string, flags: OpenFlags, mode?: number): Promise<OpaqueHandle>;
  write(handle: OpaqueHandle, data: Uint8Array): Promise<void>;
  truncate(handle: OpaqueHandle, length: number): Promise<void>;
  fsync(handle: OpaqueHandle): Promise<void>;
  close(handle: OpaqueHandle): Promise<void>;
  mkdir(
    path: string,
    options: { readonly recursive: boolean; readonly mode: number },
  ): Promise<void>;
  rename(oldPath: string, newPath: string): Promise<void>;
  unlink(path: string): Promise<void>;
  readFile(path: string): Promise<string>;
  readdir(path: string): Promise<readonly string[]>;
  stat(path: string): Promise<FsStat>;
}

/** The real, `node:fs/promises`-backed implementation — used by default in production. */
export function createNodeFsPort(): FsPort {
  return {
    async open(path, flags, mode) {
      return mode === undefined ? await open(path, flags) : await open(path, flags, mode);
    },
    async write(handle, data) {
      await (handle as FileHandle).write(data);
    },
    async truncate(handle, length) {
      await (handle as FileHandle).truncate(length);
    },
    async fsync(handle) {
      await (handle as FileHandle).sync();
    },
    async close(handle) {
      await (handle as FileHandle).close();
    },
    async mkdir(path, options) {
      await mkdir(path, { recursive: options.recursive, mode: options.mode });
    },
    async rename(oldPath, newPath) {
      await rename(oldPath, newPath);
    },
    async unlink(path) {
      await unlink(path);
    },
    async readFile(path) {
      return await readFile(path, "utf8");
    },
    async readdir(path) {
      return await readdir(path);
    },
    async stat(path) {
      const s = await stat(path);
      return { size: s.size, mtimeMs: s.mtimeMs, birthtimeMs: s.birthtimeMs, mode: s.mode };
    },
  };
}
