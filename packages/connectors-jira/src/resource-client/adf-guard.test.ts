import { describe, expect, it } from "vitest";
import { ConnectorError } from "@eo/contracts";
import { assertSafeAdfDocument } from "./adf-guard.js";

/**
 * HIGH H1 (adversarial-review): every outgoing comment/description/
 * summary ADF payload must pass through `validateAdfSafeSubset` (17) —
 * this is the shared guard both the plan-build boundary
 * (`./issue-plans.ts`, `./comment-worklog-attachment-plans.ts`) and the
 * apply boundary (`./jira-mutation-apply-client.ts`) call.
 */
describe("assertSafeAdfDocument", () => {
  it("accepts a well-formed, safe-subset ADF document", () => {
    const doc = {
      type: "doc",
      version: 1,
      content: [{ type: "paragraph", content: [{ type: "text", text: "hello" }] }],
    };
    expect(assertSafeAdfDocument(doc, "test")).toBe(doc);
  });

  it("rejects a value with no recognizable ADF document shape", () => {
    expect(() => assertSafeAdfDocument("not an adf doc", "test")).toThrow(ConnectorError);
    expect(() => assertSafeAdfDocument(undefined, "test")).toThrow(ConnectorError);
    expect(() => assertSafeAdfDocument({ type: "doc" }, "test")).toThrow(ConnectorError); // missing content array
  });

  it("rejects a javascript:-href link mark", () => {
    const doc = {
      type: "doc",
      version: 1,
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "click me",
              marks: [{ type: "link", attrs: { href: "javascript:alert(1)" } }],
            },
          ],
        },
      ],
    };
    expect(() => assertSafeAdfDocument(doc, "test")).toThrow(ConnectorError);
    try {
      assertSafeAdfDocument(doc, "test");
    } catch (err) {
      expect((err as ConnectorError).kind).toBe("policy_blocked");
    }
  });

  it("rejects a disallowed node type (e.g. layoutSection)", () => {
    const doc = { type: "doc", version: 1, content: [{ type: "layoutSection", content: [] }] };
    expect(() => assertSafeAdfDocument(doc, "test")).toThrow(ConnectorError);
  });

  it("rejects a disallowed mark type", () => {
    const doc = {
      type: "doc",
      version: 1,
      content: [
        { type: "paragraph", content: [{ type: "text", text: "x", marks: [{ type: "status" }] }] },
      ],
    };
    expect(() => assertSafeAdfDocument(doc, "test")).toThrow(ConnectorError);
  });

  it("rejects an ADF document whose extracted plain text embeds a secret", () => {
    const doc = {
      type: "doc",
      version: 1,
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "here is a key: AKIAABCDEFGHIJKLMNOP" }],
        },
      ],
    };
    expect(() => assertSafeAdfDocument(doc, "test")).toThrow(ConnectorError);
  });

  it("never leaks the matched secret text in the thrown error", () => {
    const doc = {
      type: "doc",
      version: 1,
      content: [{ type: "paragraph", content: [{ type: "text", text: "AKIAABCDEFGHIJKLMNOP" }] }],
    };
    try {
      assertSafeAdfDocument(doc, "test");
      throw new Error("expected throw");
    } catch (err) {
      expect((err as ConnectorError).message).not.toContain("AKIAABCDEFGHIJKLMNOP");
    }
  });

  /**
   * MINOR-1 (adversarial-review, phase 19): this guard runs on BOTH the
   * Jira Cloud AND Jira Data Center paths (18's plan builders are reused
   * verbatim by 19's DC resource client; 19's own DC apply client
   * re-checks at the apply boundary too) — every thrown `ConnectorError`
   * must be attributed to whichever provider actually produced it, never
   * hardcoded to Cloud's `"jira-cloud"` regardless of caller.
   */
  describe("provider attribution (optional 3rd parameter, additive)", () => {
    const invalidDoc = "not an adf doc";

    it("defaults to jira-cloud when no provider is passed — phase-18 behavior is completely unchanged", () => {
      try {
        assertSafeAdfDocument(invalidDoc, "test");
        throw new Error("expected throw");
      } catch (err) {
        expect((err as ConnectorError).provider).toBe("jira-cloud");
      }
    });

    it("attributes the thrown error to an explicitly-passed provider name (e.g. jira-datacenter)", () => {
      try {
        assertSafeAdfDocument(invalidDoc, "test", "jira-datacenter");
        throw new Error("expected throw");
      } catch (err) {
        expect((err as ConnectorError).provider).toBe("jira-datacenter");
      }
    });

    it("carries the correct provider across every rejection branch (shape / safe-subset / secret-content)", () => {
      const disallowedNodeDoc = {
        type: "doc",
        version: 1,
        content: [{ type: "layoutSection", content: [] }],
      };
      const secretDoc = {
        type: "doc",
        version: 1,
        content: [{ type: "paragraph", content: [{ type: "text", text: "AKIAABCDEFGHIJKLMNOP" }] }],
      };

      for (const doc of [invalidDoc, disallowedNodeDoc, secretDoc]) {
        try {
          assertSafeAdfDocument(doc, "test", "jira-datacenter");
          throw new Error("expected throw");
        } catch (err) {
          expect((err as ConnectorError).provider).toBe("jira-datacenter");
        }
      }
    });
  });
});
