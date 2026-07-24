import { describe, expect, it } from "vitest";
import {
  checkGrafanaConnectionDoctor,
  type GrafanaTokenInfoResponse,
} from "./connection-doctor.js";

function fakeFetch(response: GrafanaTokenInfoResponse) {
  return async () => response;
}

describe("checkGrafanaConnectionDoctor — token scope + org binding (work item 1)", () => {
  it("succeeds for an Editor-role token bound to an allowlisted org", async () => {
    const result = await checkGrafanaConnectionDoctor({
      fetchTokenInfo: fakeFetch({ orgId: 7, role: "Editor" }),
      orgAllowlist: ["7"],
    });
    expect(result).toEqual({ ok: true, orgId: 7, role: "Editor" });
  });

  it("succeeds for an Admin-role token (Admin exceeds the default Editor minimum)", async () => {
    const result = await checkGrafanaConnectionDoctor({
      fetchTokenInfo: fakeFetch({ orgId: 7, role: "Admin" }),
      orgAllowlist: ["7"],
    });
    expect(result.ok).toBe(true);
  });

  it("fails when the token's org is outside the allowlist", async () => {
    const result = await checkGrafanaConnectionDoctor({
      fetchTokenInfo: fakeFetch({ orgId: 99, role: "Editor" }),
      orgAllowlist: ["7"],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/org allowlist/);
  });

  it("fails when the org allowlist is empty (refuses rather than trusting any org)", async () => {
    const result = await checkGrafanaConnectionDoctor({
      fetchTokenInfo: fakeFetch({ orgId: 7, role: "Admin" }),
      orgAllowlist: [],
    });
    expect(result.ok).toBe(false);
  });

  it("fails when the token role is below the required minimum", async () => {
    const result = await checkGrafanaConnectionDoctor({
      fetchTokenInfo: fakeFetch({ orgId: 7, role: "Viewer" }),
      orgAllowlist: ["7"],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/does not meet the required minimum/);
  });

  it("honors a caller-supplied minimumRole override", async () => {
    const result = await checkGrafanaConnectionDoctor({
      fetchTokenInfo: fakeFetch({ orgId: 7, role: "Viewer" }),
      orgAllowlist: ["7"],
      minimumRole: "Viewer",
    });
    expect(result.ok).toBe(true);
  });

  it("fails when the token role is unrecognized", async () => {
    const result = await checkGrafanaConnectionDoctor({
      fetchTokenInfo: fakeFetch({ orgId: 7, role: "SuperUser" }),
      orgAllowlist: ["7"],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/not a recognized Grafana role/);
  });

  it("reports informatively, never throws, when the token-info request itself fails", async () => {
    const result = await checkGrafanaConnectionDoctor({
      fetchTokenInfo: async () => {
        throw new Error("connection refused");
      },
      orgAllowlist: ["7"],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/token-info request failed/);
  });

  it("reports a generic reason when the token-info request throws a non-Error value", async () => {
    const result = await checkGrafanaConnectionDoctor({
      fetchTokenInfo: async () => {
        throw "not an Error instance";
      },
      orgAllowlist: ["7"],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/unknown error/);
  });
});
