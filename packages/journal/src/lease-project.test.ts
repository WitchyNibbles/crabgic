import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveLeasesDir } from "./layout/xdg-layout.js";
import { acquireProjectLease } from "./lease-project.js";

/**
 * VALIDATION ROUND (2026-07-18) fix, F6: `acquireProjectLease(projectHash)`
 * closes the roadmap/04 §Interfaces produced signature gap the exit-
 * criteria validator flagged (`Lease.acquire(projectHash)` named there;
 * the real primary API is `Lease.acquire(leaseDir, projectHash, opts)`).
 */
describe("acquireProjectLease — convenience wrapper resolving leaseDir via the real XDG environment", () => {
  let stateHome: string;
  let originalXdgStateHome: string | undefined;

  beforeEach(async () => {
    stateHome = await mkdtemp(join(tmpdir(), "eo-lease-project-xdg-state-"));
    originalXdgStateHome = process.env["XDG_STATE_HOME"];
    process.env["XDG_STATE_HOME"] = stateHome;
  });

  afterEach(async () => {
    if (originalXdgStateHome === undefined) delete process.env["XDG_STATE_HOME"];
    else process.env["XDG_STATE_HOME"] = originalXdgStateHome;
    await rm(stateHome, { recursive: true, force: true });
  });

  it("acquires a lease at the SAME path resolveLeasesDir/Lease.acquire(leaseDir, ...) would compute directly", async () => {
    const projectHash = "proj-acquire-convenience";
    const lease = await acquireProjectLease(projectHash, {
      pid: 555,
      clock: { now: () => 1_000_000 },
      readProcessStartTime: async () => 42,
      autoRenew: false,
      ttlMs: 30_000,
    });

    try {
      expect(lease.held).toBe(true);
      expect(lease.projectHash).toBe(projectHash);
      expect(lease.leaseDir).toBe(
        resolveLeasesDir(
          { HOME: process.env["HOME"] ?? "", XDG_STATE_HOME: stateHome },
          projectHash,
        ),
      );
      const raw = await readFile(lease.leasePath, "utf8");
      expect((JSON.parse(raw) as Record<string, unknown>)["pid"]).toBe(555);
    } finally {
      await lease.release();
    }
  });

  it("a second acquireProjectLease for the SAME projectHash is denied while the first is live (delegates real contention semantics)", async () => {
    const projectHash = "proj-acquire-convenience-contended";
    const clock = { now: () => 1_000_000 };
    const lease = await acquireProjectLease(projectHash, {
      pid: 1,
      clock,
      readProcessStartTime: async () => 1,
      autoRenew: false,
    });

    try {
      await expect(
        acquireProjectLease(projectHash, {
          pid: 2,
          clock,
          readProcessStartTime: async () => 1,
          autoRenew: false,
        }),
      ).rejects.toThrow();
    } finally {
      await lease.release();
    }
  });
});
