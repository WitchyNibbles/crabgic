import { chmod, mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

/**
 * `mkdir(dir, {mode})` is subject to the process umask (the same footgun
 * `@eo/supervisor`'s `runtime-dir.ts` documents for its own runtime
 * directory) — every directory this package creates is followed by an
 * explicit `chmod` so its on-disk mode is exactly what was requested,
 * never umask-widened.
 */
export async function ensureDir(dir: string, mode: number): Promise<void> {
  await mkdir(dir, { recursive: true, mode });
  await chmod(dir, mode);
}

/**
 * Atomic write: write to a sibling temp file, then `rename` over the
 * target — a reader never observes a partially-written file. Mirrors
 * `@eo/journal`'s own durable-write discipline (`durably-append-line`),
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
