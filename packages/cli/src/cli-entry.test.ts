import { describe, expect, it, vi } from "vitest";
import { EXIT_NOT_IMPLEMENTED, EXIT_SECRET_REJECTED, EXIT_USAGE_ERROR } from "./exit-codes.js";
import { runCliEntry } from "./cli-entry.js";
import type { CliDependencies } from "./commands/types.js";

function fakeIo() {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return {
    stdout,
    stderr,
    writeStdout: (chunk: string) => stdout.push(chunk),
    writeStderr: (chunk: string) => stderr.push(chunk),
  };
}

const unusedDeps: CliDependencies = {
  connectClient: () => {
    throw new Error("should not be called for this test");
  },
  journal: { queryEntries: async function* () {}, verifyJournal: async () => ({ segments: [], valid: true, totalValidEntries: 0 }) },
  projectHash: "hash",
};

describe("runCliEntry", () => {
  it("maps a CliUsageError from parsing to EXIT_USAGE_ERROR with a stderr diagnostic", async () => {
    const io = fakeIo();
    const exitCode = await runCliEntry(["resume"], io, { buildDependencies: () => unusedDeps });
    expect(exitCode).toBe(EXIT_USAGE_ERROR);
    expect(io.stderr.join("")).toContain("missing required argument");
  });

  it("maps a SecretValueRejectedError from parsing to EXIT_SECRET_REJECTED", async () => {
    const io = fakeIo();
    const exitCode = await runCliEntry(
      ["connection", "add", "jira", "--reference", "sk-ant-abcdefghijklmnop"],
      io,
      { buildDependencies: () => unusedDeps },
    );
    expect(exitCode).toBe(EXIT_SECRET_REJECTED);
  });

  it("boots gateway mcp via the injected runGatewayMcp, never touching buildDependencies", async () => {
    const io = fakeIo();
    const runGatewayMcp = vi.fn().mockResolvedValue(undefined);
    const buildDependencies = vi.fn(() => unusedDeps);
    const exitCode = await runCliEntry(["gateway", "mcp"], io, { buildDependencies, runGatewayMcp });
    expect(exitCode).toBe(0);
    expect(runGatewayMcp).toHaveBeenCalledOnce();
    expect(buildDependencies).not.toHaveBeenCalled();
  });

  it("dispatches a normal command through buildDependencies and writes stdout", async () => {
    const io = fakeIo();
    const exitCode = await runCliEntry(["install"], io, { buildDependencies: () => unusedDeps });
    expect(exitCode).toBe(EXIT_NOT_IMPLEMENTED);
    expect(io.stdout.join("")).toContain("install");
  });
});
