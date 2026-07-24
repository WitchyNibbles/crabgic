/**
 * `manifest` category — roadmap/12 §In scope, "Detection" bullet:
 * "manifests ... → `StackEvidence`". Recognizes the primary manifest file
 * for each of the 4 ecosystems this phase's fixture matrix names (node/ts,
 * python, go, rust) at ANY depth (so a monorepo's nested
 * a nested `packages/<name>/package.json` is found too, not just the root).
 */
import type { StackEvidenceFinding } from "@eo/contracts";
import { findFiles, type DetectionContext, type Detector } from "./types.js";

interface ManifestRule {
  readonly fileName: string;
  readonly ecosystem: string;
  readonly confidence: number;
}

const MANIFEST_RULES: readonly ManifestRule[] = [
  { fileName: "package.json", ecosystem: "node", confidence: 0.95 },
  { fileName: "pyproject.toml", ecosystem: "python", confidence: 0.95 },
  { fileName: "setup.py", ecosystem: "python", confidence: 0.8 },
  { fileName: "go.mod", ecosystem: "go", confidence: 0.95 },
  { fileName: "Cargo.toml", ecosystem: "rust", confidence: 0.95 },
];

export const manifestDetector: Detector = {
  id: "manifest",
  detect(ctx: DetectionContext): StackEvidenceFinding[] {
    const findings: StackEvidenceFinding[] = [];
    for (const rule of MANIFEST_RULES) {
      const matches = findFiles(ctx, (p) => p === rule.fileName || p.endsWith(`/${rule.fileName}`));
      for (const match of matches) {
        findings.push({
          category: "manifest",
          ecosystem: rule.ecosystem,
          detail: `${rule.fileName} present`,
          path: match.relativePath,
          confidence: rule.confidence,
        });
      }
    }
    return findings;
  },
};
