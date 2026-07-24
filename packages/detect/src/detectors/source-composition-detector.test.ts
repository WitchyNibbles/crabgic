import { describe, expect, it } from "vitest";
import { ctxFromFiles } from "../test-support/detection-context.js";
import { sourceCompositionDetector } from "./source-composition-detector.js";

describe("sourceCompositionDetector", () => {
  it("counts recognized source extensions per ecosystem", () => {
    const findings = sourceCompositionDetector.detect(
      ctxFromFiles({
        "a.ts": "",
        "b.ts": "",
        "c.py": "",
      }),
    );
    const byEcosystem = Object.fromEntries(findings.map((f) => [f.ecosystem, f.detail]));
    expect(byEcosystem["node"]).toContain("2 source file");
    expect(byEcosystem["python"]).toContain("1 source file");
  });

  it("gives higher confidence once a threshold of files is reached", () => {
    const files: Record<string, string> = {};
    for (let i = 0; i < 6; i += 1) files[`f${String(i)}.rs`] = "";
    const findings = sourceCompositionDetector.detect(ctxFromFiles(files));
    expect(findings[0]?.confidence).toBe(0.85);
  });

  it("ignores unrecognized extensions and extensionless files", () => {
    const findings = sourceCompositionDetector.detect(
      ctxFromFiles({ "README.md": "", LICENSE: "", ".gitignore": "" }),
    );
    expect(findings).toEqual([]);
  });
});
