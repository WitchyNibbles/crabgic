import { describe, expect, it } from "vitest";
import {
  createGitPlumbing,
  createNodeGitSpawn,
  GitCommandError,
  type GitSpawnRequest,
  type GitSpawnResult,
} from "./plumbing.js";

/**
 * WI1 — roadmap/07-git-control-repo-worktrees.md work item 1: "Failing-
 * test-first: a path/branch fixture containing shell metacharacters (`;`,
 * `&&`, `$(...)`, backticks) must reach `git` as one literal argv element,
 * never a shell." A capturing fake `GitSpawnFn` (the "spawn-capture shim"
 * the roadmap's Deliverables section names) records every request the
 * plumbing wrapper issues; the assertions below inspect that captured
 * request directly rather than trusting any string it was built from.
 */

function capturingSpawn(result: GitSpawnResult = { stdout: "", stderr: "", exitCode: 0 }) {
  const calls: GitSpawnRequest[] = [];
  const spawnFn = async (request: GitSpawnRequest): Promise<GitSpawnResult> => {
    calls.push(request);
    return result;
  };
  return { spawnFn, calls };
}

const INJECTION_CORPUS: readonly { readonly label: string; readonly value: string }[] = [
  { label: "semicolon", value: "main; rm -rf /" },
  { label: "double-ampersand", value: "main && echo pwned" },
  { label: "double-pipe", value: "main || echo pwned" },
  { label: "single-pipe", value: "main | cat /etc/passwd" },
  { label: "command-substitution", value: "$(echo pwned)" },
  { label: "backticks", value: "`echo pwned`" },
  { label: "embedded-newline", value: "main\nrm -rf /" },
  { label: "path-traversal", value: "../../../../etc/passwd" },
  { label: "quote-breakout", value: 'main" ; echo pwned; "' },
  // Option-smuggling fixtures (2026-07-18 validation round, CRITICAL 1):
  // argv-array + shell:false already defeats shell metacharacters (above),
  // but a leading-dash POSITIONAL is a DIFFERENT attack: `git` itself
  // parses it as a FLAG, not a shell parsing it as a command. This corpus
  // previously had NO such fixture — the plumbing wrapper's own job here is
  // just to prove the value still reaches git as one untouched literal argv
  // element (call-site option-terminator/boundary-validation defenses live
  // in `./git-arg-guard.ts` and are exercised in
  // `./argument-injection.regression.test.ts`).
  { label: "leading-dash-upload-pack", value: "--upload-pack=touch /tmp/eo-should-never-run" },
  { label: "leading-dash-output", value: "--output=/tmp/eo-should-never-be-overwritten" },
  { label: "leading-dash-short-flag", value: "-Bmain" },
];

describe("createGitPlumbing — argv-injection resistance (WI1)", () => {
  for (const fixture of INJECTION_CORPUS) {
    it(`reaches git as one literal argv element: ${fixture.label}`, async () => {
      const { spawnFn, calls } = capturingSpawn();
      const plumbing = createGitPlumbing({ spawnFn });

      await plumbing.run(["checkout", fixture.value]);

      expect(calls).toHaveLength(1);
      const request = calls[0]!;
      // The security property under test: git is invoked directly (never a
      // shell), and the metacharacter-laden value survives as ONE literal
      // argv element — never concatenated into a larger string.
      expect(request.command).toBe("git");
      expect(request.args).toEqual(["checkout", fixture.value]);
      expect(request.args).toContain(fixture.value);
      expect(request.args.some((a) => a.includes(" ") && a !== fixture.value)).toBe(false);
    });
  }

  it("never routes through a shell binary (sh/bash/cmd) as the spawned command", async () => {
    const { spawnFn, calls } = capturingSpawn();
    const plumbing = createGitPlumbing({ spawnFn });

    await plumbing.run(["status", "--porcelain=v2"]);

    const request = calls[0]!;
    expect(["sh", "bash", "cmd", "cmd.exe", "powershell"]).not.toContain(request.command);
  });

  it("passes cwd and env through to the spawn request untouched", async () => {
    const { spawnFn, calls } = capturingSpawn();
    const plumbing = createGitPlumbing({ spawnFn });

    await plumbing.run(["status"], { cwd: "/tmp/some-repo", env: { GIT_TERMINAL_PROMPT: "0" } });

    expect(calls[0]!.cwd).toBe("/tmp/some-repo");
    expect(calls[0]!.env).toEqual({ GIT_TERMINAL_PROMPT: "0" });
  });

  it("throws GitCommandError on non-zero exit, carrying the exact argv", async () => {
    const { spawnFn } = capturingSpawn({ stdout: "", stderr: "fatal: bad ref", exitCode: 128 });
    const plumbing = createGitPlumbing({ spawnFn });

    await expect(plumbing.run(["rev-parse", "nonexistent-ref"])).rejects.toBeInstanceOf(
      GitCommandError,
    );
  });

  it("allowFailure suppresses the thrown error and returns the raw result", async () => {
    const { spawnFn } = capturingSpawn({ stdout: "", stderr: "fatal: bad ref", exitCode: 128 });
    const plumbing = createGitPlumbing({ spawnFn });

    const result = await plumbing.run(["rev-parse", "nonexistent-ref"], { allowFailure: true });
    expect(result.exitCode).toBe(128);
  });
});

describe("createNodeGitSpawn — real process, real git (WI1 version probe)", () => {
  it("spawns real git and returns its version string", async () => {
    const plumbing = createGitPlumbing({ spawnFn: createNodeGitSpawn() });
    const version = await plumbing.version();
    expect(version).toMatch(/^git version \d+\.\d+/);
  });

  it("a shell-metacharacter-laden ref reaches real git as a literal argv element (never shell-expanded)", async () => {
    const plumbing = createGitPlumbing({ spawnFn: createNodeGitSpawn() });
    // A nonexistent ref containing metacharacters must fail as an ORDINARY
    // "bad revision" from git itself — never as a shell syntax error, and
    // never by actually executing the injected `; touch` side effect.
    const marker = "/tmp/eo-plumbing-injection-should-never-exist";
    const maliciousRef = `nonexistent-ref; touch ${marker}`;
    const result = await plumbing.run(["rev-parse", maliciousRef], { allowFailure: true });
    expect(result.exitCode).not.toBe(0);
    const { existsSync } = await import("node:fs");
    expect(existsSync(marker)).toBe(false);
  });
});
