import { describe, expect, it } from "vitest";
import { CapabilitySnapshotSchema } from "./capability-snapshot.js";

const validSnapshot = {
  schemaVersion: 1,
  id: "8f14e45f-ceea-467e-b4d3-8b5f8f5f8f5f",
  externalConnectionId: "1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed",
  product: "jira",
  edition: "cloud",
  version: "3",
  apiFamilies: ["rest-v3", "agile"],
  resources: ["issue", "board", "sprint"],
  actions: ["read", "create", "update", "transition"],
  permissions: ["BROWSE_PROJECTS", "CREATE_ISSUES"],
  isReadOnly: false,
  discoveredAt: "2026-07-15T12:00:00.000Z",
  expiresAt: "2026-07-15T12:15:00.000Z",
};

describe("CapabilitySnapshotSchema — valid fixture", () => {
  it("parses a fully-valid fixture (roadmap/16 §In scope, CapabilitySnapshot bullet)", () => {
    expect(CapabilitySnapshotSchema.safeParse(validSnapshot).success).toBe(true);
  });

  it("accepts an unknown-edition, forced-read-only snapshot (roadmap/18/20: unknown versions default read-only)", () => {
    const unknownEdition = {
      ...validSnapshot,
      edition: "unrecognized",
      apiFamilies: [],
      resources: [],
      actions: [],
      permissions: [],
      isReadOnly: true,
    };
    expect(CapabilitySnapshotSchema.safeParse(unknownEdition).success).toBe(true);
  });
});

describe("CapabilitySnapshotSchema — invalid-shape rejection", () => {
  it("rejects a missing schemaVersion", () => {
    const { schemaVersion: _schemaVersion, ...rest } = validSnapshot;
    expect(CapabilitySnapshotSchema.safeParse(rest).success).toBe(false);
  });

  it("rejects a non-uuid externalConnectionId", () => {
    expect(
      CapabilitySnapshotSchema.safeParse({ ...validSnapshot, externalConnectionId: "not-a-uuid" })
        .success,
    ).toBe(false);
  });

  it("rejects a non-boolean isReadOnly", () => {
    expect(
      CapabilitySnapshotSchema.safeParse({ ...validSnapshot, isReadOnly: "false" }).success,
    ).toBe(false);
  });

  it("rejects a malformed discoveredAt timestamp", () => {
    expect(
      CapabilitySnapshotSchema.safeParse({ ...validSnapshot, discoveredAt: "not-a-date" }).success,
    ).toBe(false);
  });

  it("rejects an empty product string", () => {
    expect(CapabilitySnapshotSchema.safeParse({ ...validSnapshot, product: "" }).success).toBe(
      false,
    );
  });
});

describe("CapabilitySnapshotSchema — unknown-key rejection (.strict())", () => {
  it("rejects an unknown top-level key", () => {
    expect(
      CapabilitySnapshotSchema.safeParse({ ...validSnapshot, unexpected: "field" }).success,
    ).toBe(false);
  });
});

describe("CapabilitySnapshotSchema — round-trip", () => {
  it("parse -> JSON.stringify -> JSON.parse -> parse yields a deep-equal output", () => {
    const first = CapabilitySnapshotSchema.parse(validSnapshot);
    const roundTripped = CapabilitySnapshotSchema.parse(JSON.parse(JSON.stringify(first)));
    expect(roundTripped).toStrictEqual(first);
  });
});
