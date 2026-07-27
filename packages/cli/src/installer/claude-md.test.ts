import { describe, expect, it } from "vitest";
import { buildManagerProtocolBlock, QUESTION_TOOL_NAME } from "@crabgic/plugin";
import { buildClaudeMdManagedBlockContent, mergeClaudeMd, AGENTS_MD_BRIDGE } from "./claude-md.js";

/**
 * BEHAVIOR CHANGE, 2026-07-27 — recorded here because this file previously
 * asserted the opposite, and a future reader should not "restore" it.
 *
 * The bridge form used to REPLACE the entire managed block: with an
 * `AGENTS.md` present, the block was the single line `@AGENTS.md` and nothing
 * else. Adaptation §6.2's rationale for that is "one source of truth per repo;
 * no dual-engine obligation" — i.e. do not duplicate THE REPO'S OWN
 * instructions into `CLAUDE.md`. It was never a reason to drop CRABGIC's
 * instructions, which appear in no `AGENTS.md` anywhere and have no other
 * delivery path into the manager session.
 *
 * The consequence was a live defect: in a consuming repo with an `AGENTS.md`,
 * the manager session received no operating protocol at all, fell back to
 * Claude Code's conversational default, and asked the owner to type "continue"
 * after every step. The bridge is now ADDITIVE — the import line still carries
 * the repo's own content exactly once, and Crabgic's block ships alongside it.
 */
describe("buildClaudeMdManagedBlockContent", () => {
  describe("without an AGENTS.md", () => {
    const content = buildClaudeMdManagedBlockContent(false);

    it("carries the Crabgic heading and the manager operating protocol", () => {
      expect(content).toContain("Crabgic");
      expect(content).toContain(buildManagerProtocolBlock());
    });

    it("does not emit the bridge import", () => {
      expect(content).not.toContain(AGENTS_MD_BRIDGE);
    });
  });

  describe("with an AGENTS.md", () => {
    const content = buildClaudeMdManagedBlockContent(true);

    it("still carries the full operating protocol — the bridge no longer replaces it", () => {
      expect(content).toContain(buildManagerProtocolBlock());
    });

    it("emits the @AGENTS.md import exactly once, so the repo's own content is not duplicated", () => {
      expect(content.split(AGENTS_MD_BRIDGE)).toHaveLength(2);
    });

    it("is not the bare bridge line it used to be", () => {
      expect(content).not.toBe(AGENTS_MD_BRIDGE);
    });
  });

  it("differs between the two forms only by the bridge import", () => {
    const withAgents = buildClaudeMdManagedBlockContent(true);
    const withoutAgents = buildClaudeMdManagedBlockContent(false);
    expect(withAgents).not.toBe(withoutAgents);
    expect(withAgents).toContain(AGENTS_MD_BRIDGE);
    expect(withoutAgents).not.toContain(AGENTS_MD_BRIDGE);
  });

  it("mandates the structured question tool in both forms", () => {
    // The two defects this block exists to fix must be addressed whether or
    // not the target repo happens to keep an AGENTS.md.
    for (const hasAgentsMd of [true, false]) {
      const content = buildClaudeMdManagedBlockContent(hasAgentsMd);
      expect(content, `hasAgentsMd=${hasAgentsMd}`).toContain(QUESTION_TOOL_NAME);
      expect(content, `hasAgentsMd=${hasAgentsMd}`).toMatch(/never ask/i);
    }
  });

  it("is deterministic — the installer merge is byte-preserving and drift-detected", () => {
    expect(buildClaudeMdManagedBlockContent(true)).toBe(buildClaudeMdManagedBlockContent(true));
    expect(buildClaudeMdManagedBlockContent(false)).toBe(buildClaudeMdManagedBlockContent(false));
  });
});

describe("mergeClaudeMd", () => {
  it("creates a new CLAUDE.md carrying both the bridge and the protocol when AGENTS.md exists", () => {
    const result = mergeClaudeMd(undefined, true);
    expect(result.content).toContain(AGENTS_MD_BRIDGE);
    expect(result.content).toContain(QUESTION_TOOL_NAME);
  });

  it("preserves a pre-existing CLAUDE.md's own content", () => {
    const result = mergeClaudeMd("# My own instructions\n", false);
    expect(result.content).toContain("My own instructions");
  });

  it("still installs the protocol alongside a pre-existing CLAUDE.md", () => {
    const result = mergeClaudeMd("# My own instructions\n", false);
    expect(result.content).toContain("My own instructions");
    expect(result.content).toContain(buildManagerProtocolBlock());
  });
});
