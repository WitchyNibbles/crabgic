import { describe, expect, it } from "vitest";
import { resolvePresentationProfile } from "./profile.js";

describe("resolvePresentationProfile", () => {
  it("defaults to emoji on an interactive terminal", () => {
    expect(resolvePresentationProfile({ env: {}, isTTY: true })).toBe("emoji");
  });

  it("falls back to text when the stream is not a terminal (piped, redirected, captured by a test)", () => {
    expect(resolvePresentationProfile({ env: {}, isTTY: false })).toBe("text");
  });

  it("honours CRABGIC_ASCII=1 over the TTY default", () => {
    expect(resolvePresentationProfile({ env: { CRABGIC_ASCII: "1" }, isTTY: true })).toBe("ascii");
  });

  it('ignores CRABGIC_ASCII values other than exactly "1", matching the statusline\'s own convention', () => {
    expect(resolvePresentationProfile({ env: { CRABGIC_ASCII: "0" }, isTTY: true })).toBe("emoji");
    expect(resolvePresentationProfile({ env: { CRABGIC_ASCII: "true" }, isTTY: true })).toBe(
      "emoji",
    );
  });

  it("lets an explicit CRABGIC_PRESENTATION win over every other signal", () => {
    expect(
      resolvePresentationProfile({
        env: { CRABGIC_PRESENTATION: "emoji", CRABGIC_ASCII: "1" },
        isTTY: false,
      }),
    ).toBe("emoji");
    expect(
      resolvePresentationProfile({ env: { CRABGIC_PRESENTATION: "ascii" }, isTTY: true }),
    ).toBe("ascii");
    expect(resolvePresentationProfile({ env: { CRABGIC_PRESENTATION: "text" }, isTTY: true })).toBe(
      "text",
    );
  });

  it("ignores an unrecognised CRABGIC_PRESENTATION rather than throwing — a typo must not break a command", () => {
    expect(
      resolvePresentationProfile({ env: { CRABGIC_PRESENTATION: "fancy" }, isTTY: true }),
    ).toBe("emoji");
    expect(resolvePresentationProfile({ env: { CRABGIC_PRESENTATION: "" }, isTTY: false })).toBe(
      "text",
    );
  });

  it("does not read NO_COLOR — colour and glyphs are separate concerns", () => {
    expect(resolvePresentationProfile({ env: { NO_COLOR: "1" }, isTTY: true })).toBe("emoji");
  });
});
