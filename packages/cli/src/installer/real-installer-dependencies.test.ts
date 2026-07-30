import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import {
  buildRealInstallerDependencies,
  createRealConfirmGitInit,
  createRealConfirmPolicy,
  resolvePluginSourceDir,
} from "./real-installer-dependencies.js";

describe("resolvePluginSourceDir", () => {
  it("resolves @crabgic/plugin's real installed root directory via Node module resolution", () => {
    const dir = resolvePluginSourceDir();
    expect(dir).toMatch(/plugin$/);
  });
});

describe("createRealConfirmGitInit", () => {
  it('resolves true for an exact "yes" (case-insensitive, trimmed)', async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const confirm = createRealConfirmGitInit({ input, output });
    const promise = confirm();
    input.write("YES\n");
    expect(await promise).toBe(true);
  });

  it("resolves false for anything else", async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const confirm = createRealConfirmGitInit({ input, output });
    const promise = confirm();
    input.write("no thanks\n");
    expect(await promise).toBe(false);
  });

  it("writes a prompt to output before reading", async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const chunks: string[] = [];
    output.on("data", (c: Buffer) => chunks.push(c.toString("utf8")));
    const confirm = createRealConfirmGitInit({ input, output });
    const promise = confirm();
    expect(chunks.join("")).toContain("git init");
    input.write("yes\n");
    await promise;
  });
});

describe("buildRealInstallerDependencies", () => {
  it("uses the real resolvePluginSourceDir and a real confirmGitInit by default", () => {
    const deps = buildRealInstallerDependencies("/some/target/dir");
    expect(deps.targetDir).toBe("/some/target/dir");
    expect(deps.pluginSourceDir).toMatch(/plugin$/);
    expect(typeof deps.confirmGitInit).toBe("function");
  });

  it("honors explicit overrides", () => {
    const deps = buildRealInstallerDependencies("/some/target/dir", {
      pluginSourceDir: "/custom/plugin",
      confirmGitInit: async () => true,
    });
    expect(deps.pluginSourceDir).toBe("/custom/plugin");
  });
});

/**
 * The standing policy's only authoring moment, and therefore the only place
 * ledger Gap 18 part 3 — "the model can never widen the policy" — is
 * enforceable in code.
 *
 * THE EXPLOIT THESE PIN, demonstrated live 2026-07-30 before the fix:
 * `echo yes | crabgic install` from an agent's own shell authored the policy
 * that decides what runs without human review. The confirm was a bare
 * `process.stdin` read with no notion of who was answering.
 */
describe("createRealConfirmPolicy — who may author a standing grant", () => {
  const derived = {
    policy: {
      schemaVersion: 1 as const,
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      createdAt: "2026-01-01T00:00:00.000Z",
      allowedPathPrefixes: ["src"],
      allowedWriteScratchPaths: [],
      allowedCommands: [],
      allowedNetworkDestinations: [],
      allowedCredentialReferences: [],
      allowedRemoteResourceReferences: [],
      allowUnixSockets: false,
    },
  } as unknown as Parameters<ReturnType<typeof createRealConfirmPolicy>>[0];

  it("refuses to author the policy from an agent-runtime shell, even with a piped 'yes'", async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const written: string[] = [];
    output.on("data", (chunk: Buffer) => written.push(chunk.toString("utf8")));

    const confirm = createRealConfirmPolicy({
      input,
      output,
      resolveTerminal: () => ({ allowed: false, reason: "CLAUDECODE is set in its environment" }),
    });
    input.write("yes\n");
    await expect(confirm(derived)).resolves.toBe(false);

    const screen = written.join("");
    expect(screen).toContain("Skipping the standing authorization policy");
    expect(screen).toContain("CLAUDECODE");
    // It must NOT have rendered the grant as though it were being authored.
    expect(screen).not.toContain("writable paths");
  });

  it("authors the policy for a human terminal, rendering every dimension including the empty ones", async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const written: string[] = [];
    output.on("data", (chunk: Buffer) => written.push(chunk.toString("utf8")));

    const confirm = createRealConfirmPolicy({
      input,
      output,
      resolveTerminal: () => ({ allowed: true }),
    });
    const pending = confirm(derived);
    input.write("yes\n");
    await expect(pending).resolves.toBe(true);

    const screen = written.join("");
    expect(screen).toContain("writable paths");
    expect(screen).toContain("src");
    expect(screen).toContain("(none)");
    expect(screen).toContain("unix sockets: denied");
    // Review 2026-07-30: the turn budget is an authority dimension, and this
    // render is the standing policy's authoring moment — an owner must never
    // confirm a grant containing a dimension they were not shown.
    expect(screen).toContain("worker turns per attempt: up to");
  });

  it("declines on anything but 'yes' at a human terminal", async () => {
    const input = new PassThrough();
    const confirm = createRealConfirmPolicy({
      input,
      output: new PassThrough(),
      resolveTerminal: () => ({ allowed: true }),
    });
    const pending = confirm(derived);
    input.write("no\n");
    await expect(pending).resolves.toBe(false);
  });

  // Same class as the approval prompt's EOF hang: `install` used to wait
  // forever on a stream that had already said everything it would.
  it("declines instead of hanging when stdin has already ended", async () => {
    const input = new PassThrough();
    input.end();
    for await (const _chunk of input) {
      void _chunk;
    }
    const confirm = createRealConfirmPolicy({
      input,
      output: new PassThrough(),
      resolveTerminal: () => ({ allowed: true }),
    });
    await expect(confirm(derived)).resolves.toBe(false);
  });
});
