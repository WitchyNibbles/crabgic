import { describe, expect, it } from "vitest";
import { DEFAULT_COMMUNICATION_POLICY } from "@crabgic/contracts";
import { STAGE_NAME_URL_POLICY, urlPolicyStage } from "./url-policy.js";
import type { LintStageInput } from "./lint-types.js";

function stageInput(candidate: string): LintStageInput {
  return { candidate, kind: "pr_body", policy: DEFAULT_COMMUNICATION_POLICY };
}

describe("urlPolicyStage", () => {
  it("blocks a <script> tag in a PR body (failing-first fixture)", () => {
    const findings = urlPolicyStage(stageInput("Outcome: done <script>alert(1)</script>"));
    expect(findings.length).toBeGreaterThan(0);
    expect(findings[0]!.stage).toBe(STAGE_NAME_URL_POLICY);
    expect(findings[0]!.message).toMatch(/raw HTML tag/i);
  });

  it("blocks a data: URL in a Grafana-annotation-shaped fixture", () => {
    const findings = urlPolicyStage({
      candidate: "state | service | change | evidence=data:text/html;base64,abcd",
      kind: "grafana_annotation",
      policy: DEFAULT_COMMUNICATION_POLICY,
    });
    expect(findings.some((f) => f.message.match(/disallowed URL scheme "data:"/i))).toBe(true);
  });

  it("blocks a javascript: URL", () => {
    const findings = urlPolicyStage(stageInput("click [here](javascript:alert(1))"));
    expect(findings.some((f) => f.message.match(/disallowed URL scheme "javascript:"/i))).toBe(
      true,
    );
  });

  it("blocks an embedded remote image", () => {
    const findings = urlPolicyStage(stageInput("see ![screenshot](https://evil.example/x.png)"));
    expect(findings.some((f) => f.message.match(/embedded remote image/i))).toBe(true);
  });

  // The SECOND notation. Phase 19 puts Jira wiki markup on the wire for Data
  // Center, so an image-blocking stage that knows only the markdown notation
  // is blind in the format DC actually consumes. Each case below linted clean
  // before `WIKI_IMAGE_PATTERN` existed.
  it.each([
    ["a bare wiki image URL", "Outcome: see !https://evil.example/x.png!"],
    ["a wiki image filename", "Outcome: see !payload.png!"],
    ["a wiki image with a params tail", "Outcome: see !https://evil.example/x.png|thumbnail!"],
    ["an http-scheme wiki image", "Outcome: see !http://evil.example/x.gif!"],
  ])("blocks an embedded remote image in wiki-markup notation: %s", (_name, candidate) => {
    const findings = urlPolicyStage(stageInput(candidate));
    expect(findings.some((f) => f.message.match(/embedded remote image/i))).toBe(true);
  });

  // The controls that keep the pattern from being a prose-exclamation trap.
  // Without these, widening the stage would block ordinary text and the
  // widening would read as "stricter" when it was simply wrong.
  it.each([
    ["a plain exclamation", "Outcome: shipped! Validation: none"],
    ["two exclamations spanning a sentence", "Outcome: wow! really! Validation: none"],
    ["an exclamation followed by a filename word", "Outcome: done! see notes"],
    ["a non-image extension between delimiters", "Outcome: see !styles.css!"],
  ])("does not flag %s as an embedded remote image", (_name, candidate) => {
    const findings = urlPolicyStage(stageInput(candidate));
    expect(findings.some((f) => f.message.match(/embedded remote image/i))).toBe(false);
  });

  it("blocks a slash-delimited-attribute XSS tag with no whitespace before attrs (<svg/onload=...>) — M1 adversarial-review fixture", () => {
    const findings = urlPolicyStage(stageInput("Outcome: done <svg/onload=alert(1)>"));
    expect(findings.some((f) => f.message.match(/raw HTML tag/i))).toBe(true);
  });

  it("blocks a slash-delimited-attribute XSS tag (<img/src=x onerror=y>) — M1 adversarial-review fixture", () => {
    const findings = urlPolicyStage(stageInput("Outcome: done <img/src=x onerror=y>"));
    expect(findings.some((f) => f.message.match(/raw HTML tag/i))).toBe(true);
  });

  it("blocks a non-allowlisted scheme (plain http)", () => {
    const findings = urlPolicyStage(stageInput("see http://example.com/evidence"));
    expect(findings.some((f) => f.message.match(/not on the allowlist/i))).toBe(true);
  });

  it("allows an https link", () => {
    expect(urlPolicyStage(stageInput("Outcome: see https://example.com/evidence/123"))).toEqual([]);
  });

  it("allows plain text with no URLs or tags", () => {
    expect(
      urlPolicyStage(
        stageInput("Outcome: done\nValidation: tests green\nRisk: none\nTracking: none"),
      ),
    ).toEqual([]);
  });
});
