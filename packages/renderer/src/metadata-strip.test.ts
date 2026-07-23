import { describe, expect, it } from "vitest";
import { DEFAULT_COMMUNICATION_POLICY } from "@eo/contracts";
import { metadataStripStage, STAGE_NAME_METADATA_STRIP } from "./metadata-strip.js";
import type { LintStageInput } from "./lint-types.js";

function stageInput(candidate: string): LintStageInput {
  return { candidate, kind: "commit_body", policy: DEFAULT_COMMUNICATION_POLICY };
}

describe("metadataStripStage", () => {
  it("blocks a Co-Authored-By trailer", () => {
    const findings = metadataStripStage(stageInput("fix bug\n\nCo-Authored-By: Someone <s@example.com>"));
    expect(findings.length).toBe(1);
    expect(findings[0]!.stage).toBe(STAGE_NAME_METADATA_STRIP);
    expect(findings[0]!.severity).toBe("block");
  });

  it("blocks a Signed-off-by trailer", () => {
    expect(metadataStripStage(stageInput("body\nSigned-off-by: a <a@b.com>")).length).toBe(1);
  });

  it("blocks Author/Committer/Date/Change-Id trailers", () => {
    for (const key of ["Author", "Committer", "Date", "Change-Id"]) {
      const findings = metadataStripStage(stageInput(`body\n${key}: value`));
      expect(findings.length).toBe(1);
    }
  });

  it("is case-insensitive on the trailer key", () => {
    expect(metadataStripStage(stageInput("body\nco-authored-by: x")).length).toBe(1);
  });

  it("allows clean text with no trailers", () => {
    expect(metadataStripStage(stageInput("fix: correct the off-by-one error"))).toEqual([]);
  });

  it("does not false-positive on unrelated 'Author' mid-sentence text", () => {
    expect(metadataStripStage(stageInput("The Author field in this schema is required."))).toEqual([]);
  });
});
