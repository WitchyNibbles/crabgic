import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runKillHarness, signalFaultPoint, type KillHarnessOperationSpec } from "./kill-harness.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = join(HERE, "kill-harness-fixtures");

const OLD_CONTENT = "A".repeat(64);
const NEW_CONTENT = "B".repeat(64);

function writerSpec(script: string, targetPath: string): KillHarnessOperationSpec {
  return {
    command: process.execPath,
    args: [join(FIXTURES_DIR, script)],
    env: {
      EO_KILL_HARNESS_TARGET: targetPath,
      EO_KILL_HARNESS_NEW: NEW_CONTENT,
    },
  };
}

function verifyContentIsOldOrNew(targetPath: string) {
  return async () => {
    const content = await readFile(targetPath, "utf8").catch(() => "");
    const recovered = content === OLD_CONTENT || content === NEW_CONTENT;
    return {
      recovered,
      detail: `content=${JSON.stringify(content.slice(0, 12))}… (len ${content.length})`,
    };
  };
}

describe("runKillHarness", () => {
  let dir: string;
  let target: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "eo-kill-harness-"));
    target = join(dir, "target.txt");
    await writeFile(target, OLD_CONTENT, "utf8");
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("catches a seeded corruption class: an unsafe in-place buffered writer with no fsync/rename leaves a torn file when killed mid-write, and reports each fault point independently", async () => {
    const report = await runKillHarness(
      writerSpec("unsafe-writer.mjs", target),
      ["before-write", "half-written"],
      { verify: verifyContentIsOldOrNew(target) },
    );

    expect(report.results).toHaveLength(2);

    const beforeWrite = report.results[0];
    expect(beforeWrite?.faultPoint).toBe("before-write");
    expect(beforeWrite?.killedAt).toBe("marker-observed");
    expect(beforeWrite?.recovered).toBe(true);
    expect(beforeWrite?.verdict).toBe("pass");

    const halfWritten = report.results[1];
    expect(halfWritten?.faultPoint).toBe("half-written");
    expect(halfWritten?.killedAt).toBe("marker-observed");
    expect(halfWritten?.recovered).toBe(false);
    expect(halfWritten?.verdict).toBe("fail");

    expect(report.allConverged).toBe(false);
  }, 15_000);

  it("passes the safe counterpart: a temp-file + rename writer never exposes a torn file at any of its fault points", async () => {
    const report = await runKillHarness(
      writerSpec("safe-writer.mjs", target),
      ["before-write", "half-written"],
      { verify: verifyContentIsOldOrNew(target) },
    );

    expect(report.results).toHaveLength(2);
    for (const result of report.results) {
      expect(result.killedAt).toBe("marker-observed");
      expect(result.recovered).toBe(true);
      expect(result.verdict).toBe("pass");
    }
    expect(report.allConverged).toBe(true);
  }, 15_000);

  it("supports an operation factory (per-fault-point spec) instead of a fixed spec", async () => {
    const seenContexts: string[] = [];
    const report = await runKillHarness(
      (ctx) => {
        seenContexts.push(ctx.faultPoint);
        return writerSpec("safe-writer.mjs", target);
      },
      ["before-write"],
      { verify: verifyContentIsOldOrNew(target) },
    );

    expect(seenContexts).toEqual(["before-write"]);
    expect(report.results[0]?.verdict).toBe("pass");
  });

  it("reports killedAt: natural-exit when the operation exits without ever signalling the requested fault point", async () => {
    const report = await runKillHarness(
      { command: process.execPath, args: [join(FIXTURES_DIR, "never-signals.mjs")] },
      ["some-fault-point-never-reached"],
      { verify: () => ({ recovered: true }) },
    );

    expect(report.results[0]?.killedAt).toBe("natural-exit");
    expect(report.results[0]?.verdict).toBe("fail");
    expect(report.results[0]?.detail).toMatch(/never observed/);
  });

  it("force-kills and reports killedAt: timeout-kill when the operation hangs past spawnTimeoutMs without the requested marker", async () => {
    const report = await runKillHarness(
      { command: process.execPath, args: [join(FIXTURES_DIR, "hangs.mjs")] },
      ["some-fault-point-never-signalled"],
      { verify: () => ({ recovered: false }), spawnTimeoutMs: 300 },
    );

    expect(report.results[0]?.killedAt).toBe("timeout-kill");
    expect(report.results[0]?.exitSignal).toBe("SIGKILL");
    expect(report.results[0]?.verdict).toBe("fail");
  }, 10_000);

  it("invokes onOperationOutput for every stdout/stderr chunk observed", async () => {
    const chunks: Array<{ text: string; stream: string }> = [];
    await runKillHarness(writerSpec("safe-writer.mjs", target), ["before-write"], {
      verify: verifyContentIsOldOrNew(target),
      onOperationOutput: (text, stream) => chunks.push({ text, stream }),
    });

    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks.some((c) => c.stream === "stdout" && c.text.includes("before-write"))).toBe(true);
  });

  it("rejects when the operation command cannot be spawned at all", async () => {
    await expect(
      runKillHarness(
        { command: join(FIXTURES_DIR, "definitely-does-not-exist.mjs"), args: [] },
        ["x"],
        { verify: () => ({ recovered: true }) },
      ),
    ).rejects.toThrow();
  });

  it("propagates stderr chunks to onOperationOutput (a fixture that errors out writes to stderr, not stdout)", async () => {
    const chunks: Array<{ text: string; stream: string }> = [];
    const report = await runKillHarness(
      { command: process.execPath, args: [join(FIXTURES_DIR, "unsafe-writer.mjs")], env: {} },
      ["before-write"],
      {
        verify: () => ({ recovered: false }),
        onOperationOutput: (text, stream) => chunks.push({ text, stream }),
      },
    );

    // No EO_KILL_HARNESS_TARGET env var set: the fixture writes its usage
    // error to stderr and exits immediately, never reaching "before-write".
    expect(chunks.some((c) => c.stream === "stderr")).toBe(true);
    expect(report.results[0]?.killedAt).toBe("natural-exit");
  });

  it("leaves detail undefined when the fault point WAS exercised and verify() supplies none", async () => {
    const report = await runKillHarness(writerSpec("safe-writer.mjs", target), ["before-write"], {
      verify: () => ({ recovered: true }),
    });
    expect(report.results[0]?.verdict).toBe("pass");
    expect(report.results[0]?.detail).toBeUndefined();
  });
});

describe("signalFaultPoint — unit", () => {
  it("writes the exact marker-prefixed line to this process's own stdout", () => {
    const spy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    try {
      signalFaultPoint("my-point");
      expect(spy).toHaveBeenCalledWith("__EO_KILL_HARNESS_FAULT__:my-point\n");
    } finally {
      spy.mockRestore();
    }
  });
});
