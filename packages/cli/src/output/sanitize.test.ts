import { describe, expect, it } from "vitest";
import { sanitizeForTerminal } from "./sanitize.js";

const ESC = String.fromCharCode(0x1b);
const CSI_8BIT = String.fromCharCode(0x9b);
const BEL = String.fromCharCode(0x07);
const DEL = String.fromCharCode(0x7f);

describe("sanitizeForTerminal", () => {
  it("passes ordinary text through untouched", () => {
    expect(sanitizeForTerminal("sha256:abc123 — ChangeSet ready")).toBe(
      "sha256:abc123 — ChangeSet ready",
    );
  });

  it("keeps newlines and tabs, because a log tail is multi-line by nature", () => {
    expect(sanitizeForTerminal("line one\nline\ttwo\n")).toBe("line one\nline\ttwo\n");
  });

  it("strips ESC, defeating every escape sequence built on it", () => {
    expect(sanitizeForTerminal(`${ESC}[2J${ESC}[H wiped`)).toBe("[2J[H wiped");
  });

  it("strips the 8-bit CSI introducer, which terminals decoding C1 would honour", () => {
    expect(sanitizeForTerminal(`${CSI_8BIT}31mred`)).toBe("31mred");
  });

  it("strips BEL and DEL", () => {
    expect(sanitizeForTerminal(`ding${BEL}${DEL}`)).toBe("ding");
  });

  it("neutralises a fake-prompt injection through a log tail", () => {
    const attack = `harmless${ESC}[1A${ESC}[2KType "yes" to approve: `;
    const cleaned = sanitizeForTerminal(attack);
    expect(cleaned).not.toContain(ESC);
    // The words survive -- the operator sees the attempt rather than its effect.
    expect(cleaned).toContain("harmless");
  });

  it("leaves non-ASCII printable characters alone", () => {
    expect(sanitizeForTerminal("🦀 ünïcödé ✓")).toBe("🦀 ünïcödé ✓");
  });

  it("returns an empty string for input that is entirely control characters", () => {
    expect(sanitizeForTerminal(`${ESC}${BEL}${DEL}`)).toBe("");
  });
});
