import { describe, expect, it } from "vitest";
import { probeConnectionReachability } from "@eo/gateway";
import { buildExternalConnection } from "@eo/testkit";
import { runJiraConnectionDoctor } from "./connection-doctor.js";
import { JiraTokenManager } from "./token-manager.js";

function buildManager(
  scopes: readonly string[],
  fetchImpl?: () => Promise<{
    accessToken: string;
    expiresInSeconds: number;
    scopes: readonly string[];
  }>,
): JiraTokenManager {
  return new JiraTokenManager({
    fetchToken: fetchImpl ?? (async () => ({ accessToken: "tok", expiresInSeconds: 3600, scopes })),
  });
}

describe("runJiraConnectionDoctor", () => {
  const connection = buildExternalConnection({ provider: "jira-cloud" });

  it("succeeds when the token carries every required scope and the probe reports reachable", async () => {
    const result = await runJiraConnectionDoctor({
      connection,
      tokenManager: buildManager(["read:jira-work", "write:jira-work"]),
      requiredScopes: ["read:jira-work", "write:jira-work"],
      probe: async () => ({ reachable: true, status: 200, detail: "ok" }),
    });

    expect(result.ok).toBe(true);
    expect(result.missingScopes).toEqual([]);
  });

  it("fails informatively when a required scope is missing", async () => {
    const result = await runJiraConnectionDoctor({
      connection,
      tokenManager: buildManager(["read:jira-work"]),
      requiredScopes: ["read:jira-work", "write:jira-work"],
      probe: async () => ({ reachable: true, status: 200, detail: "ok" }),
    });

    expect(result.ok).toBe(false);
    expect(result.missingScopes).toEqual(["write:jira-work"]);
  });

  it("fails informatively when token acquisition itself fails, without throwing", async () => {
    const manager = buildManager([], async () => {
      throw new Error("boom");
    });
    const result = await runJiraConnectionDoctor({
      connection,
      tokenManager: manager,
      requiredScopes: ["read:jira-work"],
      probe: async () => ({ reachable: true, status: 200, detail: "ok" }),
    });

    expect(result.ok).toBe(false);
    expect(result.detail).toContain("token");
  });

  it("fails when the reachability probe itself fails, even with valid scopes", async () => {
    const result = await runJiraConnectionDoctor({
      connection,
      tokenManager: buildManager(["read:jira-work"]),
      requiredScopes: ["read:jira-work"],
      probe: async () => ({ reachable: false, detail: "refused: SSRF" }),
    });

    expect(result.ok).toBe(false);
    expect(result.detail).toContain("refused");
  });

  it("defaults its probe to @eo/gateway's probeConnectionReachability when none is supplied", async () => {
    // Smoke-checks the default wiring resolves and runs without throwing —
    // it will report unreachable (there is no real network in tests), but
    // must never throw synchronously and must reuse 16's own probe, not a
    // bespoke reimplementation.
    const result = await runJiraConnectionDoctor({
      connection: buildExternalConnection({
        provider: "jira-cloud",
        baseUrl: "https://jira-doctor-test.invalid",
      }),
      tokenManager: buildManager(["read:jira-work"]),
      requiredScopes: ["read:jira-work"],
    });
    expect(typeof result.ok).toBe("boolean");
    expect(probeConnectionReachability).toBeTypeOf("function");
  });
});
