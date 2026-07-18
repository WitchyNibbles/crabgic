import { chmod, mkdir, mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  assertPathMode,
  createControlSocketServer,
  ensureRuntimeDir,
  RuntimePermissionError,
} from "./runtime-dir.js";
import { SUPERVISOR_RUNTIME_DIR_MODE, SUPERVISOR_SOCKET_MODE } from "./xdg-supervisor-layout.js";

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "eo-supervisor-runtime-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

function modeBits(mode: number): number {
  return mode & 0o777;
}

describe("ensureRuntimeDir", () => {
  it("creates the runtime dir with exactly mode 0700, regardless of umask", async () => {
    const dir = join(root, "run");
    await ensureRuntimeDir(dir);
    const st = await stat(dir);
    expect(modeBits(st.mode)).toBe(SUPERVISOR_RUNTIME_DIR_MODE);
  });

  it("hardens an already-existing, loosely-permissioned dir back to 0700", async () => {
    const dir = join(root, "run");
    // A "default perms" dir, as a naive `fs.mkdir(dir, {recursive:true})`
    // (no explicit mode) would leave it, subject to umask — deliberately
    // wider than 0700 to prove `ensureRuntimeDir` actively hardens rather
    // than merely creating-if-absent.
    await mkdir(dir, { recursive: true, mode: 0o777 });
    await chmod(dir, 0o777);
    const before = await stat(dir);
    expect(modeBits(before.mode)).toBe(0o777);

    await ensureRuntimeDir(dir);
    const after = await stat(dir);
    expect(modeBits(after.mode)).toBe(SUPERVISOR_RUNTIME_DIR_MODE);
  });
});

describe("assertPathMode", () => {
  it("throws RuntimePermissionError (with path/expected/actual populated) when the mode does not match", async () => {
    const dir = join(root, "wrong-mode");
    await mkdir(dir, { recursive: true, mode: 0o755 });
    await chmod(dir, 0o755);

    let caught: unknown;
    try {
      await assertPathMode(dir, 0o700);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(RuntimePermissionError);
    const err = caught as RuntimePermissionError;
    expect(err.path).toBe(dir);
    expect(err.expectedMode).toBe(0o700);
    expect(err.actualMode).toBe(0o755);
    expect(err.message).toContain("0755");
    expect(err.message).toContain("0700");
  });

  it("resolves without throwing when the mode already matches", async () => {
    const dir = join(root, "right-mode");
    await mkdir(dir, { recursive: true, mode: 0o700 });
    await chmod(dir, 0o700);
    await expect(assertPathMode(dir, 0o700)).resolves.toBeUndefined();
  });
});

describe("createControlSocketServer", () => {
  it("binds a UDS socket file with exactly mode 0600, regardless of umask", async () => {
    const dir = join(root, "run");
    await ensureRuntimeDir(dir);
    const socketPath = join(dir, "control.sock");

    const server = await createControlSocketServer(socketPath, () => {
      // no-op connection listener for this permission-only test
    });
    try {
      const st = await stat(socketPath);
      expect(modeBits(st.mode)).toBe(SUPERVISOR_SOCKET_MODE);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
