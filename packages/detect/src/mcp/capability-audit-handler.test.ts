import { afterEach, describe, expect, it } from "vitest";
import { freshTmpDir, removeDirTree } from "../test-support/fixture-repo.js";
import {
  createFailingJournal,
  createRecordingJournal,
  type RecordingJournal,
} from "../test-support/recording-journal.js";
import { createCapabilityStore } from "../capability-store/store.js";
import {
  CAPABILITY_AUDIT_VERDICT_DECISION,
  CapabilityAuditJournalUnavailableError,
  parseCapabilityAuditVerdict,
} from "../capability-store/audit-journal.js";
import { runCapabilityAudit } from "./capability-audit-handler.js";

const BENIGN_SKILL = {
  kind: "skill",
  name: "benign-skill",
  files: [{ path: "SKILL.md", content: "# ordinary\n" }],
  permissionFootprint: ["Read(./**)"],
};

/** Trips `../quarantine/scanners/secret-scanner.ts` at stage 4 — a candidate that reaches `scan` and is rejected there with real findings. */
const SECRET_LEAKING_SKILL = {
  kind: "skill",
  name: "leaky-skill",
  files: [{ path: "SKILL.md", content: "-----BEGIN OPENSSH PRIVATE KEY-----\n" }],
  permissionFootprint: ["Read(./**)"],
};

describe("runCapabilityAudit", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) removeDirTree(d);
  });
  let journal: RecordingJournal;
  function newStore() {
    const dir = freshTmpDir();
    dirs.push(dir);
    journal = createRecordingJournal();
    return createCapabilityStore(dir, { journal });
  }
  /** The audit handler's own deps, sharing the store's journal sink. */
  function newDeps() {
    return { store: newStore(), journal };
  }

  it("runs the pipeline, persists the report into the store, and reports 'no prior audit' the first time", async () => {
    const deps = newDeps();
    const { report, reaudit } = await runCapabilityAudit({ candidate: BENIGN_SKILL }, deps);
    expect(report.decision).toBe("pending");
    expect(reaudit?.requiresReaudit).toBe(true);
    expect(reaudit?.reason).toContain("no prior audit");
    expect(deps.store.list()).toHaveLength(1);
  });

  it("reports no re-audit required for a second, byte-identical audit of the same candidate", async () => {
    const deps = newDeps();
    await runCapabilityAudit({ candidate: BENIGN_SKILL }, deps);
    const { reaudit } = await runCapabilityAudit({ candidate: BENIGN_SKILL }, deps);
    expect(reaudit?.requiresReaudit).toBe(false);
  });

  it("reports re-audit required when the candidate's content changed since the last audit", async () => {
    const deps = newDeps();
    await runCapabilityAudit({ candidate: BENIGN_SKILL }, deps);
    const { reaudit } = await runCapabilityAudit(
      { candidate: { ...BENIGN_SKILL, files: [{ path: "SKILL.md", content: "# updated\n" }] } },
      deps,
    );
    expect(reaudit?.requiresReaudit).toBe(true);
    expect(reaudit?.reason).toContain("digest changed");
  });

  it("still runs and persists the (rejected) report for an invalid candidate, with no reaudit info", async () => {
    const deps = newDeps();
    const { report, reaudit } = await runCapabilityAudit({ candidate: { kind: "skill" } }, deps);
    expect(report.decision).toBe("rejected");
    expect(reaudit).toBeUndefined();
  });

  /**
   * Adversarial-review finding (LOW/MEDIUM, confirmed dead guard): the
   * unsigned-digest-swap provenance guard (stage 3) used to never fire in
   * production because `runCapabilityAudit` never threaded the store's
   * previous digest into `runQuarantinePipeline` — only a hand-built test
   * calling the pipeline directly with a manually-injected
   * `previousDigest` ever exercised it. This test goes through the REAL
   * handler entry point only (no manual injection) and proves the guard
   * now genuinely fires: a second audit of the SAME capability name with
   * DIFFERENT content and no accompanying valid signature is rejected at
   * `verify_provenance`, never reaches `scan`/`sandbox_test`/
   * `manifest_entry`.
   */
  it("REJECTS at stage verify_provenance on a real unsigned digest swap, reached only through runCapabilityAudit itself", async () => {
    const deps = newDeps();
    const first = await runCapabilityAudit({ candidate: BENIGN_SKILL }, deps);
    expect(first.report.decision).toBe("pending");

    const second = await runCapabilityAudit(
      { candidate: { ...BENIGN_SKILL, files: [{ path: "SKILL.md", content: "# updated\n" }] } },
      deps,
    );
    expect(second.report.stages.map((s) => s.stage)).toEqual(["fetch", "pin", "verify_provenance"]);
    expect(second.report.stages.at(-1)?.passed).toBe(false);
    expect(second.report.decision).toBe("rejected");
  });

  it("does NOT reject a second, byte-identical audit (unchanged digest never trips the swap guard)", async () => {
    const deps = newDeps();
    await runCapabilityAudit({ candidate: BENIGN_SKILL }, deps);
    const second = await runCapabilityAudit({ candidate: BENIGN_SKILL }, deps);
    expect(second.report.decision).toBe("pending");
  });

  /**
   * interface-ledger Gap 5, resolution (2026-08-01). Before this, a
   * capability-audit verdict produced ZERO journal entries anywhere: the
   * handler saved only into the capability store, and a REJECTED candidate
   * left no central, tamper-evident record at all (the store's
   * `report.json` is a rewritable artifact, and only a `trust approve`
   * MINT ever reached the journal — a rejection never mints). The verdict
   * now journals as an `adjudication_decision`, the same closed-at-13
   * reuse precedent phase 14 already set for its own gate/flake evidence.
   */
  it("journals a rejected verdict as an adjudication_decision before saving it", async () => {
    const deps = newDeps();
    const { report } = await runCapabilityAudit({ candidate: { kind: "skill" } }, deps);

    expect(report.decision).toBe("rejected");
    expect(deps.journal.entries).toHaveLength(1);
    const [entry] = deps.journal.entries;
    expect(entry?.type).toBe("adjudication_decision");
    expect(entry?.payload.decision).toBe(CAPABILITY_AUDIT_VERDICT_DECISION);

    const verdict = parseCapabilityAuditVerdict(entry?.payload.rationale ?? "");
    expect(verdict?.decision).toBe("rejected");
    expect(verdict?.reachedManifestEntry).toBe(false);
    expect(verdict?.stages.map((s) => s.stage)).toEqual(["fetch"]);
    expect(verdict?.stages.every((s) => !s.passed)).toBe(true);
  });

  it("journals the full verdict — per-stage pass/fail, scan-finding count and severities, digest, re-audit reason", async () => {
    const deps = newDeps();
    await runCapabilityAudit({ candidate: SECRET_LEAKING_SKILL }, deps);

    const verdict = parseCapabilityAuditVerdict(deps.journal.entries[0]?.payload.rationale ?? "");
    expect(verdict?.candidateName).toBe("leaky-skill");
    expect(verdict?.kind).toBe("skill");
    expect(verdict?.digest).toMatch(/^sha256:/);
    expect(verdict?.decision).toBe("rejected");
    expect(verdict?.stages.map((s) => s.stage)).toEqual([
      "fetch",
      "pin",
      "verify_provenance",
      "scan",
    ]);
    expect(verdict?.scanFindingCount).toBeGreaterThan(0);
    expect(verdict?.scanFindingSeverities).toContain("critical");
    expect(verdict?.reauditRequired).toBe(true);
    expect(verdict?.reauditReason).toContain("no prior audit");
    expect(verdict?.storeKey).toHaveLength(64);
  });

  it("journals BEFORE persisting — a journal failure aborts the audit and stores nothing", async () => {
    const store = newStore();
    await expect(
      runCapabilityAudit({ candidate: BENIGN_SKILL }, { store, journal: createFailingJournal() }),
    ).rejects.toThrow(/journal append failed/);
    expect(store.list()).toHaveLength(0);
  });

  it("fails CLOSED when no journal sink is supplied — never silently audits unjournaled", async () => {
    const store = newStore();
    await expect(runCapabilityAudit({ candidate: BENIGN_SKILL }, { store })).rejects.toBeInstanceOf(
      CapabilityAuditJournalUnavailableError,
    );
    expect(store.list()).toHaveLength(0);
  });
});
