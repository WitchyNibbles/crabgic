import { describe, expect, it } from "vitest";
import { ConnectorError } from "@eo/contracts";
import {
  JIRA_AUTH_MODES,
  JIRA_DEPLOYMENT_TYPES,
  JiraConnectionConfigSchema,
  assertBasicAuthPermitted,
} from "./jira-connection-config.js";

/**
 * roadmap/19-jira-datacenter-adapter.md work item 1, entry point: "a
 * `datacenter` config with a basic-auth secret reference and
 * `allowBasicAuth: false` is asserted to reject pre-network with canonical
 * `authentication` BEFORE the guard exists." This file is written first —
 * `./jira-connection-config.ts` does not exist yet, so every import above
 * fails, which is this work item's own required red state.
 */
function buildConfig(
  overrides: Partial<Parameters<typeof JiraConnectionConfigSchema.parse>[0]> = {},
) {
  return JiraConnectionConfigSchema.parse({
    externalConnectionId: "11111111-1111-4111-8111-111111111111",
    deploymentType: "datacenter",
    authMode: "basic",
    allowBasicAuth: false,
    basicAuthUsernameSecretRef: { backend: "env", variable: "JIRA_DC_USER" },
    basicAuthPasswordSecretRef: { backend: "env", variable: "JIRA_DC_PASS" },
    ...overrides,
  });
}

describe("JIRA_DEPLOYMENT_TYPES / JIRA_AUTH_MODES", () => {
  it("is the closed 2-member deployment-type union", () => {
    expect(JIRA_DEPLOYMENT_TYPES).toEqual(["cloud", "datacenter"]);
  });

  it("is the closed 3-member auth-mode union", () => {
    expect(JIRA_AUTH_MODES).toEqual(["oauth", "pat", "basic"]);
  });
});

describe("JiraConnectionConfigSchema", () => {
  it("parses a valid datacenter/pat config", () => {
    const config = JiraConnectionConfigSchema.parse({
      externalConnectionId: "11111111-1111-4111-8111-111111111111",
      deploymentType: "datacenter",
      authMode: "pat",
      patSecretRef: { backend: "env", variable: "JIRA_DC_PAT" },
    });
    expect(config.allowBasicAuth).toBe(false); // default
  });

  it("defaults allowBasicAuth to false when omitted", () => {
    const config = buildConfig({ allowBasicAuth: undefined });
    expect(config.allowBasicAuth).toBe(false);
  });

  it("rejects an unknown deploymentType", () => {
    expect(() => buildConfig({ deploymentType: "on-prem" as never })).toThrow();
  });

  it("rejects an unknown authMode", () => {
    expect(() => buildConfig({ authMode: "kerberos" as never })).toThrow();
  });
});

describe("assertBasicAuthPermitted — pre-network authentication guard", () => {
  it("rejects a basic-auth config with allowBasicAuth: false, with canonical authentication, before any network call", () => {
    const config = buildConfig({ allowBasicAuth: false });
    expect(() => assertBasicAuthPermitted(config)).toThrow(ConnectorError);
    try {
      assertBasicAuthPermitted(config);
      throw new Error("expected assertBasicAuthPermitted to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(ConnectorError);
      expect((err as ConnectorError).kind).toBe("authentication");
    }
  });

  it("accepts a basic-auth config with allowBasicAuth: true", () => {
    const config = buildConfig({ allowBasicAuth: true });
    expect(() => assertBasicAuthPermitted(config)).not.toThrow();
  });

  it("never even inspects allowBasicAuth for a non-basic authMode (pat)", () => {
    const config = JiraConnectionConfigSchema.parse({
      externalConnectionId: "11111111-1111-4111-8111-111111111111",
      deploymentType: "datacenter",
      authMode: "pat",
      allowBasicAuth: false,
      patSecretRef: { backend: "env", variable: "JIRA_DC_PAT" },
    });
    expect(() => assertBasicAuthPermitted(config)).not.toThrow();
  });

  it("never leaks the configured secret references in the thrown error's message", () => {
    const config = buildConfig({ allowBasicAuth: false });
    try {
      assertBasicAuthPermitted(config);
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(ConnectorError);
      expect((err as ConnectorError).message).not.toContain("JIRA_DC_USER");
      expect((err as ConnectorError).message).not.toContain("JIRA_DC_PASS");
    }
  });
});
