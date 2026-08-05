import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ExternalConnectionSchema, SecretReferenceSchema } from "./external-connection.js";

const validConnection = {
  schemaVersion: 1,
  id: "8f14e45f-ceea-467e-b4d3-8b5f8f5f8f5f",
  provider: "jira-cloud",
  deploymentType: "cloud",
  baseUrl: "https://example.atlassian.net",
  allowedRedirectOrigins: ["https://example.atlassian.net"],
  tenantAllowlist: ["acme-corp"],
  projectAllowlist: ["PROJ"],
  customCaRef: { path: "/etc/eo/ca/jira.pem" },
  allowedResources: ["issue", "board", "sprint"],
  allowedActions: ["read", "create", "update"],
  discoveryTtlSeconds: 900,
  secretRef: { backend: "env", variable: "CRABGIC_JIRA_TOKEN" },
};

describe("ExternalConnectionSchema — valid fixture", () => {
  it("parses a fully-valid fixture (roadmap/16 §In scope, ExternalConnection store bullet)", () => {
    const result = ExternalConnectionSchema.safeParse(validConnection);
    expect(result.success).toBe(true);
  });

  it("accepts a minimal connection with only the required fields", () => {
    const minimal = {
      schemaVersion: 1,
      id: "8f14e45f-ceea-467e-b4d3-8b5f8f5f8f5f",
      provider: "grafana-oss",
      baseUrl: "https://grafana.internal.example.com",
      allowedRedirectOrigins: [],
      allowedResources: ["dashboard"],
      allowedActions: ["read"],
      discoveryTtlSeconds: 300,
      secretRef: { backend: "file", path: "/run/secrets/grafana-token" },
    };
    expect(ExternalConnectionSchema.safeParse(minimal).success).toBe(true);
  });

  it("accepts an exec-backend secret reference with args", () => {
    const withExec = {
      ...validConnection,
      secretRef: { backend: "exec", command: "op", args: ["read", "op://vault/jira/token"] },
    };
    expect(ExternalConnectionSchema.safeParse(withExec).success).toBe(true);
  });
});

describe("ExternalConnectionSchema — invalid-shape rejection", () => {
  it("rejects a missing schemaVersion", () => {
    const { schemaVersion: _schemaVersion, ...rest } = validConnection;
    expect(ExternalConnectionSchema.safeParse(rest).success).toBe(false);
  });

  it("rejects a non-https baseUrl", () => {
    expect(
      ExternalConnectionSchema.safeParse({
        ...validConnection,
        baseUrl: "http://example.atlassian.net",
      }).success,
    ).toBe(false);
  });

  it("rejects a malformed baseUrl", () => {
    expect(
      ExternalConnectionSchema.safeParse({ ...validConnection, baseUrl: "not-a-url" }).success,
    ).toBe(false);
  });

  it("rejects a non-positive discoveryTtlSeconds", () => {
    expect(
      ExternalConnectionSchema.safeParse({ ...validConnection, discoveryTtlSeconds: 0 }).success,
    ).toBe(false);
  });

  it("rejects a secretRef with an unrecognized backend", () => {
    expect(
      ExternalConnectionSchema.safeParse({
        ...validConnection,
        secretRef: { backend: "vault", vaultPath: "secret/jira" },
      }).success,
    ).toBe(false);
  });

  it("rejects a literal credential smuggled into secretRef (no such field exists on any branch)", () => {
    expect(
      ExternalConnectionSchema.safeParse({
        ...validConnection,
        secretRef: { backend: "env", variable: "CRABGIC_JIRA_TOKEN", literalValue: "sk-leaked" },
      }).success,
    ).toBe(false);
  });

  it("rejects a non-uuid id", () => {
    expect(
      ExternalConnectionSchema.safeParse({ ...validConnection, id: "not-a-uuid" }).success,
    ).toBe(false);
  });
});

describe("ExternalConnectionSchema — unknown-key rejection (.strict())", () => {
  it("rejects an unknown top-level key", () => {
    expect(
      ExternalConnectionSchema.safeParse({ ...validConnection, unexpected: "field" }).success,
    ).toBe(false);
  });

  it("rejects an unknown key on customCaRef", () => {
    expect(
      ExternalConnectionSchema.safeParse({
        ...validConnection,
        customCaRef: { path: "/etc/eo/ca/jira.pem", fingerprint: "deadbeef" },
      }).success,
    ).toBe(false);
  });
});

describe("SecretReferenceSchema — all union branches", () => {
  it("accepts the env backend", () => {
    expect(SecretReferenceSchema.safeParse({ backend: "env", variable: "X" }).success).toBe(true);
  });

  it("accepts the file backend", () => {
    expect(
      SecretReferenceSchema.safeParse({ backend: "file", path: "/run/secrets/x" }).success,
    ).toBe(true);
  });

  it("accepts the exec backend without args", () => {
    expect(SecretReferenceSchema.safeParse({ backend: "exec", command: "op" }).success).toBe(true);
  });

  it("rejects a backend outside the closed union", () => {
    expect(SecretReferenceSchema.safeParse({ backend: "sso", token: "x" }).success).toBe(false);
  });
});

describe("ExternalConnectionSchema — round-trip", () => {
  it("parse -> JSON.stringify -> JSON.parse -> parse yields a deep-equal output", () => {
    const first = ExternalConnectionSchema.parse(validConnection);
    const roundTripped = ExternalConnectionSchema.parse(JSON.parse(JSON.stringify(first)));
    expect(roundTripped).toStrictEqual(first);
  });
});

/**
 * DEFECT 21 — the PUBLISHED description is the cure for the operator-facing
 * half of this defect, so it is pinned rather than merely written.
 *
 * `packages/contracts/package.json` ships `schemas/` (`"files": [..., "schemas"]`,
 * export `./schemas/*.json`), so `schemas/external-connection.json`'s
 * `description` is what an operator or a schema-driven config tool actually
 * reads. Without a test, the enforcement could be deleted and this text would
 * keep promising it — the exact failure mode (a field that describes a control
 * it does not have) that this whole change exists to remove.
 *
 * The SCOPE clauses are pinned as hard as the enforcement clause on purpose:
 * an over-claimed control is worse than a documented narrow one, so "reads are
 * not tenant-checked" and "actual tenant identity is not verified" must not
 * quietly disappear from the published text either.
 */
describe("ExternalConnectionSchema — tenantAllowlist published description (defect 21)", () => {
  const publishedSchema = JSON.parse(
    readFileSync(new URL("../../schemas/external-connection.json", import.meta.url), "utf8"),
  ) as { properties: Record<string, { description?: string }> };

  const description = publishedSchema.properties.tenantAllowlist?.description ?? "";

  it("states the enforcement: the typed error kind, and that it precedes I/O and journalling", () => {
    expect(description).toContain("policy_blocked");
    expect(description).toContain("before any network I/O");
    expect(description).toContain("before any RemoteOperationRecord is journalled");
  });

  it("states the fail-closed empty-array reading and the unscoped absent reading", () => {
    expect(description).toContain("An empty array refuses every mutation (fail-closed)");
    expect(description).toContain("absent means the connection is tenant-unscoped");
  });

  it("states the SCOPE residuals, so the field cannot read as a broader guarantee than it is", () => {
    expect(description).toContain("Reads are not tenant-checked");
    expect(description).toContain("actual tenant identity is not verified");
    expect(description).toContain("not a guarantee that cross-tenant access is refused");
  });

  it("the published artifact has not drifted from the zod source it is generated from", () => {
    // `scripts/build-schemas.ts` emits `description` from `.describe()`. If
    // someone edits the zod without re-running `npm run build:schemas`, or
    // hand-edits the JSON, these two diverge and this fails.
    expect(description).toBe(ExternalConnectionSchema.shape.tenantAllowlist.description);
  });
});
