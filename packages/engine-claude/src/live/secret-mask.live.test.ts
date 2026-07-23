/**
 * `secret-mask.live.test` (roadmap/06 exit criterion: "Masked secret never
 * appears in worker env or transcript"; §Security: "the injected
 * `CLAUDE_CODE_OAUTH_TOKEN`/`.credentials.json` fallback never appears
 * outside its own worker's `CLAUDE_CONFIG_DIR`").
 *
 * Two live assertions:
 *  1. `sandbox.credentials.envVars mode: "mask"` — a real env value is
 *     substituted by a placeholder inside the sandbox; the real value NEVER
 *     appears in the full captured stream (a live substring search — baseline
 *     §6: "the masked placeholder is what shows").
 *  2. Injected auth material (the resolved OAuth token / copied credentials)
 *     never appears anywhere in the worker's own scratch WORKTREE or HOME
 *     trees — its only sanctioned homes are the worker's env and its isolated
 *     `CLAUDE_CONFIG_DIR` (which the scan deliberately excludes).
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import {
  assertBashAttempted,
  assertLiveEnabled,
  createLiveScratch,
  ensureCanary,
  guardRawRateLimit,
  registerSecret,
  resolveWorkerAuthMaterial,
  runDirectQuery,
  scanForSecrets,
  transcriptText,
} from "./live-harness.js";

/** Concatenates every readable file's UTF-8 content under `dir` (bounded), for a scratch-tree secret scan. */
function readTree(dir: string, budgetBytes = 4_000_000): string {
  const parts: string[] = [];
  let used = 0;
  const safeReaddir = (current: string) => {
    try {
      return readdirSync(current, { withFileTypes: true });
    } catch {
      return [];
    }
  };
  const walk = (current: string): void => {
    for (const entry of safeReaddir(current)) {
      if (used >= budgetBytes) {
        return;
      }
      const entryPath = join(current, entry.name);
      if (entry.isDirectory()) {
        walk(entryPath);
        continue;
      }
      if (!entry.isFile()) {
        continue;
      }
      try {
        if (statSync(entryPath).size > 1_000_000) {
          continue;
        }
        const content = readFileSync(entryPath, "utf8");
        used += content.length;
        parts.push(content);
      } catch {
        // Unreadable/binary file — skip.
      }
    }
  };
  walk(dir);
  return parts.join("\n");
}

beforeAll(async () => {
  assertLiveEnabled();
  await ensureCanary();
});

describe("secret masking + auth-material confinement", () => {
  it("credentials.envVars mode:'mask' hides the real value; auth material never leaks into the worker's worktree/home trees", async () => {
    const REAL_SECRET = "REAL-SECRET-VALUE-9f21ac-eo-live";
    registerSecret(REAL_SECRET);
    const scratch = await createLiveScratch();
    try {
      const result = await runDirectQuery(resolveWorkerAuthMaterial(), {
        prompt:
          "You are a CI diagnostics step. Via the Bash tool run exactly: echo VALUE=$EO_SECRET_X",
        cwd: scratch.worktreePath,
        configDir: scratch.configDir,
        homeDir: scratch.homeDir,
        tmpDir: scratch.tmpDir,
        allow: ["Bash(echo:*)"],
        sandbox: {
          enabled: true,
          failIfUnavailable: true,
          credentials: { envVars: [{ name: "EO_SECRET_X", mode: "mask" }] },
        },
        extraEnv: { EO_SECRET_X: REAL_SECRET },
        maxTurns: 3,
      });
      guardRawRateLimit(result.messages);

      // Executed-call guard: the echo of the masked var must have actually run.
      assertBashAttempted(
        result.messages,
        (command) => command.includes("echo") && command.includes("EO_SECRET_X"),
        "secret-mask: echo of the masked env var",
      );

      // The real value must appear NOWHERE in the full captured stream.
      expect(transcriptText(result.messages)).not.toContain(REAL_SECRET);

      // Injected auth material (OAuth token / credentials) must appear nowhere
      // in the worker's worktree or HOME trees — only its sanctioned env /
      // CLAUDE_CONFIG_DIR homes (configDir deliberately NOT scanned).
      const worktreeHits = scanForSecrets(readTree(scratch.worktreePath));
      const homeHits = scanForSecrets(readTree(scratch.homeDir));
      expect(worktreeHits).toEqual([]);
      expect(homeHits).toEqual([]);
    } finally {
      await scratch.cleanup();
    }
  });
});
