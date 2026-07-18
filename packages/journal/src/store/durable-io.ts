/**
 * Durability primitives — roadmap/04-journal-idempotency-leases.md §In
 * scope: "append = write -> `fsync(file)` -> `fsync(dir)`"; work item 2:
 * "a fault-injected kill between write and fsync fails against a naive
 * buffered writer before the fsync-ordered implementation lands."
 *
 * See docs/evidence/phase-04/wi2-fsync-append-failing.txt for the
 * failing-first evidence captured against the prior naive-buffered-writer
 * stub (open -> write -> close, no fsync at all) before this real,
 * fsync-ordered implementation landed.
 */

import type { FsPort } from "./fs-port.js";

/** `write -> fsync(file) -> fsync(dir)` for one ndjson line appended to `filePath` (whose parent directory is `dirPath`). */
export async function durablyAppendLine(
  fs: FsPort,
  filePath: string,
  dirPath: string,
  line: string,
  fileMode: number,
): Promise<void> {
  const handle = await fs.open(filePath, "a", fileMode);
  try {
    await fs.write(handle, Buffer.from(line, "utf8"));
    await fs.fsync(handle);
  } finally {
    await fs.close(handle);
  }

  const dirHandle = await fs.open(dirPath, "r");
  try {
    await fs.fsync(dirHandle);
  } finally {
    await fs.close(dirHandle);
  }
}

/** Atomic temp-file + rename write, durable via `write -> fsync(temp file) -> rename -> fsync(dir)`. Used by the snapshot writer (work item 3). */
export async function durablyWriteFileAtomic(
  fs: FsPort,
  finalPath: string,
  dirPath: string,
  content: string,
  fileMode: number,
  tempSuffix: string,
): Promise<void> {
  const tempPath = `${finalPath}.tmp-${tempSuffix}`;
  const handle = await fs.open(tempPath, "wx", fileMode);
  try {
    await fs.write(handle, Buffer.from(content, "utf8"));
    await fs.fsync(handle);
  } finally {
    await fs.close(handle);
  }
  await fs.rename(tempPath, finalPath);

  const dirHandle = await fs.open(dirPath, "r");
  try {
    await fs.fsync(dirHandle);
  } finally {
    await fs.close(dirHandle);
  }
}

/** Durable in-place truncation (`ftruncate -> fsync(file) -> fsync(dir)`). Used by tail repair (work item 3) to durably discard a corrupted trailing entry. */
export async function durablyTruncateFile(
  fs: FsPort,
  filePath: string,
  dirPath: string,
  newLength: number,
): Promise<void> {
  const handle = await fs.open(filePath, "r+");
  try {
    await fs.truncate(handle, newLength);
    await fs.fsync(handle);
  } finally {
    await fs.close(handle);
  }

  const dirHandle = await fs.open(dirPath, "r");
  try {
    await fs.fsync(dirHandle);
  } finally {
    await fs.close(dirHandle);
  }
}
