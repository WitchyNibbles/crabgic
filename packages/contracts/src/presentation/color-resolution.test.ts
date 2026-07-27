import { describe, expect, it } from "vitest";
import { resolveColorEnabled, resolvePresentation } from "./profile.js";

describe("resolveColorEnabled", () => {
  it("colours an interactive terminal by default", () => {
    expect(resolveColorEnabled({ env: {}, isTTY: true })).toBe(true);
  });

  it("never colours a non-terminal — no escape bytes into a pipe, a snapshot or a log file", () => {
    expect(resolveColorEnabled({ env: {}, isTTY: false })).toBe(false);
  });

  it("honours NO_COLOR however it is set, matching the statusline's existing check", () => {
    expect(resolveColorEnabled({ env: { NO_COLOR: "1" }, isTTY: true })).toBe(false);
    expect(resolveColorEnabled({ env: { NO_COLOR: "" }, isTTY: true })).toBe(false);
  });

  it("lets an explicit CRABGIC_COLOR win over NO_COLOR and over the TTY default", () => {
    expect(resolveColorEnabled({ env: { CRABGIC_COLOR: "1", NO_COLOR: "1" }, isTTY: true })).toBe(
      true,
    );
    expect(resolveColorEnabled({ env: { CRABGIC_COLOR: "0" }, isTTY: true })).toBe(false);
  });

  it("colours a non-terminal when CRABGIC_COLOR=1 forces it — the `| less -R` case", () => {
    expect(resolveColorEnabled({ env: { CRABGIC_COLOR: "1" }, isTTY: false })).toBe(true);
  });

  it("ignores an unrecognised CRABGIC_COLOR rather than throwing", () => {
    expect(resolveColorEnabled({ env: { CRABGIC_COLOR: "yes" }, isTTY: true })).toBe(true);
    expect(resolveColorEnabled({ env: { CRABGIC_COLOR: "yes" }, isTTY: false })).toBe(false);
  });
});

describe("resolvePresentation", () => {
  it("composes the profile and the colour decision into the context handlers thread through", () => {
    expect(resolvePresentation({ env: {}, isTTY: true })).toEqual({
      profile: "emoji",
      color: true,
    });
    expect(resolvePresentation({ env: {}, isTTY: false })).toEqual({
      profile: "text",
      color: false,
    });
  });

  it("keeps the two decisions independent — glyphs survive NO_COLOR", () => {
    expect(resolvePresentation({ env: { NO_COLOR: "1" }, isTTY: true })).toEqual({
      profile: "emoji",
      color: false,
    });
  });

  it("keeps colour available in the ascii profile, for a terminal with colour but no Unicode", () => {
    expect(resolvePresentation({ env: { CRABGIC_ASCII: "1" }, isTTY: true })).toEqual({
      profile: "ascii",
      color: true,
    });
  });
});
