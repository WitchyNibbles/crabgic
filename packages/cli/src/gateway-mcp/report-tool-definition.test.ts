import { describe, expect, it } from "vitest";
import { DEFAULT_PRESENTATION_POLICY } from "@crabgic/contracts";
import { runReportRenderTool, REPORT_RENDER_TOOL } from "./report-tool-definition.js";

const LIMITS = DEFAULT_PRESENTATION_POLICY.limits;

/**
 * `report.render` is the manager channel's structured rendering path — the
 * affordance that makes the correct output the easy one, rather than something
 * the model has to reproduce from memory and the `Stop` gate has to police
 * afterwards.
 */
describe("report.render", () => {
  it("renders a conforming report", () => {
    const result = runReportRenderTool({
      role: "fail",
      lead: "2 of 10 checks failed.",
      sections: [{ title: "Failed", bullets: ["engine.version out of range"] }],
      nextAction: "upgrade the engine",
    });
    expect(result).toHaveProperty("markdown");
    const markdown = (result as { markdown: string }).markdown;
    expect(markdown).toContain("❌");
    expect(markdown).toContain("**2 of 10 checks failed.**");
    expect(markdown).toContain("## Failed");
    expect(markdown).toContain("**Next:** upgrade the engine");
  });

  it("needs nothing but its arguments — no deps, no I/O, no authority", () => {
    // The property that lets it be registered unconditionally: if this ever
    // needed a journal, a connection or a grant, it would belong in a gated
    // family and this test should fail rather than the gating being forgotten.
    expect(() => runReportRenderTool({ lead: "x" })).not.toThrow();
  });

  /**
   * The renderer THROWS on author-controlled prose that breaks a limit. A tool
   * that let those throws escape would 500 the gateway on a long lead — and a
   * manager that gets an error page for a wordy report learns to stop calling
   * the tool, which costs far more than the malformed report did.
   */
  it("returns the reason instead of throwing, when the report breaks a limit", () => {
    const lead = Array.from(
      { length: LIMITS.leadAnswerMaxLines + 1 },
      (_u, i) => `l${String(i)}`,
    ).join("\n");
    const result = runReportRenderTool({ lead });
    expect(result).toHaveProperty("error");
    expect((result as { error: string }).error).toMatch(/lead/i);
  });

  it("explains an over-wide title rather than failing opaquely", () => {
    const result = runReportRenderTool({
      lead: "x",
      sections: [{ title: "評".repeat(LIMITS.titleMaxColumns) }],
    });
    expect((result as { error: string }).error).toMatch(/columns/i);
  });

  it("shortens data rather than refusing it", () => {
    const result = runReportRenderTool({
      lead: "x",
      sections: [
        {
          title: "S",
          bullets: Array.from(
            { length: LIMITS.sectionMaxBullets + 2 },
            (_u, i) => `item${String(i)}`,
          ),
        },
      ],
    });
    const markdown = (result as { markdown: string }).markdown;
    expect(markdown).toContain("2 more");
    expect(markdown).not.toContain(`item${String(LIMITS.sectionMaxBullets)}`);
  });

  it("tells the caller to return the output verbatim, and when not to bother", () => {
    // The description is the only instruction the manager sees about WHEN to
    // call this. If it stops saying so, the tool exists and goes unused.
    expect(REPORT_RENDER_TOOL.description).toMatch(/return its output/i);
    expect(REPORT_RENDER_TOOL.description).toMatch(/short answers/i);
  });
});
