import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  buildBasicFixtureRepo,
  commitAll,
  commitAllHonoringHooks,
  freshTmpDir,
  initFixtureRepo,
  plumbing,
  withCleanup,
  writeFixtureFile,
} from "../src/fixtures.js";

describe("fixture builders (real fs/git, throwaway temp dirs)", () => {
  it("buildBasicFixtureRepo: a real repo on branch main with one real commit", async () => {
    const repo = await buildBasicFixtureRepo();
    try {
      expect(repo.headObjectId).toMatch(/^[0-9a-f]{40}$/);
      const branch = await plumbing.run(["branch", "--show-current"], { cwd: repo.dir });
      expect(branch.stdout.trim()).toBe("main");
      expect(existsSync(`${repo.dir}/README.md`)).toBe(true);
    } finally {
      await repo.cleanup();
      expect(existsSync(repo.dir)).toBe(false);
    }
  });

  it("initFixtureRepo with objectFormat sha256 produces a real SHA-256 repo", async () => {
    const dir = await freshTmpDir("format-test");
    const fixture = withCleanup(dir);
    try {
      await initFixtureRepo(dir, { objectFormat: "sha256" });
      const result = await plumbing.run(["rev-parse", "--show-object-format"], { cwd: dir });
      expect(result.stdout.trim()).toBe("sha256");
    } finally {
      await fixture.cleanup();
    }
  });

  it("writeFixtureFile creates parent directories as needed", async () => {
    const repo = await buildBasicFixtureRepo();
    try {
      const path = await writeFixtureFile(repo.dir, "deep/nested/dir/file.txt", "content\n");
      expect(existsSync(path)).toBe(true);
    } finally {
      await repo.cleanup();
    }
  });

  it("commitAll uses --no-verify (fixture commits never depend on ambient hooks)", async () => {
    const repo = await buildBasicFixtureRepo();
    try {
      await writeFixtureFile(repo.dir, "x.txt", "x\n");
      const objectId = await commitAll(repo.dir, "x commit");
      expect(objectId).toMatch(/^[0-9a-f]{40}$/);
    } finally {
      await repo.cleanup();
    }
  });

  it("commitAllHonoringHooks omits --no-verify so a real hook has a chance to fire", async () => {
    const repo = await buildBasicFixtureRepo();
    try {
      await writeFixtureFile(repo.dir, "y.txt", "y\n");
      const objectId = await commitAllHonoringHooks(repo.dir, "y commit");
      expect(objectId).toMatch(/^[0-9a-f]{40}$/);
    } finally {
      await repo.cleanup();
    }
  });
});
