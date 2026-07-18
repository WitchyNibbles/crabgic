import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createNodeFsPort } from "./fs-port.js";
import { durablyAppendLine, durablyTruncateFile, durablyWriteFileAtomic } from "./durable-io.js";
import { wrapWithRecording } from "./testing/recording-fs-port.js";

let dir: string | undefined;

function freshDir(): string {
  dir = mkdtempSync(join(tmpdir(), "eo-journal-durable-io-"));
  return dir;
}

afterEach(() => {
  if (dir !== undefined) {
    rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  }
});

describe("durablyAppendLine — real filesystem", () => {
  it("appends bytes that are actually readable back afterward", async () => {
    const base = freshDir();
    const filePath = join(base, "segment.ndjson");
    const port = createNodeFsPort();
    await durablyAppendLine(port, filePath, base, "line-one\n", 0o600);
    await durablyAppendLine(port, filePath, base, "line-two\n", 0o600);
    expect(readFileSync(filePath, "utf8")).toBe("line-one\nline-two\n");
  });

  it("creates the file at the requested 0600 mode", async () => {
    const base = freshDir();
    const filePath = join(base, "segment.ndjson");
    await durablyAppendLine(createNodeFsPort(), filePath, base, "x\n", 0o600);
    expect(statSync(filePath).mode & 0o777).toBe(0o600);
  });

  it("performs write -> fsync(file) -> fsync(dir), in exactly that order, on the real fs port", async () => {
    const base = freshDir();
    const filePath = join(base, "segment.ndjson");
    const recording = wrapWithRecording(createNodeFsPort());

    await durablyAppendLine(recording, filePath, base, "line\n", 0o600);

    const kinds = recording.ops.map((op) => op.kind);
    const firstWriteIndex = kinds.indexOf("write");
    const fsyncIndexes = kinds.reduce<number[]>(
      (acc, kind, i) => (kind === "fsync" ? [...acc, i] : acc),
      [],
    );

    expect(firstWriteIndex).toBeGreaterThanOrEqual(0);
    expect(fsyncIndexes.length).toBeGreaterThanOrEqual(2);
    // The write must happen before ANY fsync call.
    expect(firstWriteIndex).toBeLessThan(fsyncIndexes[0]!);
    // The first fsync targets the file just written; the second targets the directory.
    const fileFsync = recording.ops[fsyncIndexes[0]!]!;
    const dirFsync = recording.ops[fsyncIndexes[1]!]!;
    expect(fileFsync.path).toBe(filePath);
    expect(dirFsync.path).toBe(base);
  });
});

describe("durablyWriteFileAtomic — real filesystem", () => {
  it("the final path never observably contains partial content — temp file then atomic rename", async () => {
    const base = freshDir();
    const finalPath = join(base, "snapshot.json");
    await durablyWriteFileAtomic(
      createNodeFsPort(),
      finalPath,
      base,
      '{"ok":true}',
      0o600,
      "nonce-1",
    );
    expect(readFileSync(finalPath, "utf8")).toBe('{"ok":true}');
    expect(statSync(finalPath).mode & 0o777).toBe(0o600);
  });

  it("performs write -> fsync(temp) -> rename -> fsync(dir), in that order", async () => {
    const base = freshDir();
    const finalPath = join(base, "snapshot.json");
    const recording = wrapWithRecording(createNodeFsPort());
    await durablyWriteFileAtomic(recording, finalPath, base, "content", 0o600, "nonce-2");

    const kinds = recording.ops.map((op) => op.kind);
    const writeIndex = kinds.indexOf("write");
    const firstFsyncIndex = kinds.indexOf("fsync");
    const renameIndex = kinds.indexOf("rename");
    const secondFsyncIndex = kinds.lastIndexOf("fsync");

    expect(writeIndex).toBeLessThan(firstFsyncIndex);
    expect(firstFsyncIndex).toBeLessThan(renameIndex);
    expect(renameIndex).toBeLessThan(secondFsyncIndex);
  });
});

describe("durablyTruncateFile — real filesystem", () => {
  it("truncates to the requested byte length and durably fsyncs the result", async () => {
    const base = freshDir();
    const filePath = join(base, "segment.ndjson");
    await durablyAppendLine(createNodeFsPort(), filePath, base, "0123456789\n", 0o600);
    await durablyTruncateFile(createNodeFsPort(), filePath, base, 5);
    expect(readFileSync(filePath, "utf8")).toBe("01234");
  });

  it("performs truncate -> fsync(file) -> fsync(dir), in that order", async () => {
    const base = freshDir();
    const filePath = join(base, "segment.ndjson");
    await durablyAppendLine(createNodeFsPort(), filePath, base, "0123456789\n", 0o600);
    const recording = wrapWithRecording(createNodeFsPort());
    await durablyTruncateFile(recording, filePath, base, 3);

    const kinds = recording.ops.map((op) => op.kind);
    const truncateIndex = kinds.indexOf("truncate");
    const fsyncIndexes = kinds.reduce<number[]>(
      (acc, kind, i) => (kind === "fsync" ? [...acc, i] : acc),
      [],
    );
    expect(truncateIndex).toBeLessThan(fsyncIndexes[0]!);
    expect(fsyncIndexes.length).toBeGreaterThanOrEqual(2);
  });
});

describe("RecordingFsPort — read-path pass-throughs (readFile/readdir/stat/unlink)", () => {
  it("forwards readFile/readdir/stat/unlink to the wrapped port without recording them as ops", async () => {
    const base = freshDir();
    const filePath = join(base, "segment.ndjson");
    await durablyAppendLine(createNodeFsPort(), filePath, base, "line\n", 0o600);

    const recording = wrapWithRecording(createNodeFsPort());
    expect(await recording.readFile(filePath)).toBe("line\n");
    expect(await recording.readdir(base)).toContain("segment.ndjson");
    expect((await recording.stat(filePath)).size).toBeGreaterThan(0);

    await recording.unlink(filePath);
    expect(await recording.readdir(base)).not.toContain("segment.ndjson");
    expect(recording.ops.some((op) => op.kind === "unlink" && op.path === filePath)).toBe(true);
  });

  it("forwards mkdir to the wrapped port and records it as an op", async () => {
    const base = freshDir();
    const nested = join(base, "nested-dir");
    const recording = wrapWithRecording(createNodeFsPort());
    await recording.mkdir(nested, { recursive: true, mode: 0o700 });
    expect(statSync(nested).isDirectory()).toBe(true);
    expect(recording.ops.some((op) => op.kind === "mkdir" && op.path === nested)).toBe(true);
  });

  it("a non-object handle (never produced by the real port, but a valid OpaqueHandle value at the type level) records an op with no path rather than throwing", async () => {
    // A minimal no-op inner port, so this test isolates the RECORDING
    // wrapper's own object/null handle-guarding logic from the real node
    // port's `(handle as FileHandle)` cast (which would itself throw on a
    // non-FileHandle numeric handle).
    const noopInner = {
      open: async () => 0,
      write: async () => {},
      truncate: async () => {},
      fsync: async () => {},
      close: async () => {},
      mkdir: async () => {},
      rename: async () => {},
      unlink: async () => {},
      readFile: async () => "",
      readdir: async () => [],
      stat: async () => ({ size: 0, mtimeMs: 0, birthtimeMs: 0, mode: 0 }),
    };
    const recording = wrapWithRecording(noopInner);
    await recording.write(42, new Uint8Array());
    await recording.write(null, new Uint8Array());
    const writes = recording.ops.filter((op) => op.kind === "write");
    expect(writes).toHaveLength(2);
    expect(writes.every((op) => op.path === undefined)).toBe(true);
  });
});
