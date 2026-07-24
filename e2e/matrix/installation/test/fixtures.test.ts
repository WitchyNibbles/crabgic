import { existsSync } from "node:fs";
import { createGitPlumbing } from "@eo/git-engine";
import { describe, expect, it } from "vitest";
import {
  buildCleanRepo,
  buildDirtyRepo,
  buildEmptyDir,
  buildInvalidGitDir,
  buildMonorepoRepo,
  buildUnbornHeadRepo,
} from "../src/fixtures.js";

const plumbing = createGitPlumbing();

describe("fixture builders (real fs/git, throwaway temp dirs)", () => {
  it("buildEmptyDir: a plain dir, no .git", async () => {
    const fixture = await buildEmptyDir();
    try {
      expect(existsSync(fixture.dir)).toBe(true);
      expect(existsSync(`${fixture.dir}/.git`)).toBe(false);
    } finally {
      await fixture.cleanup();
      expect(existsSync(fixture.dir)).toBe(false);
    }
  });

  it("buildInvalidGitDir: .git exists but is not a real repo", async () => {
    const fixture = await buildInvalidGitDir();
    try {
      expect(existsSync(`${fixture.dir}/.git`)).toBe(true);
      const result = await plumbing.run(["rev-parse", "--is-inside-work-tree"], {
        cwd: fixture.dir,
        allowFailure: true,
      });
      expect(result.exitCode).not.toBe(0);
    } finally {
      await fixture.cleanup();
    }
  });

  it("buildUnbornHeadRepo: a real repo with no commits yet", async () => {
    const fixture = await buildUnbornHeadRepo();
    try {
      const inside = await plumbing.run(["rev-parse", "--is-inside-work-tree"], {
        cwd: fixture.dir,
      });
      expect(inside.stdout.trim()).toBe("true");
      const head = await plumbing.run(["rev-parse", "HEAD"], {
        cwd: fixture.dir,
        allowFailure: true,
      });
      expect(head.exitCode).not.toBe(0);
    } finally {
      await fixture.cleanup();
    }
  });

  it("buildCleanRepo: a real repo with a real commit and a clean status", async () => {
    const fixture = await buildCleanRepo();
    try {
      const head = await plumbing.run(["rev-parse", "HEAD"], { cwd: fixture.dir });
      expect(head.stdout.trim()).toMatch(/^[0-9a-f]{40}$/);
      const status = await plumbing.run(["status", "--porcelain"], { cwd: fixture.dir });
      expect(status.stdout.trim()).toBe("");
    } finally {
      await fixture.cleanup();
    }
  });

  it("buildDirtyRepo: a real repo with an uncommitted modification", async () => {
    const fixture = await buildDirtyRepo();
    try {
      const status = await plumbing.run(["status", "--porcelain"], { cwd: fixture.dir });
      expect(status.stdout.trim().length).toBeGreaterThan(0);
    } finally {
      await fixture.cleanup();
    }
  });

  it("buildMonorepoRepo: a real repo with a committed nested package.json", async () => {
    const fixture = await buildMonorepoRepo();
    try {
      expect(existsSync(`${fixture.dir}/packages/widget/package.json`)).toBe(true);
      const status = await plumbing.run(["status", "--porcelain"], { cwd: fixture.dir });
      expect(status.stdout.trim()).toBe("");
    } finally {
      await fixture.cleanup();
    }
  });
});
