import { describe, expect, it } from "vitest";
import {
  DEFAULT_MODEL_ALIAS,
  DEFAULT_ROUTER_CONFIG,
  resolveModelForRole,
  RouterConfigSchema,
} from "./router.js";

describe("resolveModelForRole", () => {
  it("resolves 'architect' to the opus balanced default", () => {
    expect(resolveModelForRole("architect")).toBe("opus");
  });

  it("resolves 'planner' to opus", () => {
    expect(resolveModelForRole("planner")).toBe("opus");
  });

  it("resolves 'integration_review' and 'security_review' to opus", () => {
    expect(resolveModelForRole("integration_review")).toBe("opus");
    expect(resolveModelForRole("security_review")).toBe("opus");
  });

  it("resolves a mechanical-chore role to haiku", () => {
    expect(resolveModelForRole("chore")).toBe("haiku");
    expect(resolveModelForRole("mechanical_chore")).toBe("haiku");
  });

  it("resolves 'implementation' to sonnet", () => {
    expect(resolveModelForRole("implementation")).toBe("sonnet");
  });

  it("falls back to the balanced sonnet default for an unrecognized role", () => {
    expect(resolveModelForRole("some-brand-new-role-nobody-registered")).toBe(DEFAULT_MODEL_ALIAS);
  });

  it("is case- and separator-insensitive against the role-alias map", () => {
    expect(resolveModelForRole("Architect")).toBe("opus");
    expect(resolveModelForRole("SECURITY-REVIEW")).toBe("opus");
    expect(resolveModelForRole("  planner  ")).toBe("opus");
  });

  it("an override ALWAYS wins, regardless of the role-alias map", () => {
    expect(resolveModelForRole("architect", DEFAULT_ROUTER_CONFIG, "haiku")).toBe("haiku");
    expect(resolveModelForRole("unrecognized-role", DEFAULT_ROUTER_CONFIG, "opus")).toBe("opus");
  });

  it("accepts a caller-supplied narrower/custom RouterConfig", () => {
    const custom = RouterConfigSchema.parse({ roleAliasMap: { custom_role: "opus" } });
    expect(resolveModelForRole("custom_role", custom)).toBe("opus");
    expect(resolveModelForRole("architect", custom)).toBe(DEFAULT_MODEL_ALIAS); // not in the CUSTOM map
  });
});

describe("RouterConfigSchema", () => {
  it("defaults roleAliasMap to an empty object when omitted", () => {
    const parsed = RouterConfigSchema.parse({});
    expect(parsed.roleAliasMap).toEqual({});
  });

  it("rejects a model alias outside the closed MODEL_ALIASES union", () => {
    expect(() => RouterConfigSchema.parse({ roleAliasMap: { x: "gpt-5" } })).toThrow();
  });
});
