import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createCapabilityStore, type AuditReport, type CapabilityStore } from "@eo/detect";
import { createTestJournal, type TestJournal } from "./test-support/test-journal.js";
import { createGateRegistry } from "./registry.js";
import {
  createGitleaksGate,
  createOsvScannerGate,
  createRootCausePolicyGate,
  createSemgrepGate,
} from "./security-gate.js";
import type { GateContext } from "./types.js";

let tj: TestJournal;
let capRootDir: string;
let capStore: CapabilityStore;
let baseContext: Omit<GateContext, "objectId" | "stage">;

function pin(store: CapabilityStore, candidateName: string, digest: string): void {
  const report: AuditReport = {
    candidateName,
    kind: "external_tool",
    digest,
    permissionFootprint: [],
    stages: [{ stage: "manifest_entry", passed: true, detail: "ok" }],
    scanFindings: [],
    decision: "approved",
    auditedAt: new Date(0).toISOString(),
  };
  store.save(report);
}

beforeEach(async () => {
  tj = await createTestJournal();
  capRootDir = await mkdtemp(join(tmpdir(), "eo-gates-security-capstore-"));
  capStore = createCapabilityStore(capRootDir);
  baseContext = { changeSetId: randomUUID(), journal: tj.store };
});

afterEach(async () => {
  await tj.cleanup();
  await rm(capRootDir, { recursive: true, force: true });
});

describe("security gate — seeded-finding fixtures block", () => {
  it("gitleaks: a planted AWS-shaped test key blocks", async () => {
    pin(capStore, "gitleaks", "sha256:gitleaks-pinned");
    const registry = createGateRegistry();
    registry.register(
      "security",
      "gitleaks",
      createGitleaksGate({
        capabilityStore: capStore,
        observedDigest: "sha256:gitleaks-pinned",
        report: [
          {
            Description: "AWS Access Key",
            File: "fixture.env",
            RuleID: "aws-access-token",
            Match: "AKIAABCDEFGHIJKLMNOP",
          },
        ],
      }),
    );
    const [result] = await registry.fireByTag("security", {
      ...baseContext,
      stage: "verifying",
      objectId: "obj",
    });
    expect(result?.verdict.passed).toBe(false);
  });

  it("osv-scanner: a known-CVE test double blocks", async () => {
    pin(capStore, "osv-scanner", "sha256:osv-pinned");
    const registry = createGateRegistry();
    registry.register(
      "security",
      "osv-scanner",
      createOsvScannerGate({
        capabilityStore: capStore,
        observedDigest: "sha256:osv-pinned",
        report: {
          results: [
            {
              source: { path: "package-lock.json" },
              packages: [
                {
                  package: { name: "vuln-test-double", version: "0.0.1", ecosystem: "npm" },
                  vulnerabilities: [
                    { id: "CVE-2024-11111", database_specific: { severity: "CRITICAL" } },
                  ],
                },
              ],
            },
          ],
        },
      }),
    );
    const [result] = await registry.fireByTag("security", {
      ...baseContext,
      stage: "verifying",
      objectId: "obj",
    });
    expect(result?.verdict.passed).toBe(false);
  });

  it("semgrep: an intentionally vulnerable pattern blocks", async () => {
    pin(capStore, "semgrep", "sha256:semgrep-pinned");
    const registry = createGateRegistry();
    registry.register(
      "security",
      "semgrep",
      createSemgrepGate({
        capabilityStore: capStore,
        observedDigest: "sha256:semgrep-pinned",
        report: {
          results: [
            {
              check_id: "javascript.lang.security.audit.sqli",
              path: "src/db.js",
              extra: { severity: "ERROR", message: "SQL injection" },
            },
          ],
        },
      }),
    );
    const [result] = await registry.fireByTag("security", {
      ...baseContext,
      stage: "verifying",
      objectId: "obj",
    });
    expect(result?.verdict.passed).toBe(false);
  });

  it("root-cause detector: a disabled-check diff (commented-out assertion) flags, blocking when configured", async () => {
    const registry = createGateRegistry();
    registry.register(
      "security",
      "root-cause-policy",
      createRootCausePolicyGate({
        diffText: "+  // assert(result === expected);",
        blocking: true,
      }),
    );
    const [result] = await registry.fireByTag("security", {
      ...baseContext,
      stage: "verifying",
      objectId: "obj",
    });
    expect(result?.verdict.passed).toBe(false);
  });

  it("root-cause detector stays advisory (non-blocking) by default", async () => {
    const registry = createGateRegistry();
    registry.register(
      "security",
      "root-cause-policy",
      createRootCausePolicyGate({ diffText: "+  // assert(result === expected);" }),
    );
    const [result] = await registry.fireByTag("security", {
      ...baseContext,
      stage: "verifying",
      objectId: "obj",
    });
    expect(result?.verdict.passed).toBe(true);
  });
});

describe("NIT-1 (adversarial-validation round): a parser exception must fail CLOSED (block), never propagate/crash the firing", () => {
  it("semgrep: a report carrying an unexpected/out-of-enum severity value blocks instead of throwing", async () => {
    pin(capStore, "semgrep", "sha256:semgrep-pinned");
    const registry = createGateRegistry();
    registry.register(
      "security",
      "semgrep",
      createSemgrepGate({
        capabilityStore: capStore,
        observedDigest: "sha256:semgrep-pinned",
        // "CRITICAL" is not one of semgrep's own three severities
        // (ERROR/WARNING/INFO) — this fails parseSemgrepReport's zod parse.
        report: {
          results: [
            {
              check_id: "x",
              path: "y",
              extra: { severity: "CRITICAL" as never, message: "m" },
            },
          ],
        },
      }),
    );
    const results = await registry.fireByTag("security", {
      ...baseContext,
      stage: "verifying",
      objectId: "obj",
    });
    expect(results).toHaveLength(1);
    expect(results[0]?.verdict.passed).toBe(false);
    expect(results[0]?.verdict.detail).toMatch(/parsing failed|fail.*closed/i);
  });

  it("gitleaks: a malformed report blocks instead of throwing", async () => {
    pin(capStore, "gitleaks", "sha256:gitleaks-pinned");
    const registry = createGateRegistry();
    registry.register(
      "security",
      "gitleaks",
      createGitleaksGate({
        capabilityStore: capStore,
        observedDigest: "sha256:gitleaks-pinned",
        report: [{ bogus: true } as never],
      }),
    );
    const results = await registry.fireByTag("security", {
      ...baseContext,
      stage: "verifying",
      objectId: "obj",
    });
    expect(results[0]?.verdict.passed).toBe(false);
  });

  it("osv-scanner: a malformed report blocks instead of throwing", async () => {
    pin(capStore, "osv-scanner", "sha256:osv-pinned");
    const registry = createGateRegistry();
    registry.register(
      "security",
      "osv-scanner",
      createOsvScannerGate({
        capabilityStore: capStore,
        observedDigest: "sha256:osv-pinned",
        report: { results: [{ bogus: true }] as never },
      }),
    );
    const results = await registry.fireByTag("security", {
      ...baseContext,
      stage: "verifying",
      objectId: "obj",
    });
    expect(results[0]?.verdict.passed).toBe(false);
  });
});

describe("security gate — digest mismatch fails CLOSED rather than running a stale/tampered binary", () => {
  it("semgrep resolution fails closed when the observed digest no longer matches the pinned one", async () => {
    pin(capStore, "semgrep", "sha256:original-pinned");
    const registry = createGateRegistry();
    registry.register(
      "security",
      "semgrep",
      createSemgrepGate({
        capabilityStore: capStore,
        observedDigest: "sha256:TAMPERED",
        report: { results: [] },
      }),
    );
    const [result] = await registry.fireByTag("security", {
      ...baseContext,
      stage: "verifying",
      objectId: "obj",
    });
    expect(result?.verdict.passed).toBe(false);
    expect(result?.verdict.detail).toMatch(/fail.*closed/i);
  });

  it("gitleaks resolution fails closed when no pinned entry exists at all", async () => {
    const registry = createGateRegistry();
    registry.register(
      "security",
      "gitleaks",
      createGitleaksGate({
        capabilityStore: capStore,
        observedDigest: "sha256:whatever",
        report: [],
      }),
    );
    const [result] = await registry.fireByTag("security", {
      ...baseContext,
      stage: "verifying",
      objectId: "obj",
    });
    expect(result?.verdict.passed).toBe(false);
  });
});

describe("security gate — multiple registrants under the shared 'security' tag (14's own scanners alongside 21's connector fixtures)", () => {
  it("a clean run across every registered scanner passes overall", async () => {
    pin(capStore, "semgrep", "d1");
    pin(capStore, "gitleaks", "d2");
    pin(capStore, "osv-scanner", "d3");
    const registry = createGateRegistry();
    registry.register(
      "security",
      "semgrep",
      createSemgrepGate({
        capabilityStore: capStore,
        observedDigest: "d1",
        report: { results: [] },
      }),
    );
    registry.register(
      "security",
      "gitleaks",
      createGitleaksGate({ capabilityStore: capStore, observedDigest: "d2", report: [] }),
    );
    registry.register(
      "security",
      "osv-scanner",
      createOsvScannerGate({
        capabilityStore: capStore,
        observedDigest: "d3",
        report: { results: [] },
      }),
    );
    const results = await registry.fireByTag("security", {
      ...baseContext,
      stage: "verifying",
      objectId: "obj",
    });
    expect(results).toHaveLength(3);
    expect(results.every((r) => r.verdict.passed)).toBe(true);
  });
});
