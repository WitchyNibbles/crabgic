import { describe, expect, it } from "vitest";
import { AuthorizationEnvelopeSchema } from "./authorization-envelope.js";

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

describe("AuthorizationEnvelopeSchema — round-trip", () => {
  it("parse -> JSON.stringify -> JSON.parse -> parse yields a deep-equal output", () => {
    const first = AuthorizationEnvelopeSchema.parse(validEnvelope);
    const roundTripped = AuthorizationEnvelopeSchema.parse(JSON.parse(JSON.stringify(first)));
    expect(roundTripped).toStrictEqual(first);
  });
});
