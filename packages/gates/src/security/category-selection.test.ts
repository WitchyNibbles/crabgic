import { describe, expect, it } from "vitest";
import { buildStackEvidence } from "@eo/testkit";
import { selectApplicableSecurityCategories } from "./category-selection.js";

describe("selectApplicableSecurityCategories — StackEvidence-driven category gating", () => {
  it("a pure-Go fixture repo never invokes a JS-specific SAST ruleset", () => {
    const evidence = buildStackEvidence({
      findings: [
        {
          category: "manifest",
          ecosystem: "go",
          detail: "go.mod present",
          path: "go.mod",
          confidence: 0.9,
        },
      ],
    });
    const categories = selectApplicableSecurityCategories(evidence);
    expect(categories.jsSast).toBe(false);
    // Ecosystem-agnostic categories still apply.
    expect(categories.gitleaks).toBe(true);
    expect(categories.osvScanner).toBe(true);
    expect(categories.iac).toBe(false);
  });

  it("Node evidence enables the JS-specific SAST category", () => {
    const evidence = buildStackEvidence({
      findings: [
        {
          category: "manifest",
          ecosystem: "node",
          detail: "package.json present",
          path: "package.json",
          confidence: 0.9,
        },
      ],
    });
    expect(selectApplicableSecurityCategories(evidence).jsSast).toBe(true);
  });

  it("IaC adapters fire only when Terraform/CloudFormation is detected", () => {
    const evidence = buildStackEvidence({
      findings: [
        {
          category: "infrastructure",
          ecosystem: "terraform",
          detail: "main.tf present (terraform)",
          path: "infra/main.tf",
          confidence: 0.9,
        },
      ],
    });
    expect(selectApplicableSecurityCategories(evidence).iac).toBe(true);
  });

  it("an infrastructure finding unrelated to Terraform/CloudFormation does not enable IaC", () => {
    const evidence = buildStackEvidence({
      findings: [
        {
          category: "infrastructure",
          ecosystem: "kubernetes",
          detail: "kustomization.yaml present",
          path: "k8s/kustomization.yaml",
          confidence: 0.9,
        },
      ],
    });
    expect(selectApplicableSecurityCategories(evidence).iac).toBe(false);
  });
});
