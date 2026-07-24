/**
 * `infrastructure` category — roadmap/12 §In scope, "Detection" bullet:
 * "infrastructure ... → `StackEvidence`". Matches 14's later use of
 * `StackEvidence` (its own §In scope, "Test execution" bullet): "IaC
 * adapters fire only when Terraform/CloudFormation files are detected" —
 * this detector is the thing that fact depends on.
 */
import type { StackEvidenceFinding } from "@eo/contracts";
import { findFiles, type DetectionContext, type Detector } from "./types.js";

function isTerraform(path: string): boolean {
  return path.endsWith(".tf") || path.endsWith(".tf.json");
}

function isYaml(path: string): boolean {
  return path.endsWith(".yml") || path.endsWith(".yaml");
}

function looksLikeKubernetesManifest(text: string): boolean {
  return /^apiVersion:\s*\S+/m.test(text) && /^kind:\s*\S+/m.test(text);
}

function looksLikeCloudFormation(text: string): boolean {
  return /AWSTemplateFormatVersion/.test(text) || /Transform:\s*AWS::Serverless/.test(text);
}

export const infrastructureDetector: Detector = {
  id: "infrastructure",
  detect(ctx: DetectionContext): StackEvidenceFinding[] {
    const findings: StackEvidenceFinding[] = [];
    for (const file of findFiles(ctx, isTerraform)) {
      findings.push({
        category: "infrastructure",
        ecosystem: "terraform",
        detail: "Terraform configuration present",
        path: file.relativePath,
        confidence: 0.9,
      });
    }
    for (const file of findFiles(ctx, isYaml)) {
      // CI workflow files are already YAML but belong to `ci-detector`, not
      // here — cheap exclusion so a workflow file is never double-classified
      // as a k8s manifest just because it also has `apiVersion`-shaped text.
      if (file.relativePath.startsWith(".github/workflows/")) continue;
      const text = ctx.readFile(file.relativePath);
      if (text === undefined) continue;
      if (looksLikeCloudFormation(text)) {
        findings.push({
          category: "infrastructure",
          ecosystem: "cloudformation",
          detail: "CloudFormation template present",
          path: file.relativePath,
          confidence: 0.85,
        });
      } else if (looksLikeKubernetesManifest(text)) {
        findings.push({
          category: "infrastructure",
          ecosystem: "kubernetes",
          detail: "Kubernetes manifest present",
          path: file.relativePath,
          confidence: 0.75,
        });
      }
    }
    return findings;
  },
};
