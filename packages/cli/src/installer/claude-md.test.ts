import { describe, expect, it } from "vitest";
import { buildClaudeMdManagedBlockContent, mergeClaudeMd } from "./claude-md.js";

describe("buildClaudeMdManagedBlockContent", () => {
  it("uses the @AGENTS.md bridge form (adaptation §6.2) when the target repo has an AGENTS.md", () => {
    expect(buildClaudeMdManagedBlockContent(true)).toBe("@AGENTS.md");
  });

  it("uses the full instructions otherwise", () => {
    expect(buildClaudeMdManagedBlockContent(false)).toContain("Engineering Orchestrator");
    expect(buildClaudeMdManagedBlockContent(false)).not.toBe("@AGENTS.md");
  });
});

describe("mergeClaudeMd", () => {
  it("creates a new CLAUDE.md with the bridge form when AGENTS.md exists", () => {
    const result = mergeClaudeMd(undefined, true);
    expect(result.content).toContain("@AGENTS.md");
  });

  it("preserves a pre-existing CLAUDE.md's own content", () => {
    const result = mergeClaudeMd("# My own instructions\n", false);
    expect(result.content).toContain("My own instructions");
  });
});
