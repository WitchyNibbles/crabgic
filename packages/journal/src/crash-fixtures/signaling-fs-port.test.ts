import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createNodeFsPort } from "../store/fs-port.js";
import {
  ALL_CRASH_SUITE_FAULT_POINTS,
  APPEND_STEP_POINT_NAMES,
  createSignalingFsPort,
  SNAPSHOT_STEP_POINT_NAMES,
} from "./signaling-fs-port.js";

/** Direct, in-process unit coverage for `createSignalingFsPort` itself — every wrapped method, not just the subset `append-chain-snapshot-operation.test.ts` exercises indirectly through armedAppend/armedSnapshot. */

const dirsToClean: string[] = [];
let stdoutSpy: ReturnType<typeof vi.spyOn> | undefined;

afterEach(() => {
  while (dirsToClean.length > 0) {
    rmSync(dirsToClean.pop()!, { recursive: true, force: true });
  }
  stdoutSpy?.mockRestore();
  stdoutSpy = undefined;
});

function freshDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "eo-signaling-fs-port-"));
  dirsToClean.push(dir);
  return dir;
}

describe("ALL_CRASH_SUITE_FAULT_POINTS", () => {
  it("is exactly the manual before-* points plus every step name, in order", () => {
    expect(ALL_CRASH_SUITE_FAULT_POINTS).toEqual([
      "before-append",
      ...APPEND_STEP_POINT_NAMES,
      "before-snapshot",
      ...SNAPSHOT_STEP_POINT_NAMES,
    ]);
  });
});

describe("createSignalingFsPort — every wrapped method, direct", () => {
  it("truncate: performs the real truncate and signals the corresponding point name", async () => {
    stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const dir = freshDir();
    const filePath = join(dir, "file.txt");
    writeFileSync(filePath, "0123456789", "utf8");

    const port = createSignalingFsPort(createNodeFsPort(), ["after-truncate"], 0);
    const handle = await port.open(filePath, "r+");
    await port.truncate(handle, 3);
    await port.close(handle);

    const { readFileSync } = await import("node:fs");
    expect(readFileSync(filePath, "utf8")).toBe("012");
    const signalled = stdoutSpy.mock.calls.map((call: unknown[]) => String(call[0])).join("");
    expect(signalled).toContain("after-truncate");
  });

  it("unlink: performs the real unlink WITHOUT signaling (unlink is not part of any real durable-io call sequence)", async () => {
    stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const dir = freshDir();
    const filePath = join(dir, "file.txt");
    writeFileSync(filePath, "x", "utf8");

    const port = createSignalingFsPort(createNodeFsPort(), ["should-not-fire"], 0);
    await port.unlink(filePath);

    const { existsSync } = await import("node:fs");
    expect(existsSync(filePath)).toBe(false);
    const signalled = stdoutSpy.mock.calls.map((call: unknown[]) => String(call[0])).join("");
    expect(signalled).not.toContain("should-not-fire");
  });

  it("readFile/readdir/stat/mkdir: pass through to the real port untouched (no signaling)", async () => {
    stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const dir = freshDir();
    const nested = join(dir, "nested");
    const filePath = join(dir, "file.txt");
    writeFileSync(filePath, "content", "utf8");

    const port = createSignalingFsPort(createNodeFsPort(), [], 0);
    await port.mkdir(nested, { recursive: true, mode: 0o700 });
    expect(await port.readFile(filePath)).toBe("content");
    expect(await port.readdir(dir)).toContain("file.txt");
    expect((await port.stat(filePath)).size).toBeGreaterThan(0);
  });

  it("more real calls than provided pointNames: extra calls are simply not signaled (afterStep's `name === undefined` branch)", async () => {
    stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const dir = freshDir();
    const filePath = join(dir, "file.txt");

    // Only ONE point name for TWO signal-worthy calls (open, write) — the
    // second call's afterStep finds pointNames[1] === undefined and must
    // not throw or signal a spurious marker.
    const port = createSignalingFsPort(createNodeFsPort(), ["only-point"], 0);
    const handle = await port.open(filePath, "a", 0o600);
    await port.write(handle, Buffer.from("x", "utf8"));
    await port.close(handle);

    const signalled = stdoutSpy.mock.calls.map((call: unknown[]) => String(call[0])).join("");
    expect(signalled).toContain("only-point");
    expect((signalled.match(/__EO_KILL_HARNESS_FAULT__:/g) ?? []).length).toBe(1);
  });
});
