import { describe, expect, it } from "vitest";
import { CliUsageError } from "../errors.js";
import type { ConnectionAddCommand } from "../argv/types.js";
import { buildJiraConnectionConfig } from "./jira-config-from-command.js";

function cmd(overrides: Partial<ConnectionAddCommand> = {}): ConnectionAddCommand {
  return {
    command: "connection-add",
    provider: "jira",
    reference: { raw: "env:JIRA_TOKEN" },
    baseUrl: "https://example.atlassian.net",
    allowedRedirectOrigins: [],
    allowedResources: ["issue"],
    allowedActions: ["read"],
    discoveryTtlSeconds: 900,
    allowBasicAuth: false,
    json: false,
    ...overrides,
  };
}

/**
 * Issue #135. `connection add` had no way to say WHICH credential shape a
 * Jira connection uses, so Cloud was stuck on a hardcoded OAuth Bearer
 * that Atlassian rejects for API tokens. These pin the defaults an
 * operator gets without reading any docs, because that is the path the
 * bug report actually took: `--reference env:JIRA_TOKEN` and nothing else.
 */
describe("buildJiraConnectionConfig", () => {
  it("returns undefined for Grafana — it has no JiraConnectionConfig", () => {
    expect(buildJiraConnectionConfig(cmd({ provider: "grafana" }), "conn-1")).toBeUndefined();
  });

  describe("defaults", () => {
    it("defaults a Cloud connection to basic auth, Atlassian's documented API-token mechanism", () => {
      const config = buildJiraConnectionConfig(
        cmd({ usernameReference: { raw: "env:MAIL" } }),
        "c",
      );
      expect(config?.authMode).toBe("basic");
      expect(config?.deploymentType).toBe("cloud");
    });

    it("defaults a Data Center connection to pat, per roadmap/19's stated default", () => {
      const config = buildJiraConnectionConfig(cmd({ deploymentType: "datacenter" }), "c");
      expect(config?.authMode).toBe("pat");
    });

    it("keys the config to the connection it was created for", () => {
      const config = buildJiraConnectionConfig(cmd({ deploymentType: "datacenter" }), "conn-42");
      expect(config?.externalConnectionId).toBe("conn-42");
    });
  });

  describe("basic auth", () => {
    it("maps --username-ref to the username and --reference to the password", () => {
      const config = buildJiraConnectionConfig(
        cmd({ authMode: "basic", usernameReference: { raw: "env:JIRA_EMAIL" } }),
        "c",
      );
      expect(config?.basicAuthUsernameSecretRef).toEqual({
        backend: "env",
        variable: "JIRA_EMAIL",
      });
      expect(config?.basicAuthPasswordSecretRef).toEqual({
        backend: "env",
        variable: "JIRA_TOKEN",
      });
    });

    it("refuses without --username-ref, naming the flag rather than failing at request time", () => {
      // The alternative is a connection that stores cleanly, passes
      // `connection doctor`, and 401s on first use.
      expect(() => buildJiraConnectionConfig(cmd({ authMode: "basic" }), "c")).toThrow(
        /--username-ref/,
      );
    });

    it("carries --allow-basic-auth through for Data Center's opt-in guard", () => {
      const config = buildJiraConnectionConfig(
        cmd({
          deploymentType: "datacenter",
          authMode: "basic",
          usernameReference: { raw: "env:USER" },
          allowBasicAuth: true,
        }),
        "c",
      );
      expect(config?.allowBasicAuth).toBe(true);
    });
  });

  describe("oauth", () => {
    it("maps --client-id-ref to the client id and --reference to the client secret", () => {
      const config = buildJiraConnectionConfig(
        cmd({ authMode: "oauth", clientIdReference: { raw: "env:JIRA_CLIENT_ID" } }),
        "c",
      );
      expect(config?.oauthClientIdSecretRef).toEqual({
        backend: "env",
        variable: "JIRA_CLIENT_ID",
      });
      expect(config?.oauthClientSecretRef).toEqual({ backend: "env", variable: "JIRA_TOKEN" });
    });

    it("refuses without --client-id-ref", () => {
      expect(() => buildJiraConnectionConfig(cmd({ authMode: "oauth" }), "c")).toThrow(
        /--client-id-ref/,
      );
    });
  });

  describe("pat", () => {
    it("maps --reference to the PAT", () => {
      const config = buildJiraConnectionConfig(
        cmd({ deploymentType: "datacenter", authMode: "pat" }),
        "c",
      );
      expect(config?.patSecretRef).toEqual({ backend: "env", variable: "JIRA_TOKEN" });
    });
  });

  describe("refusals", () => {
    it("refuses an --auth-mode outside the connector's closed union", () => {
      expect(() => buildJiraConnectionConfig(cmd({ authMode: "ntlm" }), "c")).toThrow(
        CliUsageError,
      );
    });

    it("refuses pat on Cloud, which has no PAT concept", () => {
      expect(() =>
        buildJiraConnectionConfig(cmd({ deploymentType: "cloud", authMode: "pat" }), "c"),
      ).toThrow(/cloud/i);
    });

    it("refuses oauth on Data Center, which this connector does not implement", () => {
      expect(() =>
        buildJiraConnectionConfig(
          cmd({
            deploymentType: "datacenter",
            authMode: "oauth",
            clientIdReference: { raw: "env:ID" },
          }),
          "c",
        ),
      ).toThrow(/data center/i);
    });

    it("refuses a secret reference form that cannot be stored", () => {
      expect(() =>
        buildJiraConnectionConfig(
          cmd({ authMode: "basic", usernameReference: { raw: "op://vault/item" } }),
          "c",
        ),
      ).toThrow(CliUsageError);
    });
  });

  it("produces a config that the connector's own schema accepts", async () => {
    // The CLI must not be able to write a shape the connector then refuses
    // to read — that would move the failure from `connection add` to first
    // dispatch, which is the whole pattern this issue is about.
    const { JiraConnectionConfigSchema } = await import("@crabgic/connectors-jira");
    const config = buildJiraConnectionConfig(
      cmd({ authMode: "basic", usernameReference: { raw: "env:MAIL" } }),
      "c",
    );
    expect(() => JiraConnectionConfigSchema.parse(config)).not.toThrow();
  });
});
