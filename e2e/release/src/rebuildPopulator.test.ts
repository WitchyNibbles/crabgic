import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createRebuildFromCleanCheckoutPopulator,
  realRunCommand,
  REBUILD_CHECKOUTS_ENV_VAR,
  resolveBuildOutputPopulator,
  type RunCommandFn,
} from "./rebuildPopulator.js";

const dirs: string[] = [];
async function makeDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "eo-rebuild-populator-"));
  dirs.push(dir);
  return dir;
}
afterEach(async () => {
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

describe("createRebuildFromCleanCheckoutPopulator", () => {
  it("declares that it rebuilds from the clean checkout, and runs `npm ci` then `npm run build` IN THE CHECKOUT ROOT", async () => {
    const calls: { command: string; args: readonly string[]; cwd: string }[] = [];
    const runCommand: RunCommandFn = async (command, args, cwd) => {
      calls.push({ command, args, cwd });
    };
    const populator = createRebuildFromCleanCheckoutPopulator({ runCommand });
    expect(populator.rebuildsFromCleanCheckout).toBe(true);

    await populator.populate("/checkout");
    expect(calls).toEqual([
      { command: "npm", args: ["ci"], cwd: "/checkout" },
      { command: "npm", args: ["run", "build"], cwd: "/checkout" },
    ]);
  });

  it("propagates a build failure rather than silently leaving the checkout unbuilt", async () => {
    const runCommand: RunCommandFn = async (_command, args) => {
      if (args[0] === "run") throw new Error("tsc -b exploded");
    };
    const populator = createRebuildFromCleanCheckoutPopulator({ runCommand });
    await expect(populator.populate("/checkout")).rejects.toThrow("tsc -b exploded");
  });
});

describe("resolveBuildOutputPopulator — the release-e2e-only env gate", () => {
  it("defaults to the copy-current-dist populator when the env flag is unset (the offline `npm run test:e2e` leg)", async () => {
    const populator = resolveBuildOutputPopulator({
      repoRoot: "/repo",
      packageSubPath: "packages/cli",
      env: {},
    });
    expect(populator.rebuildsFromCleanCheckout).toBe(false);
  });

  it("still defaults to copy-current-dist for any value other than the opt-in `1`", async () => {
    const populator = resolveBuildOutputPopulator({
      repoRoot: "/repo",
      packageSubPath: "packages/cli",
      env: { [REBUILD_CHECKOUTS_ENV_VAR]: "0" },
    });
    expect(populator.rebuildsFromCleanCheckout).toBe(false);
  });

  it("selects the REBUILDING populator when release-e2e sets the flag to `1`", async () => {
    const populator = resolveBuildOutputPopulator({
      repoRoot: "/repo",
      packageSubPath: "packages/cli",
      env: { [REBUILD_CHECKOUTS_ENV_VAR]: "1" },
    });
    expect(populator.rebuildsFromCleanCheckout).toBe(true);
  });

  it("passes an INJECTED runCommand through to the rebuilding populator it returns", async () => {
    // Without this case the resolver's `runCommand` forwarding is dead
    // weight: every other resolve test omits the injected runner, so the
    // only seam that makes the rebuilding populator drivable through the
    // resolver — the way `releaseGateSummary.ts` reaches it — is never
    // exercised end to end. Asserting on the populator's DECLARED flag
    // alone would not have caught a resolver that silently dropped the
    // injection and shelled out for real.
    const calls: { command: string; args: readonly string[]; cwd: string }[] = [];
    const runCommand: RunCommandFn = async (command, args, cwd) => {
      calls.push({ command, args, cwd });
    };
    const populator = resolveBuildOutputPopulator({
      repoRoot: "/repo",
      packageSubPath: "packages/cli",
      env: { [REBUILD_CHECKOUTS_ENV_VAR]: "1" },
      runCommand,
    });
    await populator.populate("/checkout");
    expect(calls).toEqual([
      { command: "npm", args: ["ci"], cwd: "/checkout" },
      { command: "npm", args: ["run", "build"], cwd: "/checkout" },
    ]);
  });
});

describe("realRunCommand — genuine child process", () => {
  it("resolves for a command that exits 0", async () => {
    const cwd = await makeDir();
    await expect(realRunCommand("node", ["--version"], cwd)).resolves.toBeUndefined();
  });

  it("rejects with the command line and its stderr for a command that exits non-zero", async () => {
    const cwd = await makeDir();
    await expect(
      realRunCommand("node", ["-e", "process.stderr.write('boom'); process.exit(3)"], cwd),
    ).rejects.toThrow(/node -e/);
  });
});
