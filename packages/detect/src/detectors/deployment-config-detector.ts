/**
 * `deployment_config` category — roadmap/12 §In scope, "Detection" bullet:
 * "deployment config ... → `StackEvidence`".
 */
import type { StackEvidenceFinding } from "@eo/contracts";
import { findFiles, type DetectionContext, type Detector } from "./types.js";

interface DeploymentRule {
  readonly fileName: string;
  readonly platform: string;
  readonly confidence: number;
}

const DEPLOYMENT_RULES: readonly DeploymentRule[] = [
  { fileName: "Procfile", platform: "heroku", confidence: 0.8 },
  { fileName: "vercel.json", platform: "vercel", confidence: 0.9 },
  { fileName: "netlify.toml", platform: "netlify", confidence: 0.9 },
  { fileName: "fly.toml", platform: "fly.io", confidence: 0.9 },
  { fileName: "render.yaml", platform: "render", confidence: 0.85 },
  { fileName: "app.yaml", platform: "google-app-engine", confidence: 0.7 },
  { fileName: "serverless.yml", platform: "serverless-framework", confidence: 0.85 },
];

export const deploymentConfigDetector: Detector = {
  id: "deployment_config",
  detect(ctx: DetectionContext): StackEvidenceFinding[] {
    const findings: StackEvidenceFinding[] = [];
    for (const rule of DEPLOYMENT_RULES) {
      for (const file of findFiles(
        ctx,
        (p) => p === rule.fileName || p.endsWith(`/${rule.fileName}`),
      )) {
        findings.push({
          category: "deployment_config",
          ecosystem: rule.platform,
          detail: `${rule.platform} deployment configuration present`,
          path: file.relativePath,
          confidence: rule.confidence,
        });
      }
    }
    return findings;
  },
};
