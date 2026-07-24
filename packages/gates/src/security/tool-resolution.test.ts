import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createCapabilityStore, type CapabilityStore } from "@eo/detect";
import type { AuditReport } from "@eo/detect";
import { resolveDigestPinnedTool } from "./tool-resolution.js";
import { MissingCapabilityEntryError, ToolDigestMismatchError } from "../errors.js";

let rootDir: string;
let store: CapabilityStore;

function buildAuditReport(overrides: Partial<AuditReport> = {}): AuditReport {
  return {
    candidateName: "semgrep",
    kind: "external_tool",
    digest: "sha256:pinned-digest",
    permissionFootprint: [],
    stages: [{ stage: "manifest_entry", passed: true, detail: "ok" }],
    scanFindings: [],
    decision: "approved",
    auditedAt: new Date(0).toISOString(),
    ...overrides,
  };
}

beforeEach(async () => {
  rootDir = await mkdtemp(join(tmpdir(), "eo-gates-capstore-"));
  store = createCapabilityStore(rootDir);
});

afterEach(async () => {
  await rm(rootDir, { recursive: true, force: true });
});

describe("resolveDigestPinnedTool — fail-closed digest resolution", () => {
  it("resolves successfully when the observed digest matches the pinned entry", () => {
    store.save(buildAuditReport());
    const resolved = resolveDigestPinnedTool(store, "semgrep", "sha256:pinned-digest");
    expect(resolved).toEqual({ toolName: "semgrep", digest: "sha256:pinned-digest" });
  });

  it("fails CLOSED with MissingCapabilityEntryError when no pinned entry exists at all", () => {
    expect(() => resolveDigestPinnedTool(store, "gitleaks", "sha256:whatever")).toThrow(
      MissingCapabilityEntryError,
    );
  });

  it("fails CLOSED with ToolDigestMismatchError when the observed digest no longer matches the pinned one — never runs a stale/tampered binary", () => {
    store.save(buildAuditReport());
    expect(() => resolveDigestPinnedTool(store, "semgrep", "sha256:tampered")).toThrow(
      ToolDigestMismatchError,
    );
  });
});
