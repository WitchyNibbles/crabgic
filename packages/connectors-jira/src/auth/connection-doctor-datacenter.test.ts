import { describe, expect, it } from "vitest";
import { buildExternalConnection } from "@eo/testkit";
import { JiraConnectionConfigSchema } from "../provider/jira-connection-config.js";
import { runJiraDatacenterConnectionDoctor } from "./connection-doctor-datacenter.js";

const CONNECTION_ID = "33333333-3333-4333-8333-333333333333";

describe("runJiraDatacenterConnectionDoctor", () => {
  const connection = buildExternalConnection({
    id: CONNECTION_ID,
    provider: "jira-datacenter",
    deploymentType: "datacenter",
  });

  it("succeeds for a PAT config, reachable, with basicAuthActive: false", async () => {
    const config = JiraConnectionConfigSchema.parse({
      externalConnectionId: CONNECTION_ID,
      deploymentType: "datacenter",
      authMode: "pat",
      patSecretRef: { backend: "env", variable: "TEST_DC_DOCTOR_PAT" },
    });
    process.env.TEST_DC_DOCTOR_PAT = "pat-value";

    const result = await runJiraDatacenterConnectionDoctor({
      connection,
      config,
      probe: async () => ({ reachable: true, status: 200, detail: "ok" }),
    });

    expect(result.ok).toBe(true);
    expect(result.basicAuthActive).toBe(false);
  });

  it("fails pre-network (no probe call) when basic auth is configured but not allowed", async () => {
    let probeCalled = false;
    const config = JiraConnectionConfigSchema.parse({
      externalConnectionId: CONNECTION_ID,
      deploymentType: "datacenter",
      authMode: "basic",
      allowBasicAuth: false,
      basicAuthUsernameSecretRef: { backend: "env", variable: "TEST_DC_DOCTOR_USER" },
      basicAuthPasswordSecretRef: { backend: "env", variable: "TEST_DC_DOCTOR_PASS" },
    });

    const result = await runJiraDatacenterConnectionDoctor({
      connection,
      config,
      probe: async () => {
        probeCalled = true;
        return { reachable: true, status: 200, detail: "ok" };
      },
    });

    expect(result.ok).toBe(false);
    expect(probeCalled).toBe(false);
    expect(result.detail).toContain("basic");
  });

  it("succeeds with a non-blocking basicAuthActive: true finding when basic auth is explicitly allowed", async () => {
    process.env.TEST_DC_DOCTOR_USER2 = "user";
    process.env.TEST_DC_DOCTOR_PASS2 = "pass";
    const config = JiraConnectionConfigSchema.parse({
      externalConnectionId: CONNECTION_ID,
      deploymentType: "datacenter",
      authMode: "basic",
      allowBasicAuth: true,
      basicAuthUsernameSecretRef: { backend: "env", variable: "TEST_DC_DOCTOR_USER2" },
      basicAuthPasswordSecretRef: { backend: "env", variable: "TEST_DC_DOCTOR_PASS2" },
    });

    const result = await runJiraDatacenterConnectionDoctor({
      connection,
      config,
      probe: async () => ({ reachable: true, status: 200, detail: "ok" }),
    });

    expect(result.ok).toBe(true);
    expect(result.basicAuthActive).toBe(true);
  });

  it("fails informatively when the reachability probe reports unreachable", async () => {
    const config = JiraConnectionConfigSchema.parse({
      externalConnectionId: CONNECTION_ID,
      deploymentType: "datacenter",
      authMode: "pat",
      patSecretRef: { backend: "env", variable: "TEST_DC_DOCTOR_PAT" },
    });

    const result = await runJiraDatacenterConnectionDoctor({
      connection,
      config,
      probe: async () => ({ reachable: false, detail: "refused: SSRF" }),
    });

    expect(result.ok).toBe(false);
    expect(result.detail).toContain("refused");
  });

  it("fails informatively when auth-header resolution itself fails, without throwing", async () => {
    const config = JiraConnectionConfigSchema.parse({
      externalConnectionId: CONNECTION_ID,
      deploymentType: "datacenter",
      authMode: "pat",
      // no patSecretRef configured at all
    });

    const result = await runJiraDatacenterConnectionDoctor({
      connection,
      config,
      probe: async () => ({ reachable: true, status: 200, detail: "ok" }),
    });

    expect(result.ok).toBe(false);
  });
});
