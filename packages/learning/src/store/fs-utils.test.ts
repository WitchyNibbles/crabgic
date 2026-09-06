import { chmod, mkdir, mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ensureDir } from "./fs-utils.js";

let root: string;
let originalUmask: number;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "eo-learning-fs-utils-"));
  originalUmask = process.umask(0o022);
});

afterEach(async () => {
  process.umask(originalUmask);
  await rm(root, { recursive: true, force: true });
});

describe("ensureDir", () => {
  /**
   * The umask is set explicitly above rather than inherited, so this is a
   * real discrimination and not a coincidence of the ambient environment:
   * `mkdir(dir, {mode: 0o777})` under umask 0o022 yields 0o755, and only the
   * follow-up `chmod` makes the on-disk mode the one that was asked for.
   * Vitest runs each test file in its own forked process, so the umask
   * change cannot reach another file.
   */
  it("chmods a directory it created, so the umask cannot narrow the requested mode", async () => {
    const dir = join(root, "fresh");
    await ensureDir(dir, 0o777);
    expect((await stat(dir)).mode & 0o777).toBe(0o777);
  });

  it("creates intermediate parents", async () => {
    const dir = join(root, "a", "b", "c");
    await ensureDir(dir, 0o700);
    expect((await stat(dir)).isDirectory()).toBe(true);
  });

  it("is idempotent on a directory that already has the requested mode", async () => {
    const dir = join(root, "twice");
    await ensureDir(dir, 0o700);
    await ensureDir(dir, 0o700);
    expect((await stat(dir)).mode & 0o777).toBe(0o700);
  });

  /**
   * The counterpart to the chmod above. An EXISTING directory's mode is left
   * exactly as it is: re-chmodding one silently widens a mode something
   * narrowed deliberately — which is how `case-fixture-store.ts`'s `seal()`
   * used to be undone by that class's own `write()`.
   */
  it("leaves an existing directory's narrower mode alone", async () => {
    const dir = join(root, "sealed");
    await mkdir(dir, { recursive: true, mode: 0o700 });
    await chmod(dir, 0o500);
    await ensureDir(dir, 0o700);
    expect((await stat(dir)).mode & 0o777).toBe(0o500);
  });
});
