import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createCapabilityStore, type AuditReport } from "@eo/detect";
import { createTestJournal, type TestJournal } from "./test-support/test-journal.js";
import { createGateRegistry } from "./registry.js";
import { createCoverageGate } from "./coverage-gate.js";
import { createFlakeGate } from "./flake-gate.js";
import {
  createGitleaksGate,
  createOsvScannerGate,
  createRootCausePolicyGate,
  createSemgrepGate,
} from "./security-gate.js";
import { createEngineConformanceGate } from "./engine-conformance-gate.js";
import type { GateContext } from "./types.js";

/**
 * `gates-conformance` — roadmap/14 §Exit criteria: "`gates-conformance` CI
 * job blocks correctly on all SEVEN seeded fixtures independently: coverage
 * regression, flaky-then-passing test, planted secret, vulnerable
 * dependency, SAST finding, disabled-check diff, missing green
 * `engine-live` record." Named, standalone-runnable — this exact file is
 * what `.github/workflows/gates-conformance.yml` invokes
 * (`npx vitest run packages/gates/src/gates-conformance.test.ts`). Each of
 * the 7 scenarios below is INDEPENDENT (its own gate registry, its own
 * temp journal) so a failure in one never masks or depends on another.
 */

let tj: TestJournal;
let baseContext: Omit<GateContext, "objectId" | "stage">;

beforeEach(async () => {
  tj = await createTestJournal();
  baseContext = { changeSetId: randomUUID(), journal: tj.store };
});

afterEach(async () => {
  await tj.cleanup();
});

async function fireOne(
  registry: ReturnType<typeof createGateRegistry>,
  tag: Parameters<typeof registry.fireByTag>[0],
) {
  const [result] = await registry.fireByTag(tag, {
    ...baseContext,
    stage: "verifying",
    objectId: "obj",
  });
  return result;
}

describe("gates-conformance — seeded-fault matrix (7 independent fixtures)", () => {
  it("1. coverage regression: a recorded floor of 82% followed by a 79% run BLOCKS", async () => {
    const seed = createGateRegistry();
    seed.register(
      "coverage",
      "coverage",
      createCoverageGate({
        projectId: "gates-conformance-project",
        summary: { linePct: 82, branchPct: 82, toolchain: "istanbul" },
      }),
    );
    await fireOne(seed, "coverage");

    const regressed = createGateRegistry();
    regressed.register(
      "coverage",
      "coverage",
      createCoverageGate({
        projectId: "gates-conformance-project",
        summary: { linePct: 79, branchPct: 85, toolchain: "istanbul" },
      }),
    );
    const result = await fireOne(regressed, "coverage");
    expect(result?.verdict.passed).toBe(false);
  });

  it("2. flaky-then-passing test: marked unstable and BLOCKS (not quarantined)", async () => {
    const registry = createGateRegistry();
    registry.register(
      "flake",
      "flake",
      createFlakeGate({
        testIdentifier: "suite/flaky.test",
        initialOutcome: "failed",
        rerunOutcome: "passed",
      }),
    );
    const result = await fireOne(registry, "flake");
    expect(result?.verdict.unstable).toBe(true);
    expect(result?.verdict.passed).toBe(false);
  });

  it("3. planted secret: gitleaks fixture BLOCKS", async () => {
    const capRootDir = await mkdtemp(join(tmpdir(), "eo-gates-conformance-secret-"));
    try {
      const capStore = createCapabilityStore(capRootDir);
      capStore.save(auditReportFor("gitleaks", "sha256:gitleaks-pinned"));
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
      const result = await fireOne(registry, "security");
      expect(result?.verdict.passed).toBe(false);
    } finally {
      await rm(capRootDir, { recursive: true, force: true });
    }
  });

  it("4. vulnerable dependency: osv-scanner known-CVE test double BLOCKS", async () => {
    const capRootDir = await mkdtemp(join(tmpdir(), "eo-gates-conformance-osv-"));
    try {
      const capStore = createCapabilityStore(capRootDir);
      capStore.save(auditReportFor("osv-scanner", "sha256:osv-pinned"));
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
                      { id: "CVE-2024-22222", database_specific: { severity: "CRITICAL" } },
                    ],
                  },
                ],
              },
            ],
          },
        }),
      );
      const result = await fireOne(registry, "security");
      expect(result?.verdict.passed).toBe(false);
    } finally {
      await rm(capRootDir, { recursive: true, force: true });
    }
  });

  it("5. SAST finding: semgrep vulnerable-pattern fixture BLOCKS", async () => {
    const capRootDir = await mkdtemp(join(tmpdir(), "eo-gates-conformance-semgrep-"));
    try {
      const capStore = createCapabilityStore(capRootDir);
      capStore.save(auditReportFor("semgrep", "sha256:semgrep-pinned"));
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
                extra: { severity: "ERROR", message: "SQL injection via string concatenation" },
              },
            ],
          },
        }),
      );
      const result = await fireOne(registry, "security");
      expect(result?.verdict.passed).toBe(false);
    } finally {
      await rm(capRootDir, { recursive: true, force: true });
    }
  });

  it("6. disabled-check diff: root-cause detector flags and BLOCKS when configured blocking", async () => {
    const registry = createGateRegistry();
    registry.register(
      "security",
      "root-cause-policy",
      createRootCausePolicyGate({ diffText: "+  // assert(result === expected);", blocking: true }),
    );
    const result = await fireOne(registry, "security");
    expect(result?.verdict.passed).toBe(false);
  });

  it("7. missing green engine-live record: engine-conformance gate FAILS CLOSED", async () => {
    const registry = createGateRegistry();
    registry.register(
      "engine-conformance",
      "engine-conformance",
      createEngineConformanceGate({ engineVersion: "9.9.9-never-tested" }),
    );
    const result = await fireOne(registry, "engine-conformance");
    expect(result?.verdict.passed).toBe(false);
  });
});

function auditReportFor(candidateName: string, digest: string): AuditReport {
  return {
    candidateName,
    kind: "external_tool",
    digest,
    permissionFootprint: [],
    stages: [{ stage: "manifest_entry", passed: true, detail: "ok" }],
    scanFindings: [],
    decision: "approved",
    auditedAt: new Date(0).toISOString(),
  };
}
