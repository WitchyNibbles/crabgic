import { describe, expect, it, vi } from "vitest";
import { DEFAULT_COMMUNICATION_POLICY } from "@eo/contracts";
import { renderWithRegeneration } from "./render-with-regeneration.js";

describe("renderWithRegeneration", () => {
  it("renders on the first attempt when the candidate is already clean", async () => {
    const generate = vi.fn().mockResolvedValue("fix: correct the off-by-one error");
    const outcome = await renderWithRegeneration({
      kind: "commit_subject",
      generate,
      policy: DEFAULT_COMMUNICATION_POLICY,
    });
    expect(outcome.status).toBe("rendered");
    if (outcome.status === "rendered") {
      expect(outcome.artifact.content).toBe("fix: correct the off-by-one error");
      expect(outcome.artifact.kind).toBe("commit_subject");
      expect(typeof outcome.artifact.id).toBe("string");
    }
    expect(generate).toHaveBeenCalledTimes(1);
    expect(generate).toHaveBeenCalledWith();
  });

  it("scripted fail-then-pass generator yields status:'rendered' (work item 8 failing-first)", async () => {
    const generate = vi
      .fn()
      .mockResolvedValueOnce("🤖 Generated with Claude Code")
      .mockResolvedValueOnce("fix: correct the off-by-one error");
    const outcome = await renderWithRegeneration({
      kind: "commit_subject",
      generate,
      policy: DEFAULT_COMMUNICATION_POLICY,
    });
    expect(outcome.status).toBe("rendered");
    if (outcome.status === "rendered") {
      expect(outcome.artifact.content).toBe("fix: correct the off-by-one error");
    }
    expect(generate).toHaveBeenCalledTimes(2);
    // Second call receives the first attempt's findings as feedback.
    const secondCallArgs = generate.mock.calls[1]!;
    expect(Array.isArray(secondCallArgs[0])).toBe(true);
    expect((secondCallArgs[0] as unknown[]).length).toBeGreaterThan(0);
  });

  it("always-fails generator blocks on exactly the second attempt, never a third", async () => {
    const generate = vi.fn().mockResolvedValue("🤖 Generated with Claude Code");
    const outcome = await renderWithRegeneration({
      kind: "commit_subject",
      generate,
      policy: DEFAULT_COMMUNICATION_POLICY,
    });
    expect(outcome.status).toBe("blocked");
    if (outcome.status === "blocked") {
      expect(outcome.error).toBe("policy_blocked");
      expect(outcome.findings.length).toBeGreaterThan(0);
    }
    expect(generate).toHaveBeenCalledTimes(2);
  });

  it("supports a synchronous (non-Promise) generator", async () => {
    const generate = () => "fix: correct the parser";
    const outcome = await renderWithRegeneration({
      kind: "commit_subject",
      generate,
      policy: DEFAULT_COMMUNICATION_POLICY,
    });
    expect(outcome.status).toBe("rendered");
  });

  it("lints the exact bytes it stores — normalizes BEFORE linting, not after (L2 adversarial-review fixture)", async () => {
    // Decomposed "e" + COMBINING ACUTE ACCENT (U+0301) — 2 codepoints raw,
    // composes to a single "é" (1 codepoint) under NFC.
    const decomposedE = "é";
    // "x" + 32 decomposed pairs = 65 raw chars, ONE OVER the branch_name
    // 64-char limit; the NFC-composed form is only 33 chars, well under it.
    const raw = "x" + decomposedE.repeat(32);
    const normalized = raw.normalize("NFC");
    expect(raw.length).toBe(65);
    expect(normalized.length).toBe(33);

    const generate = vi.fn().mockResolvedValue(raw);
    const outcome = await renderWithRegeneration({
      kind: "branch_name",
      generate,
      policy: DEFAULT_COMMUNICATION_POLICY,
    });

    // Correct behavior: normalize FIRST, then lint (and store) that exact
    // normalized string — the 33-char normalized form is well within the
    // 64-char limit, so this must render on the FIRST attempt, and the
    // stored content must be byte-identical to what was actually validated.
    expect(outcome.status).toBe("rendered");
    if (outcome.status === "rendered") {
      expect(outcome.artifact.content).toBe(normalized);
    }
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it("uses the injected clock for renderedAt", async () => {
    const fixedNow = new Date("2026-07-23T00:00:00.000Z");
    const outcome = await renderWithRegeneration({
      kind: "commit_subject",
      generate: () => "fix: correct the parser",
      policy: DEFAULT_COMMUNICATION_POLICY,
      now: () => fixedNow,
    });
    expect(outcome.status).toBe("rendered");
    if (outcome.status === "rendered") {
      expect(outcome.artifact.renderedAt).toBe("2026-07-23T00:00:00.000Z");
    }
  });
});
