import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  buildAuthorizationEnvelope,
  hashEnvelopeContent,
  type AuthorizationEnvelopeContent,
} from "./envelope-builder.js";

const ID = "11111111-1111-4111-8111-111111111111";
const CHANGE_SET_ID = "22222222-2222-4222-8222-222222222222";
const CREATED_AT = "2026-01-01T00:00:00.000Z";

function baseContent(): AuthorizationEnvelopeContent {
  return {
    ownedPaths: ["packages/example/src/"],
    commands: ["npm test"],
    networkDestinations: ["api.example.com"],
    credentialReferences: ["secret-ref:example"],
    dependencies: ["left-pad"],
    remoteResourceAuthorizations: [
      { reference: "PROJ-123", highImpactFlags: ["closing transitions"] },
    ],
    temporaryServices: ["postgres:16"],
    prohibitedActions: ["force-push main"],
    provisionalBudgetHash: "sha256:fixture-provisional-budget-hash",
  };
}

describe("buildAuthorizationEnvelope", () => {
  it("produces a schema-valid envelope", () => {
    const envelope = buildAuthorizationEnvelope({
      id: ID,
      changeSetId: CHANGE_SET_ID,
      createdAt: CREATED_AT,
      content: baseContent(),
    });
    expect(envelope.id).toBe(ID);
    expect(envelope.changeSetId).toBe(CHANGE_SET_ID);
    expect(envelope.canonicalHash).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it("two builds of an identical fixture produce byte-identical envelope hashes", () => {
    const first = buildAuthorizationEnvelope({
      id: ID,
      changeSetId: CHANGE_SET_ID,
      createdAt: CREATED_AT,
      content: baseContent(),
    });
    const second = buildAuthorizationEnvelope({
      id: ID,
      changeSetId: CHANGE_SET_ID,
      createdAt: CREATED_AT,
      content: baseContent(),
    });
    expect(first.canonicalHash).toBe(second.canonicalHash);
    expect(first).toEqual(second);
  });

  it("a one-field mutation changes the hash", () => {
    const original = buildAuthorizationEnvelope({
      id: ID,
      changeSetId: CHANGE_SET_ID,
      createdAt: CREATED_AT,
      content: baseContent(),
    });
    const mutated = buildAuthorizationEnvelope({
      id: ID,
      changeSetId: CHANGE_SET_ID,
      createdAt: CREATED_AT,
      content: { ...baseContent(), prohibitedActions: ["force-push main", "delete branch"] },
    });
    expect(mutated.canonicalHash).not.toBe(original.canonicalHash);
  });

  it("an ABSENT turn budget and the explicit default are the SAME authorization content", () => {
    // The builder resolves absence to `DEFAULT_MAX_TURNS_PER_ATTEMPT` before
    // hashing, so "asked for nothing" and "asked for 40 explicitly" cannot
    // land on different hashes and spuriously invalidate an approval token.
    const absent = buildAuthorizationEnvelope({
      id: ID,
      changeSetId: CHANGE_SET_ID,
      createdAt: CREATED_AT,
      content: baseContent(),
    });
    const explicit = buildAuthorizationEnvelope({
      id: ID,
      changeSetId: CHANGE_SET_ID,
      createdAt: CREATED_AT,
      content: { ...baseContent(), maxTurnsPerAttempt: 40 },
    });
    expect(absent.maxTurnsPerAttempt).toBe(40);
    expect(explicit.canonicalHash).toBe(absent.canonicalHash);
  });

  it("a DIFFERENT turn budget is a material change: new hash, prior token naturally invalid", () => {
    const forty = buildAuthorizationEnvelope({
      id: ID,
      changeSetId: CHANGE_SET_ID,
      createdAt: CREATED_AT,
      content: baseContent(),
    });
    const eighty = buildAuthorizationEnvelope({
      id: ID,
      changeSetId: CHANGE_SET_ID,
      createdAt: CREATED_AT,
      content: { ...baseContent(), maxTurnsPerAttempt: 80 },
    });
    expect(eighty.maxTurnsPerAttempt).toBe(80);
    expect(eighty.canonicalHash).not.toBe(forty.canonicalHash);
  });

  it("LEDGER GAP 22 — the provisional budget binding is COVERED by the canonical hash: two contents identical but for it hash differently", () => {
    // The whole point of the axis: the approval token signs `canonicalHash`,
    // so unless the budget binding is inside that digest the human's signature
    // says nothing about which budget set may be enforced. Red before the
    // member was hashed — `hashEnvelopeContent` did not read it, so budget A
    // and budget B produced the SAME approval hash.
    const overBudgetA = buildAuthorizationEnvelope({
      id: ID,
      changeSetId: CHANGE_SET_ID,
      createdAt: CREATED_AT,
      content: { ...baseContent(), provisionalBudgetHash: "sha256:budget-a" },
    });
    const overBudgetB = buildAuthorizationEnvelope({
      id: ID,
      changeSetId: CHANGE_SET_ID,
      createdAt: CREATED_AT,
      content: { ...baseContent(), provisionalBudgetHash: "sha256:budget-b" },
    });
    expect(overBudgetA.provisionalBudgetHash).toBe("sha256:budget-a");
    expect(overBudgetB.canonicalHash).not.toBe(overBudgetA.canonicalHash);
    // …and the same binding is the same content (no spurious re-approval).
    expect(
      hashEnvelopeContent({ ...baseContent(), provisionalBudgetHash: "sha256:budget-a" }),
    ).toBe(hashEnvelopeContent({ ...baseContent(), provisionalBudgetHash: "sha256:budget-a" }));
  });

  it("the hash is independent of id/createdAt — identifies content, not record identity", () => {
    const first = buildAuthorizationEnvelope({
      id: ID,
      changeSetId: CHANGE_SET_ID,
      createdAt: CREATED_AT,
      content: baseContent(),
    });
    const second = buildAuthorizationEnvelope({
      id: "33333333-3333-4333-8333-333333333333",
      changeSetId: CHANGE_SET_ID,
      createdAt: "2026-02-01T00:00:00.000Z",
      content: baseContent(),
    });
    expect(first.canonicalHash).toBe(second.canonicalHash);
  });

  it("property: hashEnvelopeContent is stable and perturbation-sensitive over random content", () => {
    const contentArb = fc.record({
      ownedPaths: fc.array(fc.string({ minLength: 1 })),
      commands: fc.array(fc.string({ minLength: 1 })),
      networkDestinations: fc.array(fc.string({ minLength: 1 })),
      credentialReferences: fc.array(fc.string({ minLength: 1 })),
      dependencies: fc.array(fc.string({ minLength: 1 })),
      remoteResourceAuthorizations: fc.constant([]),
      temporaryServices: fc.array(fc.string({ minLength: 1 })),
      prohibitedActions: fc.array(fc.string({ minLength: 1 })),
      provisionalBudgetHash: fc.string({ minLength: 1 }),
    });
    fc.assert(
      fc.property(contentArb, contentArb, (a, b) => {
        const hashA = hashEnvelopeContent(a);
        const hashA2 = hashEnvelopeContent({ ...a });
        expect(hashA).toBe(hashA2);
        if (JSON.stringify(a) !== JSON.stringify(b)) {
          expect(hashEnvelopeContent(b)).not.toBe(hashA);
        }
      }),
      { numRuns: 200 },
    );
  });
});
