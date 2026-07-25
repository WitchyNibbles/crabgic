import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildRealGatewayToolRegistry } from "../bootstrap.js";

let home: string;

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "eo-gateway-registry-"));
});

afterEach(async () => {
  await rm(home, { recursive: true, force: true });
});

function realRegistry() {
  return buildRealGatewayToolRegistry({
    xdgEnv: { HOME: home },
    projectHash: "registry-hash",
  });
}

/**
 * The eight families interface-ledger Gap 1 counts, and the leaf names each
 * contributes. Asserted against the REAL production builder — the whole
 * point of this file is that the shipped `gateway mcp` server is populated,
 * which it was not until 2026-07-25: `cli-entry.ts` booted an empty
 * registry, so every one of these was unreachable from the binary.
 */
const EXPECTED_TOOL_NAMES = [
  // 16 native — tracker (7)
  "tracker.search",
  "tracker.get",
  "tracker.plan_create",
  "tracker.plan_update",
  "tracker.plan_transition",
  "tracker.plan_comment",
  "tracker.apply",
  // 16 native — observability (6)
  "observability.search",
  "observability.get",
  "observability.query",
  "observability.plan_create",
  "observability.plan_update",
  "observability.apply",
  // 16 native — evidence (2), result (1), forwarded run.* (2)
  "evidence.attach",
  "evidence.get",
  "result.submit",
  "run.status",
  "run.cancel",
  // 11 (2)
  "project.inspect",
  "contract.approve",
  // 12 (2)
  "capability.audit",
  "capability.approve",
];

describe("buildRealGatewayToolRegistry", () => {
  it("registers every family the shipped binary is supposed to expose", () => {
    expect([...realRegistry().toolNames].sort()).toEqual([...EXPECTED_TOOL_NAMES].sort());
  });

  it("gives every registered tool a real, invocable handler — never a descriptor-only stub", () => {
    for (const tool of realRegistry().list()) {
      expect(typeof tool.handler, `${tool.name} has no handler`).toBe("function");
      expect(tool.description.length, `${tool.name} has no description`).toBeGreaterThan(0);
    }
  });

  /**
   * `project.inspect` is the one family leaf that needs no external
   * connection and no pre-minted token, so it is the honest end-to-end
   * proof that a handler reaches real subsystems: it reads 04's journal and
   * the durable ChangeSet registry, and degrades gracefully before either
   * has content rather than throwing.
   */
  it("INVOKES project.inspect against the real journal and ChangeSet registry", async () => {
    const result = await realRegistry().get("project.inspect")!.handler({});
    const report = JSON.parse(result.content[0]!.text) as {
      changeSets: unknown[];
      degraded: string[];
    };

    expect(report.changeSets).toEqual([]);
    expect(report.degraded.length).toBeGreaterThan(0);
  });

  /**
   * `contract.approve` must refuse before it ever reaches token
   * verification when the ChangeSet is unknown — the fail-closed path a
   * caller hits with a fabricated id.
   */
  it("refuses contract.approve for an unknown ChangeSet without consulting the token", async () => {
    const result = await realRegistry()
      .get("contract.approve")!
      .handler({
        changeSetId: "00000000-0000-4000-8000-000000000000",
        digest: "a".repeat(64),
        token: "not-a-real-token",
      });

    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain("unknown ChangeSet");
  });

  /** A tracker call with no connector configured must map to a typed connector error, not an unhandled throw. */
  it("answers a tracker call with a typed error when no connection is configured", async () => {
    const result = await realRegistry().get("tracker.search")!.handler({
      connectionId: "missing-connection",
      params: {},
    });

    expect(result.isError).toBe(true);
  });
});
