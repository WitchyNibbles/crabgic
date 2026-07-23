import { describe, expect, it } from "vitest";
import {
  DuplicateProviderError,
  ProviderRegistry,
  UnknownProviderError,
} from "./provider-registry.js";

interface FakeTrackerClient {
  readonly kind: string;
}

describe("ProviderRegistry", () => {
  it("resolves the correct client for a registered provider", () => {
    const registry = new ProviderRegistry<FakeTrackerClient>();
    const jiraClient: FakeTrackerClient = { kind: "jira" };
    const grafanaClient: FakeTrackerClient = { kind: "grafana" };
    registry.register("jira", jiraClient);
    registry.register("grafana", grafanaClient);

    expect(registry.resolve("jira")).toBe(jiraClient);
    expect(registry.resolve("grafana")).toBe(grafanaClient);
  });

  it("rejects an unrecognized provider before any network call could be attempted", () => {
    const registry = new ProviderRegistry<FakeTrackerClient>();
    registry.register("jira", { kind: "jira" });

    expect(() => registry.resolve("unknown-provider")).toThrow(UnknownProviderError);
  });

  it("rejects a duplicate-name registration attempt", () => {
    const registry = new ProviderRegistry<FakeTrackerClient>();
    registry.register("jira", { kind: "jira" });

    expect(() => registry.register("jira", { kind: "jira-again" })).toThrow(DuplicateProviderError);
  });

  it("isRegistered reflects registration state", () => {
    const registry = new ProviderRegistry<FakeTrackerClient>();
    expect(registry.isRegistered("jira")).toBe(false);
    registry.register("jira", { kind: "jira" });
    expect(registry.isRegistered("jira")).toBe(true);
  });

  it("registeredProviders lists every registered provider key", () => {
    const registry = new ProviderRegistry<FakeTrackerClient>();
    registry.register("jira", { kind: "jira" });
    registry.register("grafana", { kind: "grafana" });
    expect([...registry.registeredProviders].sort()).toEqual(["grafana", "jira"]);
  });
});
