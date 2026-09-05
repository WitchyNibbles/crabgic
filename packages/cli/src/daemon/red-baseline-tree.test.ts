import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { GitPlumbing } from "@crabgic/git-engine";
import { withRedBaselineTree } from "./red-baseline-tree.js";

/**
 * ⚠️ THE TEST THAT DID NOT EXIST.
 *
 * The provisioning call this module exists for was added to `run-dispatcher.ts`
 * with no test, and an adversarial review round measured the consequence:
 * deleting the call left `packages/cli` green at 1517/1517, and instrumenting
 * it showed the enclosing closure is entered by no test in the default fan-out.
 * The fix was a comment with a function call attached.
 *
 * NOTHING IS MOCKED HERE EXCEPT GIT. `provisionWorktreeDependencies` is the
 * real function operating on real directories; only `GitPlumbing` is
 * substituted, which `run-dispatcher.ts` already documents as the seam
 * "overridden in tests so no real repository is touched". A spy on the
 * provisioning would have asserted that a call happens, which is the shape of
 * assertion that let the defect in.
 */

const BASE_OBJECT_ID = "0123456789abcdef0123456789abcdef01234567";
const CANDIDATE_OBJECT_ID = "fedcba9876543210fedcba9876543210fedcba98";
const SHARED_PACKAGE = "some-external-package";

let dirs: string[] = [];

async function tempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

/** A source checkout whose `node_modules` holds one entry to share. */
async function sourceCheckout(): Promise<string> {
  const dir = await tempDir("crabgic-src-");
  await mkdir(join(dir, "node_modules", SHARED_PACKAGE), { recursive: true });
  await writeFile(join(dir, "node_modules", SHARED_PACKAGE, "index.js"), "", "utf8");
  return dir;
}

interface FakePlumbing {
  readonly plumbing: GitPlumbing;
  readonly calls: string[][];
}

/** Creates the directory `worktree add` names, so the rest of the flow is real. */
function fakePlumbing(options: { failAdd?: boolean } = {}): FakePlumbing {
  const calls: string[][] = [];
  const plumbing = {
    gitBinary: "git",
    version: () => Promise.resolve("git version 2.43.0"),
    run: async (args: readonly string[]) => {
      calls.push([...args]);
      if (args[0] === "worktree" && args[1] === "add") {
        if (options.failAdd === true) throw new Error("worktree add refused");
        await mkdir(args[args.length - 2]!, { recursive: true });
      }
      return { stdout: "", stderr: "", exitCode: 0 };
    },
  } as unknown as GitPlumbing;
  return { plumbing, calls };
}

async function optionsFor(plumbing: GitPlumbing): Promise<Parameters<typeof withRedBaselineTree>[0]> {
  return {
    plumbing,
    controlDir: await tempDir("crabgic-control-"),
    worktreesRootDir: await tempDir("crabgic-wt-"),
    baseObjectId: BASE_OBJECT_ID,
    projectDir: await sourceCheckout(),
    candidateObjectId: CANDIDATE_OBJECT_ID,
    testPaths: ["src/feature.test.ts"],
  };
}

afterEach(async () => {
  for (const dir of dirs) await rm(dir, { recursive: true, force: true });
  dirs = [];
});

describe("withRedBaselineTree", () => {
  /**
   * The assertion is made INSIDE `use`, because "provisioned afterwards" and
   * "provisioned before the callback" are different facts and only the second
   * one keeps a red baseline honest.
   */
  it("provisions the tree's dependencies BEFORE handing it to the caller", async () => {
    const { plumbing } = fakePlumbing();
    const options = await optionsFor(plumbing);

    const seen = await withRedBaselineTree(options, (worktreePath) =>
      Promise.resolve(existsSync(join(worktreePath, "node_modules", SHARED_PACKAGE))),
    );

    expect(seen).toBe(true);
  });

  it("cuts the tree at the frozen base and checks out only the candidate's test paths", async () => {
    const { plumbing, calls } = fakePlumbing();
    const options = await optionsFor(plumbing);

    await withRedBaselineTree(options, () => Promise.resolve(undefined));

    expect(calls[0]?.slice(0, 4)).toEqual(["worktree", "add", "--detach", expect.any(String)]);
    expect(calls[0]?.[4]).toBe(BASE_OBJECT_ID);
    expect(calls[1]).toEqual(["checkout", CANDIDATE_OBJECT_ID, "--", "src/feature.test.ts"]);
  });

  it("removes the tree even when the caller throws", async () => {
    const { plumbing, calls } = fakePlumbing();
    const options = await optionsFor(plumbing);

    const result = await withRedBaselineTree(options, () => {
      throw new Error("the baseline capture blew up");
    });

    expect(result).toBeUndefined();
    expect(calls.some((call) => call[0] === "worktree" && call[1] === "remove")).toBe(true);
  });

  it("does nothing at all when the candidate added no test file", async () => {
    const { plumbing, calls } = fakePlumbing();
    const options = await optionsFor(plumbing);
    let entered = false;

    const result = await withRedBaselineTree({ ...options, testPaths: [] }, () => {
      entered = true;
      return Promise.resolve(1);
    });

    expect(result).toBeUndefined();
    expect(entered).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it("returns undefined, never a half-made tree, when the worktree cannot be cut", async () => {
    const { plumbing } = fakePlumbing({ failAdd: true });
    const options = await optionsFor(plumbing);
    let entered = false;

    const result = await withRedBaselineTree(options, () => {
      entered = true;
      return Promise.resolve(1);
    });

    expect(result).toBeUndefined();
    expect(entered).toBe(false);
  });
});
