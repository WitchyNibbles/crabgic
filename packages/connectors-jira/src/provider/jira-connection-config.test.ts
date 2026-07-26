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

  /**
   * WP5 (2026-07-25): Cloud's `authMode: "oauth"` needs the service-account
   * client-credentials PAIR (`../auth/jira-oauth-http.ts`'s
   * `JiraOAuthClientCredentials.clientId`/`.clientSecret`) to be
   * CONFIGURABLE, and P02's `ExternalConnection` carries exactly one
   * `secretRef`. The sanctioned home for the second one is THIS schema —
   * roadmap/19-jira-datacenter-adapter.md:16 forbids changing
   * `ExternalConnection` itself, and this schema already carries three
   * optional `SecretReferenceSchema` fields for exactly this reason.
   */
  it("carries an optional OAuth client-credentials secret-reference pair", () => {
    const config = JiraConnectionConfigSchema.parse({
      externalConnectionId: "11111111-1111-4111-8111-111111111111",
      deploymentType: "cloud",
      authMode: "oauth",
      oauthClientIdSecretRef: { backend: "env", variable: "JIRA_OAUTH_CLIENT_ID" },
      oauthClientSecretRef: { backend: "file", path: "/run/secrets/jira-oauth-client-secret" },
    });
    expect(config.oauthClientIdSecretRef).toEqual({
      backend: "env",
      variable: "JIRA_OAUTH_CLIENT_ID",
    });
    expect(config.oauthClientSecretRef).toEqual({
      backend: "file",
      path: "/run/secrets/jira-oauth-client-secret",
    });
  });

  it("leaves both OAuth secret refs undefined when omitted — they are optional, exactly like patSecretRef", () => {
    const config = JiraConnectionConfigSchema.parse({
      externalConnectionId: "11111111-1111-4111-8111-111111111111",
      deploymentType: "cloud",
      authMode: "oauth",
    });
    expect(config.oauthClientIdSecretRef).toBeUndefined();
    expect(config.oauthClientSecretRef).toBeUndefined();
  });

  /** Both halves of the pair, independently: a schema that validated only one of them would leak an unvalidated credential locator through the other. */
  it.each(["oauthClientIdSecretRef", "oauthClientSecretRef"] as const)(
    "rejects a malformed %s rather than coercing it",
    (field) => {
      expect(() =>
        JiraConnectionConfigSchema.parse({
          externalConnectionId: "11111111-1111-4111-8111-111111111111",
          deploymentType: "cloud",
          authMode: "oauth",
          [field]: { backend: "vault", uri: "vault://jira/secret" },
        }),
      ).toThrow();
    },
  );

  it.each(["oauthClientIdSecretRef", "oauthClientSecretRef"] as const)(
    "rejects a bare string for %s — a secret reference is a structured backend record, never a literal",
    (field) => {
      expect(() =>
        JiraConnectionConfigSchema.parse({
          externalConnectionId: "11111111-1111-4111-8111-111111111111",
          deploymentType: "cloud",
          authMode: "oauth",
          [field]: "not-a-reference",
        }),
      ).toThrow();
    },
  );

  /** The `.strict()` guarantee still holds — a typo'd OAuth field is a parse failure, not a silently-dropped credential. */
  it("still rejects an unrecognized field after the OAuth pair was added", () => {
    expect(() =>
      JiraConnectionConfigSchema.parse({
        externalConnectionId: "11111111-1111-4111-8111-111111111111",
        deploymentType: "cloud",
        authMode: "oauth",
        oauthClientSecretRefs: { backend: "env", variable: "TYPO" },
      }),
    ).toThrow();
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
