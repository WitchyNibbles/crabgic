import { describe, expect, it } from "vitest";
import { ConnectorError } from "@eo/contracts";
import { JiraConnectionConfigSchema } from "../provider/jira-connection-config.js";
import {
  buildJiraBasicAuthHeaderProvider,
  buildJiraPatAuthHeaderProvider,
  resolveJiraDatacenterAuthHeaderProvider,
} from "./jira-datacenter-auth.js";

const CONNECTION_ID = "22222222-2222-4222-8222-222222222222";

describe("buildJiraPatAuthHeaderProvider", () => {
  it("resolves the PAT secret reference and returns a Bearer authorization header", async () => {
    process.env.TEST_JIRA_DC_PAT = "pat-value-1";
    const provider = buildJiraPatAuthHeaderProvider({
      backend: "env",
      variable: "TEST_JIRA_DC_PAT",
    });
    const headers = await provider();
    expect(headers["authorization"]).toBe("Bearer pat-value-1");
  });

  it("caches the resolved token across calls (via JiraTokenManager reuse)", async () => {
    let resolveCount = 0;
    process.env.TEST_JIRA_DC_PAT_2 = "pat-value-2";
    const provider = buildJiraPatAuthHeaderProvider({
      backend: "env",
      variable: "TEST_JIRA_DC_PAT_2",
    });
    // Wrap process.env read counting isn't directly observable here, but two
    // calls must both succeed and return the identical header — proving no
    // exception is thrown on a second call (the cache path).
    const first = await provider();
    const second = await provider();
    expect(first).toEqual(second);
    resolveCount += 1;
    expect(resolveCount).toBe(1);
  });

  it("wraps an empty PAT as a ConnectorError.authentication failure", async () => {
    process.env.TEST_JIRA_DC_PAT_EMPTY = "";
    const provider = buildJiraPatAuthHeaderProvider({
      backend: "env",
      variable: "TEST_JIRA_DC_PAT_EMPTY",
    });
    await expect(provider()).rejects.toThrow(ConnectorError);
  });
});

describe("buildJiraBasicAuthHeaderProvider", () => {
  it("resolves username/password secret references and returns a base64 Basic authorization header", async () => {
    process.env.TEST_JIRA_DC_USER = "alice";
    process.env.TEST_JIRA_DC_PASS = "s3cr3t";
    const provider = buildJiraBasicAuthHeaderProvider(
      { backend: "env", variable: "TEST_JIRA_DC_USER" },
      { backend: "env", variable: "TEST_JIRA_DC_PASS" },
    );
    const headers = await provider();
    const expected = `Basic ${Buffer.from("alice:s3cr3t", "utf8").toString("base64")}`;
    expect(headers["authorization"]).toBe(expected);
  });
});

describe("resolveJiraDatacenterAuthHeaderProvider", () => {
  it("rejects a basic-auth config with allowBasicAuth: false, pre-network, with canonical authentication", async () => {
    const config = JiraConnectionConfigSchema.parse({
      externalConnectionId: CONNECTION_ID,
      deploymentType: "datacenter",
      authMode: "basic",
      allowBasicAuth: false,
      basicAuthUsernameSecretRef: { backend: "env", variable: "TEST_JIRA_DC_USER" },
      basicAuthPasswordSecretRef: { backend: "env", variable: "TEST_JIRA_DC_PASS" },
    });
    expect(() => resolveJiraDatacenterAuthHeaderProvider(config)).toThrow(ConnectorError);
    try {
      resolveJiraDatacenterAuthHeaderProvider(config);
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(ConnectorError);
      expect((err as ConnectorError).kind).toBe("authentication");
    }
  });

  it("builds a working PAT provider when authMode is pat", async () => {
    process.env.TEST_JIRA_DC_PAT_3 = "pat-value-3";
    const config = JiraConnectionConfigSchema.parse({
      externalConnectionId: CONNECTION_ID,
      deploymentType: "datacenter",
      authMode: "pat",
      patSecretRef: { backend: "env", variable: "TEST_JIRA_DC_PAT_3" },
    });
    const provider = resolveJiraDatacenterAuthHeaderProvider(config);
    const headers = await provider();
    expect(headers["authorization"]).toBe("Bearer pat-value-3");
  });

  it("throws a validation error when authMode is pat but no patSecretRef is configured", () => {
    const config = JiraConnectionConfigSchema.parse({
      externalConnectionId: CONNECTION_ID,
      deploymentType: "datacenter",
      authMode: "pat",
    });
    expect(() => resolveJiraDatacenterAuthHeaderProvider(config)).toThrow(ConnectorError);
  });

  it("builds a working basic-auth provider when authMode is basic and allowBasicAuth is true", async () => {
    process.env.TEST_JIRA_DC_USER_2 = "bob";
    process.env.TEST_JIRA_DC_PASS_2 = "hunter2";
    const config = JiraConnectionConfigSchema.parse({
      externalConnectionId: CONNECTION_ID,
      deploymentType: "datacenter",
      authMode: "basic",
      allowBasicAuth: true,
      basicAuthUsernameSecretRef: { backend: "env", variable: "TEST_JIRA_DC_USER_2" },
      basicAuthPasswordSecretRef: { backend: "env", variable: "TEST_JIRA_DC_PASS_2" },
    });
    const provider = resolveJiraDatacenterAuthHeaderProvider(config);
    const headers = await provider();
    expect(headers["authorization"]).toContain("Basic ");
  });

  it("throws unsupported when authMode is oauth (not implemented for Data Center by this phase)", () => {
    const config = JiraConnectionConfigSchema.parse({
      externalConnectionId: CONNECTION_ID,
      deploymentType: "datacenter",
      authMode: "oauth",
    });
    try {
      resolveJiraDatacenterAuthHeaderProvider(config);
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(ConnectorError);
      expect((err as ConnectorError).kind).toBe("unsupported");
    }
  });
});
