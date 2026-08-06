import { describe, expect, it } from "vitest";
import {
  AuthorizationEnvelopeSchema,
  DEFAULT_MAX_TURNS_PER_ATTEMPT,
} from "./authorization-envelope.js";

const validEnvelope = {
  schemaVersion: 1,
  id: "8f14e45f-ceea-467e-b4d3-8b5f8f5f8f5f",
  changeSetId: "1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed",
  createdAt: "2026-07-15T12:00:00.000Z",
  canonicalHash: "sha256:9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",
  ownedPaths: ["//abs/path/worktree/**"],
  commands: ["Bash(npm run lint:*)"],
  networkDestinations: [],
  credentialReferences: ["jira-service-account"],
  dependencies: ["zod@3.25.76"],
  remoteResourceAuthorizations: [
    { reference: "JIRA-123", highImpactFlags: ["closing transitions", "bulk mutations"] },
  ],
  temporaryServices: ["postgres:5432"],
  prohibitedActions: ["Bash(git push:*)"],
};

describe("AuthorizationEnvelopeSchema — valid fixture", () => {
  it("parses a fully-valid fixture (roadmap/11 §In scope, AuthorizationEnvelope bullet)", () => {
    expect(AuthorizationEnvelopeSchema.safeParse(validEnvelope).success).toBe(true);
  });

  it("accepts an envelope with no remote-resource authorizations (read-only envelope)", () => {
    const readOnly = { ...validEnvelope, remoteResourceAuthorizations: [], temporaryServices: [] };
    expect(AuthorizationEnvelopeSchema.safeParse(readOnly).success).toBe(true);
  });

  it("byte-matches HighImpactCapabilityFlag labels verbatim (interface-ledger Gap 10)", () => {
    const fixture = {
      ...validEnvelope,
      remoteResourceAuthorizations: [
        {
          reference: "GRAF-1",
          highImpactFlags: ["alert disabling", "contact points", "mute timings"],
        },
      ],
    };
    expect(AuthorizationEnvelopeSchema.safeParse(fixture).success).toBe(true);
  });
});

describe("AuthorizationEnvelopeSchema — invalid-shape rejection", () => {
  it("rejects a missing canonicalHash (11's own text: 'canonical hash-stable form')", () => {
    const { canonicalHash: _canonicalHash, ...rest } = validEnvelope;
    expect(AuthorizationEnvelopeSchema.safeParse(rest).success).toBe(false);
  });

  it("rejects a highImpactFlags entry outside the canonical 11-member union", () => {
    const invalid = {
      ...validEnvelope,
      remoteResourceAuthorizations: [{ reference: "X", highImpactFlags: ["delete everything"] }],
    };
    expect(AuthorizationEnvelopeSchema.safeParse(invalid).success).toBe(false);
  });

  it("rejects a missing changeSetId", () => {
    const { changeSetId: _changeSetId, ...rest } = validEnvelope;
    expect(AuthorizationEnvelopeSchema.safeParse(rest).success).toBe(false);
  });
});

describe("AuthorizationEnvelopeSchema — unknown-key rejection (.strict())", () => {
  it("rejects an unknown top-level key", () => {
    const invalid = { ...validEnvelope, unexpected: "field" };
    expect(AuthorizationEnvelopeSchema.safeParse(invalid).success).toBe(false);
  });

  it("rejects an unknown key on a nested remote-resource authorization", () => {
    const invalid = {
      ...validEnvelope,
      remoteResourceAuthorizations: [
        { reference: "JIRA-123", highImpactFlags: [], unexpected: "field" },
      ],
    };
    expect(AuthorizationEnvelopeSchema.safeParse(invalid).success).toBe(false);
  });
});

describe("AuthorizationEnvelopeSchema — maxTurnsPerAttempt (the worker turn budget)", () => {
  it("defaults an ABSENT field to the bounded default, so every pre-existing envelope stays valid and bounded", () => {
    // Absent-with-default is a definite bounded request, not "unconstrained" —
    // the F10 absent-means-deny ruling binds POLICY fields, where absence
    // widening authority is the hazard. Here absence narrows to the default.
    const parsed = AuthorizationEnvelopeSchema.parse(validEnvelope);
    expect(parsed.maxTurnsPerAttempt).toBe(DEFAULT_MAX_TURNS_PER_ATTEMPT);
  });

  it("accepts an explicit positive integer", () => {
    const parsed = AuthorizationEnvelopeSchema.parse({ ...validEnvelope, maxTurnsPerAttempt: 12 });
    expect(parsed.maxTurnsPerAttempt).toBe(12);
  });

  it("rejects zero, negatives, non-integers and non-numbers — a turnless or fractional budget is meaningless", () => {
    for (const invalid of [0, -1, 1.5, "40", null, Number.NaN]) {
      expect(
        AuthorizationEnvelopeSchema.safeParse({ ...validEnvelope, maxTurnsPerAttempt: invalid })
          .success,
        `maxTurnsPerAttempt ${JSON.stringify(invalid)} must be rejected`,
      ).toBe(false);
    }
  });
});

/**
 * `provisionalBudgetHash` — interface-ledger Gap 22 (2026-08-06). The member
 * that makes the approval token's signature cover the budget set 15 later
 * enforces. Its OPTIONALITY is a documented decision, not an oversight, so it
 * is pinned by an assertion here rather than described in prose only.
 */
describe("AuthorizationEnvelopeSchema — provisionalBudgetHash (ledger Gap 22)", () => {
  it("accepts and carries the derived provisional budget hash", () => {
    const parsed = AuthorizationEnvelopeSchema.parse({
      ...validEnvelope,
      provisionalBudgetHash: "sha256:derived-provisional-budget-hash",
    });
    expect(parsed.provisionalBudgetHash).toBe("sha256:derived-provisional-budget-hash");
  });

  it("rejects an empty-string binding — a present-but-blank hash must never read as a binding", () => {
    expect(
      AuthorizationEnvelopeSchema.safeParse({ ...validEnvelope, provisionalBudgetHash: "" })
        .success,
    ).toBe(false);
  });

  it("rejects a non-string binding", () => {
    for (const invalid of [0, null, {}, []]) {
      expect(
        AuthorizationEnvelopeSchema.safeParse({ ...validEnvelope, provisionalBudgetHash: invalid })
          .success,
        `provisionalBudgetHash ${JSON.stringify(invalid)} must be rejected`,
      ).toBe(false);
    }
  });

  it("DELIBERATE LEGACY PIN: an envelope WITHOUT the member still parses, and the member does NOT default", () => {
    // Optional for schema evolution only — `CURRENT_SCHEMA_VERSION` is one
    // shared literal and file-backed registries parse persisted state with
    // this schema, so a required member would make existing state dirs
    // unreadable at load (a crash, not a fail-closed refusal). There is
    // deliberately NO default: `canonicalHash([])` would assert the human
    // approved an empty budget set they never saw. Absence is not fail-open —
    // `packages/perf/src/contract/hash-link.ts` refuses an unbound envelope
    // with `no_envelope_budget_binding` before anything is enforced.
    const parsed = AuthorizationEnvelopeSchema.parse(validEnvelope);
    expect(parsed.provisionalBudgetHash).toBeUndefined();
    expect(Object.hasOwn(parsed, "provisionalBudgetHash")).toBe(false);
  });
});

describe("AuthorizationEnvelopeSchema — round-trip", () => {
  it("parse -> JSON.stringify -> JSON.parse -> parse yields a deep-equal output", () => {
    const first = AuthorizationEnvelopeSchema.parse(validEnvelope);
    const roundTripped = AuthorizationEnvelopeSchema.parse(JSON.parse(JSON.stringify(first)));
    expect(roundTripped).toStrictEqual(first);
  });
});
