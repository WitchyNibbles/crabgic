import { describe, expect, it } from "vitest";
import { buildBasicAuthHeader } from "./basicAuth.js";

describe("buildBasicAuthHeader", () => {
  it("encodes user:password exactly as RFC 7617 specifies", () => {
    // Asserted against the LITERAL expected encoding, never against a
    // re-computation of the same expression, which would be self-cancelling.
    expect(buildBasicAuthHeader("admin:admin")).toBe("Basic YWRtaW46YWRtaW4=");
  });

  it("tolerates surrounding whitespace from a file/exec secret backend", () => {
    expect(buildBasicAuthHeader("  admin:admin\n")).toBe("Basic YWRtaW46YWRtaW4=");
  });

  it("refuses an empty resolved credential rather than sending 'Basic Og=='", () => {
    expect(() => buildBasicAuthHeader("   ")).toThrow(/empty/i);
  });

  it("refuses a credential with no ':' separator rather than sending a half-formed header", () => {
    expect(() => buildBasicAuthHeader("admin")).toThrow(/user:password/);
  });
});
