/**
 * Worker credential resolution — deliberately kept in its own module, free
 * of any runtime engine import.
 *
 * WHY THE SPLIT: this function lived in `run-dispatcher.ts`, which
 * statically imports `@eo/engine-claude` and through it
 * `@anthropic-ai/claude-agent-sdk`. The daemon calls this at STARTUP, so
 * merely resolving a token loaded the entire engine into a process that may
 * never dispatch a run — measured at +40.9 MiB, against roadmap/05's
 * <100 MiB idle budget and its stated intent that the daemon "costs nothing
 * when there is no work". `WorkerAuthMaterial` is imported as a type only;
 * `verbatimModuleSyntax` guarantees that import is erased at compile time,
 * so nothing here reaches the engine at runtime.
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { WorkerAuthMaterial } from "@eo/engine-claude";

/**
 * Resolves engine credentials in the exact order docs/engine-baseline.md §1
 * records, matching `doctor`'s own auth probe so the two can never disagree
 * about which credential a worker will use:
 *   1. `CLAUDE_CODE_OAUTH_TOKEN`
 *   2. `~/.claude/.eo-oauth-token`
 *   3. `~/.claude/.credentials.json`
 * Returns `undefined` when none is present, so the daemon can refuse to
 * dispatch rather than spawning workers that are certain to fail.
 */
export async function resolveWorkerAuthMaterial(
  homeDir: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<WorkerAuthMaterial | undefined> {
  const fromEnv = env.CLAUDE_CODE_OAUTH_TOKEN;
  if (fromEnv !== undefined && fromEnv.length > 0) {
    return { kind: "oauthToken", token: fromEnv };
  }

  try {
    const token = (await readFile(join(homeDir, ".claude", ".eo-oauth-token"), "utf8")).trim();
    if (token.length > 0) return { kind: "oauthToken", token };
  } catch {
    /* fall through to the credentials file */
  }

  const credentialsPath = join(homeDir, ".claude", ".credentials.json");
  try {
    await readFile(credentialsPath, "utf8");
    return { kind: "credentialsFile", sourcePath: credentialsPath };
  } catch {
    return undefined;
  }
}
