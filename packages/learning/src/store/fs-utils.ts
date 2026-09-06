import { chmod, mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

/**
 * `mkdir(dir, {mode})` is subject to the process umask (the same footgun
 * `@crabgic/supervisor`'s `runtime-dir.ts` documents for its own runtime
 * directory) — every directory this package CREATES is followed by an
 * explicit `chmod` so its on-disk mode is exactly what was requested,
 * never umask-widened.
 *
 * The `chmod` is scoped to the create path deliberately. Only a directory
 * this call just made can have been umask-widened; re-`chmod`ing an existing
 * one WIDENS whatever narrower mode it was deliberately given. That is not
 * hypothetical: `./case-fixture-store.ts`'s `seal()` narrows the held-out
 * directory to `LEARNING_SEALED_DIR_MODE` (0o500) and documents the result as
 * an OS-enforced boundary — and its own `write()` calls this function one
 * line before the write that boundary is supposed to refuse, so the
 * unconditional `chmod` took the directory back to 0o700 and let the write
 * through. `mkdir(recursive)` returns the first path it created, or
 * `undefined` when the directory was already there, which is exactly the
 * signal needed. Held to it by `../red-team/grader-unseal.redteam.test.ts`.
 */
export async function ensureDir(dir: string, mode: number): Promise<void> {
  const created = await mkdir(dir, { recursive: true, mode });
  if (created !== undefined) {
    await chmod(dir, mode);
  }
}

/**
 * Atomic write: write to a sibling temp file, then `rename` over the
 * target — a reader never observes a partially-written file. Mirrors
 * `@crabgic/journal`'s own durable-write discipline (`durably-append-line`),
 * scoped here to whole-file JSON records rather than an append-only ndjson
 * segment.
 */
export async function atomicWriteFile(path: string, content: string, mode: number): Promise<void> {
  const dir = join(path, "..");
  const tmpPath = join(dir, `.tmp-${randomUUID()}`);
  await writeFile(tmpPath, content, { mode });
  await chmod(tmpPath, mode);
  await rename(tmpPath, path);
}

export async function readJsonFile<T>(path: string): Promise<T> {
  const raw = await readFile(path, "utf8");
  return JSON.parse(raw) as T;
}

export async function listJsonFiles(dir: string): Promise<readonly string[]> {
  let entries: readonly string[];
  try {
    entries = await readdir(dir);
  } catch {
    return [];
  }
  return entries.filter((name) => name.endsWith(".json")).sort();
}
