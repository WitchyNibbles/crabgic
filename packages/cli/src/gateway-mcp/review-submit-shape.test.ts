import { z } from "zod";
import { describe, expect, it } from "vitest";
import { REVIEW_SUBMIT_TOOL } from "../review/tool-definitions.js";
import { REVIEW_SUBMIT_SHAPE } from "./build-tool-registry.js";

/**
 * ⚠️ TWO SCHEMAS FOR ONE TOOL, pinned against each other.
 *
 * `review.submit` is declared twice: `../review/tool-definitions.ts` publishes the
 * JSON-Schema descriptor a caller READS, and `./build-tool-registry.ts` declares
 * the zod shape the MCP SDK VALIDATES against. Nothing made them agree, and they
 * did not.
 *
 * Measured driving owner ruling R7's staged run: `design` and `plan` were declared
 * `z.unknown()`, which under zod 4 is NOT optional, so the SDK derived them as
 * REQUIRED while the descriptor listed only `stage`/`changeSetId`/`verdict`. Every
 * caller that obeyed the published contract was refused, and the `research` stage —
 * which runs four stages before a design exists — could not record a verdict at
 * all. Defect
 * `docs/evidence/criteria-closeout/defects/25-review-submit-requires-a-design-it-cannot-have.md`.
 *
 * This is the same failure `WorkerAuthoredResultSchema`'s own docblock records one
 * surface over — a published contract and an enforced contract disagreeing, with
 * every obedient caller rejected. That one was found by a real run too.
 */

/**
 * The members the SDK will actually require, derived by parsing an EMPTY object
 * and collecting the keys zod complains about.
 *
 * ⚠️ Not by calling `schema.safeParse(undefined)` per member — that was this
 * test's first draft and it was wrong in the direction that matters: a bare
 * `z.unknown()` ACCEPTS `undefined` standalone and REJECTS a missing key inside
 * an object. The per-member version therefore reported nothing as required and
 * would have passed against the very shape that carried the defect. Measured,
 * not reasoned: `z.unknown().safeParse(undefined)` succeeds, while
 * `z.object({ a: z.unknown() }).safeParse({})` reports an issue at path `a`.
 */
function zodRequiredKeys(shape: Record<string, z.ZodTypeAny>): readonly string[] {
  const parsed = z.object(shape).safeParse({});
  if (parsed.success) return [];
  return [...new Set(parsed.error.issues.map((issue) => String(issue.path[0])))].sort();
}

/**
 * The descriptor's `required` list is typed loosely on `McpToolDefinition`, so it
 * is narrowed here rather than asserted through — a cast that hid a missing
 * `required` would make this whole file compare against an empty list and pass.
 */
const descriptorRequired = [
  ...((REVIEW_SUBMIT_TOOL.inputSchema as { readonly required?: readonly string[] }).required ?? []),
].sort();
const shapeRequired = zodRequiredKeys(REVIEW_SUBMIT_SHAPE as Record<string, z.ZodTypeAny>);

describe("review.submit's published descriptor and its validated shape", () => {
  /** The whole point. A member required by one and optional by the other is a caller refused for obeying the contract. */
  it("require EXACTLY the same members", () => {
    expect(shapeRequired).toStrictEqual(descriptorRequired);
  });

  /**
   * Asserted by NAME as well as by set equality, so the test says what the
   * contract is rather than only that two lists match — two lists can agree by
   * both being wrong.
   */
  it("require stage, changeSetId and verdict, and nothing else", () => {
    expect(descriptorRequired).toStrictEqual(["changeSetId", "stage", "verdict"]);
  });

  /**
   * ⚠️ THE REGRESSION, stated as the behaviour rather than as the spelling: a
   * stage with no design and no plan must be able to submit. `research` is the
   * first stage the pipeline runs and it has neither.
   */
  it("accept a submission that omits design and plan — the shape every pre-design stage has", () => {
    const parsed = z
      .object(REVIEW_SUBMIT_SHAPE as Record<string, z.ZodTypeAny>)
      .safeParse({ stage: "research", changeSetId: "cs", verdict: { verdict: "approve" } });
    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
  });

  /**
   * The anti-vacuity partner: the test above would also pass if the shape
   * required nothing at all. A submission with no verdict must still be refused.
   */
  it("still refuse a submission with no verdict", () => {
    const parsed = z
      .object(REVIEW_SUBMIT_SHAPE as Record<string, z.ZodTypeAny>)
      .safeParse({ stage: "research", changeSetId: "cs" });
    expect(parsed.success).toBe(false);
  });

  /**
   * ⚠️ Every member a caller must send as JSON must SAY it is an object on the
   * wire. `z.unknown()` emits `{}` — an untyped member — and a client with no
   * type signal may serialize it as text: two independent agents driving owner
   * ruling R7's staged run hit "invalid review verdict: expected object,
   * received string" and both abandoned the MCP tool for hand-built JSON-RPC.
   * Defect `25-untyped-wire-members-serialize-as-text.md`.
   */
  it("advertises every structured member as type object, never as an untyped {}", () => {
    const emitted = z.toJSONSchema(z.object(REVIEW_SUBMIT_SHAPE as Record<string, z.ZodTypeAny>), {
      io: "input",
    }) as { readonly properties: Record<string, { readonly type?: string }> };
    for (const member of ["verdict", "design", "plan"]) {
      expect(emitted.properties[member]?.type, `${member} is untyped on the wire`).toBe("object");
    }
    // The array's ITEMS carry the type; the member itself is an array.
    const attestations = emitted.properties["attestations"] as
      { readonly type?: string; readonly items?: { readonly type?: string } } | undefined;
    expect(attestations?.type).toBe("array");
    expect(attestations?.items?.type).toBe("object");
  });

  /**
   * Pins the zod-4 behaviour this defect turned on, so a future reader does not
   * have to rediscover it: a bare `z.unknown()` is REQUIRED, and only
   * `.optional()` makes it optional. If a zod upgrade ever changes this, the
   * change announces itself here rather than in a refused review round.
   */
  it("documents that a bare z.unknown() is required INSIDE AN OBJECT under this zod version", () => {
    // The distinction the first draft of this file got wrong, pinned so nobody
    // re-derives it: optional standalone, required as an object member.
    expect(z.unknown().safeParse(undefined).success).toBe(true);
    expect(z.object({ a: z.unknown() }).safeParse({}).success).toBe(false);
    expect(z.object({ a: z.unknown().optional() }).safeParse({}).success).toBe(true);
  });
});
