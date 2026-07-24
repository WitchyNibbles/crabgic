/**
 * `readTextBounded` — the sole file-content-reading primitive detectors and
 * quarantine scanners use. Reads at most `maxBytes` of a file as UTF-8 text
 * and NEVER evaluates/executes it (CLAUDE.md: "never execute detected
 * project code") — this module has no `eval`, `Function(...)`, `require`,
 * or dynamic `import()` of anything it reads, only `node:fs` byte reads.
 * Returns `undefined` (never throws) for a missing/unreadable/oversized
 * path so a single bad file never aborts a whole detection/scan pass.
 */
import { openSync, closeSync, readSync, statSync } from "node:fs";

const DEFAULT_MAX_BYTES = 1_000_000; // 1MB — ample for manifests/lockfiles/skill bodies, bounded against a pathological giant file.

export function readTextBounded(
  path: string,
  maxBytes: number = DEFAULT_MAX_BYTES,
): string | undefined {
  const st = statSync(path, { throwIfNoEntry: false });
  if (st === undefined || !st.isFile()) return undefined;
  if (st.size > maxBytes) return undefined;

  let fd: number;
  try {
    fd = openSync(path, "r");
  } catch {
    return undefined;
  }
  try {
    const buffer = Buffer.alloc(st.size);
    const bytesRead = readSync(fd, buffer, 0, st.size, 0);
    return buffer.subarray(0, bytesRead).toString("utf8");
  } catch {
    return undefined;
  } finally {
    closeSync(fd);
  }
}

/** Parses `text` as JSON, returning `undefined` (never throwing) on malformed input — the sole JSON boundary detectors use for manifest/lockfile parsing. */
export function parseJsonSafe(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}
