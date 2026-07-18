import { describe, expect, it } from "vitest";
import { generateAttemptToken } from "./attempt-token.js";

describe("generateAttemptToken", () => {
  it("matches the chosen att-<ts>-<hex> format (valid git ref segment charset)", () => {
    const token = generateAttemptToken();
    expect(token).toMatch(/^att-[0-9a-z]+-[0-9a-f]{8}$/);
  });

  it("two calls with the same injected clock never collide (randomness disambiguates)", () => {
    const fixedClock = () => 1_700_000_000_000;
    const tokens = new Set(Array.from({ length: 200 }, () => generateAttemptToken(fixedClock)));
    expect(tokens.size).toBe(200);
  });

  it("real, un-injected calls never collide across a burst", () => {
    const tokens = new Set(Array.from({ length: 500 }, () => generateAttemptToken()));
    expect(tokens.size).toBe(500);
  });
});
