/**
 * Shared in-memory `DetectionContext` builder for detector unit tests — a
 * plain `Record<relativePath, content>` map stands in for a real walked
 * tree/`readTextBounded`, keeping every per-detector unit test file-system
 * free. Not part of this package's public barrel — test scaffolding only.
 */
import { buildDetectionContext, type DetectionContext } from "../detectors/types.js";

export function ctxFromFiles(files: Readonly<Record<string, string>>): DetectionContext {
  const paths = Object.keys(files);
  return buildDetectionContext(
    paths.map((p) => ({ relativePath: p, absolutePath: `/root/${p}` })),
    (relativePath: string) => files[relativePath],
  );
}
