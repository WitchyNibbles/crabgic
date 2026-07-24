/**
 * `source_composition` category — roadmap/12 §In scope, "Detection" bullet:
 * "source composition ... → `StackEvidence`". A simple, pure extension
 * histogram over every walked file: each recognized ecosystem's finding
 * carries the count in its `detail` text and the FIRST matching file as its
 * representative `path` (the schema requires exactly one non-empty path
 * per finding, not a list — see `StackEvidenceFindingSchema`).
 */
import type { StackEvidenceFinding } from "@eo/contracts";
import { type DetectionContext, type Detector } from "./types.js";

const EXTENSION_ECOSYSTEMS: ReadonlyMap<string, string> = new Map([
  [".ts", "node"],
  [".tsx", "node"],
  [".js", "node"],
  [".jsx", "node"],
  [".mjs", "node"],
  [".py", "python"],
  [".go", "go"],
  [".rs", "rust"],
]);

function extensionOf(path: string): string | undefined {
  const lastSlash = path.lastIndexOf("/");
  const fileName = lastSlash === -1 ? path : path.slice(lastSlash + 1);
  const dotIndex = fileName.lastIndexOf(".");
  if (dotIndex <= 0) return undefined; // no extension, or a dotfile with no extension of its own
  return fileName.slice(dotIndex);
}

export const sourceCompositionDetector: Detector = {
  id: "source_composition",
  detect(ctx: DetectionContext): StackEvidenceFinding[] {
    const counts = new Map<string, { count: number; firstPath: string }>();
    for (const file of ctx.files) {
      const ext = extensionOf(file.relativePath);
      if (ext === undefined) continue;
      const ecosystem = EXTENSION_ECOSYSTEMS.get(ext);
      if (ecosystem === undefined) continue;
      const existing = counts.get(ecosystem);
      if (existing === undefined) {
        counts.set(ecosystem, { count: 1, firstPath: file.relativePath });
      } else {
        existing.count += 1;
      }
    }

    const findings: StackEvidenceFinding[] = [];
    for (const [ecosystem, { count, firstPath }] of counts) {
      findings.push({
        category: "source_composition",
        ecosystem,
        detail: `${String(count)} source file(s) with a ${ecosystem} extension`,
        path: firstPath,
        confidence: count >= 5 ? 0.85 : 0.6,
      });
    }
    return findings;
  },
};
