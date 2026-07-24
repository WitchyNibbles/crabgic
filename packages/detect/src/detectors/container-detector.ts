/**
 * `container` category — roadmap/12 §In scope, "Detection" bullet:
 * "containers ... → `StackEvidence`".
 */
import type { StackEvidenceFinding } from "@eo/contracts";
import { findFiles, type DetectionContext, type Detector } from "./types.js";

function isDockerfile(path: string): boolean {
  const fileName = path.slice(path.lastIndexOf("/") + 1);
  return fileName === "Dockerfile" || fileName.startsWith("Dockerfile.");
}

function isComposeFile(path: string): boolean {
  const fileName = path.slice(path.lastIndexOf("/") + 1);
  return fileName === "docker-compose.yml" || fileName === "docker-compose.yaml";
}

export const containerDetector: Detector = {
  id: "container",
  detect(ctx: DetectionContext): StackEvidenceFinding[] {
    const findings: StackEvidenceFinding[] = [];
    for (const file of findFiles(ctx, isDockerfile)) {
      findings.push({
        category: "container",
        ecosystem: "docker",
        detail: "Dockerfile present",
        path: file.relativePath,
        confidence: 0.9,
      });
    }
    for (const file of findFiles(ctx, isComposeFile)) {
      findings.push({
        category: "container",
        ecosystem: "docker",
        detail: "docker-compose configuration present",
        path: file.relativePath,
        confidence: 0.9,
      });
    }
    return findings;
  },
};
