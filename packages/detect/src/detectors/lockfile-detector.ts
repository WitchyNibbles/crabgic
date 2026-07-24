/**
 * `lockfile` category — roadmap/12 §In scope, "Detection" bullet:
 * "lockfiles ... → `StackEvidence`".
 */
import type { StackEvidenceFinding } from "@eo/contracts";
import { findFiles, type DetectionContext, type Detector } from "./types.js";

interface LockfileRule {
  readonly fileName: string;
  readonly ecosystem: string;
  readonly confidence: number;
}

const LOCKFILE_RULES: readonly LockfileRule[] = [
  { fileName: "package-lock.json", ecosystem: "node", confidence: 0.95 },
  { fileName: "npm-shrinkwrap.json", ecosystem: "node", confidence: 0.9 },
  { fileName: "pnpm-lock.yaml", ecosystem: "node", confidence: 0.95 },
  { fileName: "yarn.lock", ecosystem: "node", confidence: 0.95 },
  { fileName: "poetry.lock", ecosystem: "python", confidence: 0.95 },
  { fileName: "Pipfile.lock", ecosystem: "python", confidence: 0.9 },
  { fileName: "uv.lock", ecosystem: "python", confidence: 0.9 },
  { fileName: "go.sum", ecosystem: "go", confidence: 0.9 },
  { fileName: "Cargo.lock", ecosystem: "rust", confidence: 0.9 },
];

export const lockfileDetector: Detector = {
  id: "lockfile",
  detect(ctx: DetectionContext): StackEvidenceFinding[] {
    const findings: StackEvidenceFinding[] = [];
    for (const rule of LOCKFILE_RULES) {
      const matches = findFiles(ctx, (p) => p === rule.fileName || p.endsWith(`/${rule.fileName}`));
      for (const match of matches) {
        findings.push({
          category: "lockfile",
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
