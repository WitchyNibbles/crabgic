import type { StackEvidence } from "@eo/contracts";
import { ecosystemsPresent } from "../coverage/adapter-selection.js";

/**
 * `StackEvidence`-driven security-gate CATEGORY selection — roadmap/14 §In
 * scope, "Test execution" bullet: "no JS-specific SAST ruleset fires
 * without Node evidence; IaC adapters fire only when Terraform/
 * CloudFormation files are detected." Secret-scanning (gitleaks) and
 * dependency/license scanning (osv-scanner) are ecosystem-agnostic — a
 * planted secret or a vulnerable manifest entry is a risk regardless of
 * which language ecosystem is present, so those two categories are always
 * applicable and are not gated by this module.
 */
export interface ApplicableSecurityCategories {
  readonly jsSast: boolean;
  readonly gitleaks: boolean;
  readonly osvScanner: boolean;
  readonly iac: boolean;
}

const IAC_MARKER_RE = /terraform|cloudformation/i;

export function selectApplicableSecurityCategories(
  stackEvidence: StackEvidence,
): ApplicableSecurityCategories {
  const ecosystems = ecosystemsPresent(stackEvidence);
  const jsSast =
    ecosystems.has("node") || ecosystems.has("javascript") || ecosystems.has("typescript");
  const iac = stackEvidence.findings.some(
    (f) => f.category === "infrastructure" && IAC_MARKER_RE.test(`${f.detail} ${f.path}`),
  );
  return { jsSast, gitleaks: true, osvScanner: true, iac };
}
