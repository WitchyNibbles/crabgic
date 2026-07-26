import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { FakeCheckoutExporter, GitArchiveExporter } from "./checkoutExporter.js";

const execFileAsync = promisify(execFile);

describe("FakeCheckoutExporter — unit", () => {
  it("writes the registered fixture files for a known commit-ish into a fresh directory", async () => {
    const exporter = new FakeCheckoutExporter(
      new Map([
        ["deadbeef", { "package.json": '{"name":"fixture"}', "dist/index.js": "export {};" }],
      ]),
    );
    const dir = await exporter.exportCheckout("deadbeef", "packages/fixture");
    try {
      const pkg = await readFile(join(dir, "package.json"), "utf8");
      expect(pkg).toBe('{"name":"fixture"}');
      const index = await readFile(join(dir, "dist", "index.js"), "utf8");
      expect(index).toBe("export {};");
    } finally {
      await exporter.cleanup(dir);
    }
  });

  it("two exports of the same commit-ish produce two INDEPENDENT directories with identical content", async () => {
    const exporter = new FakeCheckoutExporter(new Map([["c1", { "a.txt": "same content" }]]));
    const dirA = await exporter.exportCheckout("c1", "sub");
    const dirB = await exporter.exportCheckout("c1", "sub");
    try {
      expect(dirA).not.toBe(dirB);
      const [a, b] = await Promise.all([
        readFile(join(dirA, "a.txt"), "utf8"),
        readFile(join(dirB, "a.txt"), "utf8"),
      ]);
      expect(a).toBe(b);
    } finally {
      await exporter.cleanup(dirA);
      await exporter.cleanup(dirB);
    }
  });

  it("throws for an unregistered commit-ish", async () => {
    const exporter = new FakeCheckoutExporter(new Map());
    await expect(exporter.exportCheckout("unknown", "sub")).rejects.toThrow(
      "no fixture files registered",
    );
  });

  it("cleanup is safe to call more than once", async () => {
    const exporter = new FakeCheckoutExporter(new Map([["c1", { "a.txt": "x" }]]));
    const dir = await exporter.exportCheckout("c1", "sub");
    await exporter.cleanup(dir);
    await expect(exporter.cleanup(dir)).resolves.toBeUndefined();
  });
});

describe("GitArchiveExporter — genuine integration (real git archive + tar, this repo's own HEAD)", () => {
  it("exports packages/cli's committed source tree (no dist/ — gitignored, never committed) at HEAD", async () => {
    const { stdout: repoRootRaw } = await execFileAsync("git", ["rev-parse", "--show-toplevel"], {
      cwd: import.meta.dirname,
    });
    const repoRoot = repoRootRaw.trim();
    const exporter = new GitArchiveExporter({ repoRoot });
    const dir = await exporter.exportCheckout("HEAD", "packages/cli");
    try {
      const pkg = JSON.parse(await readFile(join(dir, "package.json"), "utf8")) as {
        readonly name: string;
      };
      expect(pkg.name).toBe("crabgic");
      // dist/ is gitignored (never committed) — a real clean checkout of
      // committed source alone never contains build output.
      await expect(readFile(join(dir, "dist", "index.js"), "utf8")).rejects.toThrow();
    } finally {
      await exporter.cleanup(dir);
    }
  });

  it("exports the WHOLE repository — a buildable tree — when no subPath is given", async () => {
    const { stdout: repoRootRaw } = await execFileAsync("git", ["rev-parse", "--show-toplevel"], {
      cwd: import.meta.dirname,
    });
    const repoRoot = repoRootRaw.trim();
    const exporter = new GitArchiveExporter({ repoRoot });
    const dir = await exporter.exportCheckout("HEAD");
    try {
      // The three things a `npm ci && npm run build` in this export needs,
      // and which a `HEAD:packages/cli` sub-path export never contained:
      // the workspace root manifest, the lockfile, and the sibling
      // workspaces the CLI's own build depends on.
      const rootManifest = JSON.parse(await readFile(join(dir, "package.json"), "utf8")) as {
        readonly workspaces?: readonly string[];
      };
      expect(rootManifest.workspaces).toBeDefined();
      await expect(readFile(join(dir, "package-lock.json"), "utf8")).resolves.toContain(
        "lockfileVersion",
      );
      await expect(readFile(join(dir, "tsconfig.base.json"), "utf8")).resolves.toContain(
        "compilerOptions",
      );
      const cliManifest = JSON.parse(
        await readFile(join(dir, "packages", "cli", "package.json"), "utf8"),
      ) as { readonly name: string };
      expect(cliManifest.name).toBe("crabgic");
    } finally {
      await exporter.cleanup(dir);
    }
  }, 30_000);

  it("two independent exports of the identical commit-ish produce byte-identical committed content", async () => {
    const { stdout: repoRootRaw } = await execFileAsync("git", ["rev-parse", "--show-toplevel"], {
      cwd: import.meta.dirname,
    });
    const repoRoot = repoRootRaw.trim();
    const exporter = new GitArchiveExporter({ repoRoot });
    const dirA = await exporter.exportCheckout("HEAD", "packages/cli");
    const dirB = await exporter.exportCheckout("HEAD", "packages/cli");
    try {
      expect(dirA).not.toBe(dirB);
      const [a, b] = await Promise.all([
        readFile(join(dirA, "package.json"), "utf8"),
        readFile(join(dirB, "package.json"), "utf8"),
      ]);
      expect(a).toBe(b);
    } finally {
      await exporter.cleanup(dirA);
      await exporter.cleanup(dirB);
      await rm(dirA, { recursive: true, force: true }).catch(() => undefined);
      await rm(dirB, { recursive: true, force: true }).catch(() => undefined);
    }
  });

  it("rejects (rather than hangs or silently succeeds) for a nonexistent commit-ish", async () => {
    const { stdout: repoRootRaw } = await execFileAsync("git", ["rev-parse", "--show-toplevel"], {
      cwd: import.meta.dirname,
    });
    const repoRoot = repoRootRaw.trim();
    const exporter = new GitArchiveExporter({ repoRoot });
    await expect(
      exporter.exportCheckout("0000000000000000000000000000000000000000", "packages/cli"),
    ).rejects.toThrow();
  });

  it("rejects when the git binary itself cannot be spawned (real ENOENT 'error' event, injected binary name)", async () => {
    const { stdout: repoRootRaw } = await execFileAsync("git", ["rev-parse", "--show-toplevel"], {
      cwd: import.meta.dirname,
    });
    const repoRoot = repoRootRaw.trim();
    const exporter = new GitArchiveExporter({
      repoRoot,
      gitBinary: "eo-definitely-not-a-real-git-binary-xyz",
    });
    await expect(exporter.exportCheckout("HEAD", "packages/cli")).rejects.toThrow();
  });

  it("rejects when the tar binary itself cannot be spawned (real ENOENT 'error' event, injected binary name)", async () => {
    const { stdout: repoRootRaw } = await execFileAsync("git", ["rev-parse", "--show-toplevel"], {
      cwd: import.meta.dirname,
    });
    const repoRoot = repoRootRaw.trim();
    const exporter = new GitArchiveExporter({
      repoRoot,
      tarBinary: "eo-definitely-not-a-real-tar-binary-xyz",
    });
    await expect(exporter.exportCheckout("HEAD", "packages/cli")).rejects.toThrow();
  });

  it('rejects with a "tar -x" failure when git archive succeeds but the extraction step itself fails', async () => {
    const { stdout: repoRootRaw } = await execFileAsync("git", ["rev-parse", "--show-toplevel"], {
      cwd: import.meta.dirname,
    });
    const repoRoot = repoRootRaw.trim();
    // "false" is a real, always-exits-1 POSIX utility, swapped in for
    // "tar", so `archive` genuinely succeeds (exit 0) while `extract`
    // genuinely fails (exit 1) — exercising the extractExit !== 0 branch
    // for real rather than via a mock. `.changeset` is a deliberately TINY
    // sub-path (two small files) so the whole `git archive` tar stream
    // fits well within a single pipe buffer even though nothing ever
    // reads `extract`'s stdin (a real, unread OS pipe only blocks the
    // writer once its buffer — several tens of KB — actually fills).
    const exporter = new GitArchiveExporter({ repoRoot, tarBinary: "false" });
    await expect(exporter.exportCheckout("HEAD", ".changeset")).rejects.toThrow('"tar -x" failed');
  }, 15_000);
});
