import { describe, expect, it } from "vitest";
import { DEFAULT_COMMUNICATION_POLICY } from "@eo/contracts";
import { attributionNeutralStage, STAGE_NAME_ATTRIBUTION_NEUTRAL } from "./attribution-neutral.js";
import type { LintStageInput } from "./lint-types.js";

function stageInput(candidate: string): LintStageInput {
  return { candidate, kind: "commit_body", policy: DEFAULT_COMMUNICATION_POLICY };
}

describe("attributionNeutralStage", () => {
  it("blocks the seeded 'Generated with...'/'Co-Authored-By' fixture (shared with 08)", () => {
    const findings = attributionNeutralStage(
      stageInput(
        "fix: correct the parser\n\n🤖 Generated with Claude Code\nCo-Authored-By: Claude <noreply@anthropic.com>",
      ),
    );
    expect(findings.length).toBeGreaterThan(0);
    expect(findings.every((f) => f.stage === STAGE_NAME_ATTRIBUTION_NEUTRAL)).toBe(true);
    expect(findings.some((f) => f.message.match(/Generated with/i))).toBe(true);
    expect(findings.some((f) => f.message.match(/Co-Authored-By/i))).toBe(true);
  });

  it("blocks first-person voice", () => {
    const findings = attributionNeutralStage(
      stageInput("I fixed the bug because we needed it working."),
    );
    expect(findings.some((f) => f.message.match(/first-person/i))).toBe(true);
  });

  it("blocks a sign-off closing", () => {
    const findings = attributionNeutralStage(stageInput("done.\n\nRegards,\nThe Team"));
    expect(findings.some((f) => f.message.match(/sign-off/i))).toBe(true);
  });

  it("blocks an engine-name credit", () => {
    const findings = attributionNeutralStage(stageInput("Built using Anthropic's Claude."));
    expect(findings.some((f) => f.message.match(/engine\/vendor name/i))).toBe(true);
  });

  it("allows clean neutral text", () => {
    expect(
      attributionNeutralStage(stageInput("Corrects the off-by-one error in the pagination loop.")),
    ).toEqual([]);
  });

  it("still blocks a lone '--' signature delimiter on its own line (L1)", () => {
    const findings = attributionNeutralStage(stageInput("done.\n--\nSent from my iPhone"));
    expect(findings.some((f) => f.message.match(/sign-off/i))).toBe(true);
  });

  it("does NOT false-block a unified-diff header ('--- a/file') — L1 adversarial-review finding", () => {
    const text = "Outcome: applied the patch below\n--- a/src/index.ts\n+++ b/src/index.ts";
    expect(attributionNeutralStage(stageInput(text))).toEqual([]);
  });

  it("does NOT false-block a markdown horizontal rule ('---') — L1 adversarial-review finding", () => {
    const text = "Section one.\n\n---\n\nSection two.";
    expect(attributionNeutralStage(stageInput(text))).toEqual([]);
  });
});
