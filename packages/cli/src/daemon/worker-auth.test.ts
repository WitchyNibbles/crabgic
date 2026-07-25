/**
 * Credential resolution, split out of `run-dispatcher.ts` so the daemon can
 * resolve worker auth at boot WITHOUT loading the engine.
 *
 * The split is what makes the idle budget reachable: `run-dispatcher.ts`
 * statically imports `@eo/engine-claude`, which pulls
 * `@anthropic-ai/claude-agent-sdk` — measured at +40.9 MiB. The daemon
 * called `resolveWorkerAuthMaterial` at startup, so merely *resolving a
 * token* dragged the whole engine into a process that may never dispatch a
 * run. This module imports `WorkerAuthMaterial` as a TYPE only
 * (`verbatimModuleSyntax: true` guarantees the import is erased), so it
 * costs nothing at runtime.
 *
 * These cases were untested before the split — `resolveWorkerAuthMaterial`
 * had no direct coverage anywhere.
 */
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveWorkerAuthMaterial } from "./worker-auth.js";

describe("resolveWorkerAuthMaterial", () => {
  let homeDir: string;

  beforeEach(async () => {
    homeDir = await mkdtemp(join(tmpdir(), "eo-auth-"));
    await mkdir(join(homeDir, ".claude"), { recursive: true });
  });

  afterEach(async () => {
    await rm(homeDir, { recursive: true, force: true });
  });

  it("prefers CLAUDE_CODE_OAUTH_TOKEN over anything on disk", async () => {
    await writeFile(join(homeDir, ".claude", ".eo-oauth-token"), "from-disk\n", "utf8");

    const auth = await resolveWorkerAuthMaterial(homeDir, {
      CLAUDE_CODE_OAUTH_TOKEN: "from-env",
    });

    expect(auth).toEqual({ kind: "oauthToken", token: "from-env" });
  });

  it("falls back to ~/.claude/.eo-oauth-token, trimming trailing whitespace", async () => {
    await writeFile(join(homeDir, ".claude", ".eo-oauth-token"), "  disk-token\n", "utf8");

    const auth = await resolveWorkerAuthMaterial(homeDir, {});

    expect(auth).toEqual({ kind: "oauthToken", token: "disk-token" });
  });

  it("ignores an empty CLAUDE_CODE_OAUTH_TOKEN rather than returning a blank token", async () => {
    await writeFile(join(homeDir, ".claude", ".eo-oauth-token"), "disk-token", "utf8");

    const auth = await resolveWorkerAuthMaterial(homeDir, { CLAUDE_CODE_OAUTH_TOKEN: "" });

    expect(auth).toEqual({ kind: "oauthToken", token: "disk-token" });
  });

  it("skips an empty token file and falls through to the credentials file", async () => {
    await writeFile(join(homeDir, ".claude", ".eo-oauth-token"), "   \n", "utf8");
    await writeFile(join(homeDir, ".claude", ".credentials.json"), "{}", "utf8");

    const auth = await resolveWorkerAuthMaterial(homeDir, {});

    expect(auth).toEqual({
      kind: "credentialsFile",
      sourcePath: join(homeDir, ".claude", ".credentials.json"),
    });
  });

  it("returns undefined when no credential exists, so the daemon can refuse to dispatch", async () => {
    const auth = await resolveWorkerAuthMaterial(homeDir, {});

    expect(auth).toBeUndefined();
  });
});
