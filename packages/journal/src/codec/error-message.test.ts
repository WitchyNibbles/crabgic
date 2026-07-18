import { describe, expect, it } from "vitest";
import { toErrorMessage } from "./error-message.js";

describe("toErrorMessage", () => {
  it("returns .message for a real Error", () => {
    expect(toErrorMessage(new Error("boom"))).toBe("boom");
    expect(toErrorMessage(new TypeError("bad type"))).toBe("bad type");
  });

  it("returns String(err) for a non-Error thrown value", () => {
    expect(toErrorMessage("a plain string")).toBe("a plain string");
    expect(toErrorMessage(42)).toBe("42");
    expect(toErrorMessage({ code: "EBOOM" })).toBe("[object Object]");
  });
});
