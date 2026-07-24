/**
 * `ci` category — roadmap/12 §In scope, "Detection" bullet: "CI ... →
 * `StackEvidence`".
 */
import type { StackEvidenceFinding } from "@eo/contracts";
import { findFiles, type DetectionContext, type Detector } from "./types.js";

interface CiRule {
  readonly matches: (path: string) => boolean;
  readonly system: string;
  readonly confidence: number;
}

const CI_RULES: readonly CiRule[] = [
  {
    matches: (p) =>
      p.startsWith(".github/workflows/") && (p.endsWith(".yml") || p.endsWith(".yaml")),
    system: "github-actions",
    confidence: 0.95,
  },
  { matches: (p) => p === ".gitlab-ci.yml", system: "gitlab-ci", confidence: 0.95 },
  { matches: (p) => p === ".circleci/config.yml", system: "circleci", confidence: 0.95 },
  { matches: (p) => p === "Jenkinsfile", system: "jenkins", confidence: 0.9 },
  { matches: (p) => p === "azure-pipelines.yml", system: "azure-pipelines", confidence: 0.9 },
];

export const ciDetector: Detector = {
  id: "ci",
  detect(ctx: DetectionContext): StackEvidenceFinding[] {
    const findings: StackEvidenceFinding[] = [];
    for (const rule of CI_RULES) {
      for (const file of findFiles(ctx, rule.matches)) {
        findings.push({
          category: "ci",
          ecosystem: rule.system,
          detail: `${rule.system} configuration present`,
          path: file.relativePath,
          confidence: rule.confidence,
        });
      }
    }
    return findings;
  },
};
