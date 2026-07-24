import { randomBytes } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { ApprovalTokenMinter } from "engineering-orchestrator";
import { freshTmpDir, removeDirTree } from "../test-support/fixture-repo.js";
import { createCapabilityStore } from "../capability-store/store.js";
import { createApprovalLedger } from "../capability-store/approval-ledger.js";
import { runQuarantinePipeline } from "../quarantine/pipeline.js";
import type { TrustCommandDependencies } from "./dependencies.js";
import { runTrustReviewCommand } from "./trust-review.js";
import { runTrustApproveCommand } from "./trust-approve.js";
import { runTrustRevokeCommand } from "./trust-revoke.js";

const BENIGN_SKILL = {
  kind: "skill",
  name: "benign-skill",
  files: [{ path: "SKILL.md", content: "# ordinary\n" }],
  permissionFootprint: ["Read(./**)"],
};

/**
 * roadmap/12 exit criterion: "CLI `trust review|approve|revoke` replaces
 * 09's `NOT_IMPLEMENTED` stub end-to-end against a real supervisor in a
 * tmp dir." **Deviation (flagged in the phase-12 final report):** this
 * task's file-scope authority is `packages/detect/` + `docs/evidence/
 * phase-12/` only — it cannot edit `packages/cli/src/commands/dispatch.ts`
 * to actually route the CLI's `trust-review`/`trust-approve`/
 * `trust-revoke` argv commands to these handlers, nor `packages/supervisor`
 * to add a real UDS op for them. This suite instead exercises the FULL,
 * REAL backend chain these handlers are built from end-to-end within one
 * process — a real on-disk capability store (tmp dir), a real
 * `ApprovalTokenMinter`, and a real on-disk approval ledger — mirroring
 * 09's own documented decision (`docs/evidence/phase-09/README.md`,
 * "#6 (approval-token cross-process durability)") that the minter is
 * legitimately in-process-scoped, collapsing "cross-process" to
 * "cross-MCP-tool-call/cross-CLI-invocation within one process."
 */
describe("trust review|approve|revoke — end-to-end backend chain", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) removeDirTree(d);
  });

  function newDeps(): TrustCommandDependencies {
    const root = freshTmpDir();
    dirs.push(root);
    return {
      store: createCapabilityStore(root),
      minter: new ApprovalTokenMinter({ secretKey: randomBytes(32) }),
      approvalLedger: createApprovalLedger(root),
    };
  }

  it("trust review reports 'no audits' before anything has been audited", () => {
    const deps = newDeps();
    const result = runTrustReviewCommand({ command: "trust-review", json: false }, deps);
    expect(result.stdout).toContain("no capability audits");
  });

  it("trust review renders a human-readable line per entry (non-json), most-recently-audited first", () => {
    const deps = newDeps();
    const first = runQuarantinePipeline(BENIGN_SKILL);
    deps.store.save(first.report, first.manifestEntry);
    const second = runQuarantinePipeline({ ...BENIGN_SKILL, name: "another-skill" });
    deps.store.save(second.report, second.manifestEntry);

    const result = runTrustReviewCommand({ command: "trust-review", json: false }, deps);
    expect(result.stdout).toContain('[pending] skill "benign-skill"');
    expect(result.stdout).toContain('[pending] skill "another-skill"');
  });

  it("trust revoke renders a human-readable confirmation (non-json)", async () => {
    const deps = newDeps();
    const { report, manifestEntry } = runQuarantinePipeline(BENIGN_SKILL);
    deps.store.save(report, manifestEntry);
    const minted = await runTrustApproveCommand(
      { command: "trust-approve", digest: report.digest, json: true },
      deps,
    );
    const { tokenId } = JSON.parse(minted.stdout ?? "{}") as { tokenId: string };

    const result = runTrustRevokeCommand({ command: "trust-revoke", tokenId, json: false }, deps);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("revoked approval");
  });

  it("trust revoke reports a human-readable, non-throwing error for an unknown token id (non-json)", () => {
    const deps = newDeps();
    const result = runTrustRevokeCommand(
      { command: "trust-revoke", tokenId: "never-minted", json: false },
      deps,
    );
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("no approval record found");
  });

  it("full flow: audit -> trust review lists it pending -> trust approve mints a token -> capability.approve verifies it (exercised via the minter directly) -> trust revoke reverts it", async () => {
    const deps = newDeps();
    const { report, manifestEntry } = runQuarantinePipeline(BENIGN_SKILL);
    const saved = deps.store.save(report, manifestEntry);

    const review = runTrustReviewCommand({ command: "trust-review", json: true }, deps);
    expect(review.stdout).toContain('"pending"');

    const approve = await runTrustApproveCommand(
      { command: "trust-approve", digest: report.digest, json: true },
      deps,
    );
    expect(approve.exitCode).toBe(0);
    const minted = JSON.parse(approve.stdout ?? "{}") as { tokenId: string };
    expect(typeof minted.tokenId).toBe("string");

    // Simulates capability.approve verifying the minted token (the MCP
    // handler's own responsibility, tested independently in
    // ../mcp/capability-approve-handler.test.ts) and flipping the decision.
    deps.minter.verify(JSON.parse(approve.stdout ?? "{}").token as string, {
      subjectKind: "capability_digest",
      digest: report.digest,
    });
    deps.store.updateDecision(saved.key, "approved");
    expect(deps.store.load(saved.key)?.report.decision).toBe("approved");

    const revoke = runTrustRevokeCommand(
      { command: "trust-revoke", tokenId: minted.tokenId, json: true },
      deps,
    );
    expect(revoke.exitCode).toBe(0);
    expect(deps.store.load(saved.key)?.report.decision).toBe("rejected");
  });

  it("trust approve mints without ever itself flipping the stored decision (only capability.approve does that)", async () => {
    const deps = newDeps();
    const { report, manifestEntry } = runQuarantinePipeline(BENIGN_SKILL);
    const saved = deps.store.save(report, manifestEntry);

    await runTrustApproveCommand(
      { command: "trust-approve", digest: report.digest, json: false },
      deps,
    );
    expect(deps.store.load(saved.key)?.report.decision).toBe("pending");
  });

  it("trust revoke fails gracefully (non-zero exit, no throw) for an unknown token id", () => {
    const deps = newDeps();
    const result = runTrustRevokeCommand(
      { command: "trust-revoke", tokenId: "never-minted", json: false },
      deps,
    );
    expect(result.exitCode).not.toBe(0);
  });
});
