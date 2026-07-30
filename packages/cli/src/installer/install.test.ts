import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { EnvelopePolicySchema, GATEWAY_MCP_SERVER_NAME } from "@crabgic/contracts";
import { ENABLED_PLUGIN_KEY, REQUIRED_SUBAGENT_NAMES } from "@crabgic/plugin";
import { runInstall } from "./install.js";
import { readInstallState } from "./state-store.js";
import { STATUSLINE_SETTINGS_ENTRY } from "./statusline-writer.js";
import type { InstallerDependencies } from "./types.js";

const dirs: string[] = [];
async function makeTmpDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "eo-install-"));
  dirs.push(dir);
  return dir;
}
afterEach(async () => {
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

const PLUGIN_ROOT = new URL("../../../plugin", import.meta.url).pathname;

function deps(
  targetDir: string,
  overrides: Partial<InstallerDependencies> = {},
): InstallerDependencies {
  return {
    targetDir,
    pluginSourceDir: PLUGIN_ROOT,
    confirmGitInit: async () => true,
    now: () => "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("runInstall — basic writes", () => {
  it("writes CLAUDE.md, .claude/settings.json, .mcp.json, and both eo-*.md agents into an empty directory", async () => {
    const dir = await makeTmpDir();
    const result = await runInstall(deps(dir), { dryRun: false });
    expect(result.status).toBe("installed");
    expect(existsSync(join(dir, "CLAUDE.md"))).toBe(true);
    expect(existsSync(join(dir, ".claude", "settings.json"))).toBe(true);
    expect(existsSync(join(dir, ".mcp.json"))).toBe(true);
    expect(existsSync(join(dir, ".claude", "agents", "eo-explore.md"))).toBe(true);
    expect(existsSync(join(dir, ".claude", "agents", "eo-reviewer.md"))).toBe(true);
    expect(existsSync(join(dir, ".claude", "crabgic-statusline.mjs"))).toBe(true);
  });

  it("registers the installed status-line script in settings.json, at the path it actually wrote it to", async () => {
    const dir = await makeTmpDir();
    await runInstall(deps(dir), { dryRun: false });
    const settings = JSON.parse(await readFile(join(dir, ".claude", "settings.json"), "utf8"));
    expect(settings.statusLine).toEqual({ ...STATUSLINE_SETTINGS_ENTRY });
    // The registered command must resolve to the file the installer wrote —
    // a status line pointing at a missing script renders nothing at all.
    const scriptPath = join(dir, ".claude", "crabgic-statusline.mjs");
    expect(existsSync(scriptPath)).toBe(true);
    expect(settings.statusLine.command).toContain(".claude/crabgic-statusline.mjs");
  });

  it("renders a real status line end-to-end from the copy it installed", async () => {
    const dir = await makeTmpDir();
    await runInstall(deps(dir), { dryRun: false });
    const { renderStatusLine } = await import(
      pathToFileURL(join(dir, ".claude", "crabgic-statusline.mjs")).href
    );
    const line = renderStatusLine(
      {
        model: { display_name: "Claude Opus 5 (1M context)" },
        context_window: { used_percentage: 38 },
        effort: { level: "high" },
        rate_limits: {
          five_hour: { used_percentage: 24 },
          seven_day: { used_percentage: 41 },
        },
      },
      { color: false, git: { branch: "main", dirty: false }, nowMs: 0 },
    );
    expect(line).toBe("🦀 Opus 5 1M·hi │ ⎇ main │ ▰▰▰▰▱▱▱▱▱▱ 38% │ 🕐 24% │ 📅 41%");
  });

  it("writes a .mcp.json whose entry is keyed GATEWAY_MCP_SERVER_NAME with the exact gateway command", async () => {
    const dir = await makeTmpDir();
    await runInstall(deps(dir), { dryRun: false });
    const mcpJson = JSON.parse(await readFile(join(dir, ".mcp.json"), "utf8"));
    expect(mcpJson.mcpServers[GATEWAY_MCP_SERVER_NAME]).toEqual({
      command: "crabgic",
      args: ["gateway", "mcp"],
    });
  });

  it("uses the @AGENTS.md bridge form when the target repo already has an AGENTS.md", async () => {
    const dir = await makeTmpDir();
    await writeFile(join(dir, "AGENTS.md"), "# Agents instructions\n", "utf8");
    await runInstall(deps(dir), { dryRun: false });
    const claudeMd = await readFile(join(dir, "CLAUDE.md"), "utf8");
    expect(claudeMd).toContain("@AGENTS.md");
  });

  it("records install state with a sourceDigest", async () => {
    const dir = await makeTmpDir();
    await runInstall(deps(dir), { dryRun: false });
    const state = await readInstallState(dir);
    expect(state?.sourceDigest).toMatch(/^[a-f0-9]{64}$/);
    // CLAUDE.md, .claude/settings.json, .mcp.json, FIVE eo-* subagents, and the
    // status-line script. The standing policy is deliberately NOT among them:
    // it lands in XDG state, never the repo.
    //
    // Three subagents became five on 2026-07-29 when the staged review pipeline
    // gained producers for its design and plan stages (eo-architect, eo-planner).
    // The count is derived rather than restated so this assertion cannot drift
    // from the list the installer actually copies -- a hand-typed 7 is what let
    // two agents ship uninstallable in the first place.
    expect(state?.artifacts).toHaveLength(REQUIRED_SUBAGENT_NAMES.length + 4);
  });

  it("writes enabledPlugins keyed by the LIVE-VERIFIED <plugin-name>@<marketplace-name> format, not the bare plugin name", async () => {
    const dir = await makeTmpDir();
    await runInstall(deps(dir), { dryRun: false });
    const settings = JSON.parse(await readFile(join(dir, ".claude", "settings.json"), "utf8"));
    expect(settings.enabledPlugins).toEqual({ [ENABLED_PLUGIN_KEY]: true });
    expect(ENABLED_PLUGIN_KEY).toBe("crabgic@crabgic-marketplace");
  });
});

describe("runInstall — idempotency (running install twice diffs clean)", () => {
  it("reports action: unchanged for every artifact on a second run", async () => {
    const dir = await makeTmpDir();
    await runInstall(deps(dir), { dryRun: false });
    const second = await runInstall(deps(dir), { dryRun: false });
    expect(second.status).toBe("already-installed");
    expect(second.diff.every((d) => d.action === "unchanged")).toBe(true);
  });
});

describe("runInstall — --dry-run never writes", () => {
  it("reports the diff without creating any file", async () => {
    const dir = await makeTmpDir();
    const result = await runInstall(deps(dir), { dryRun: true });
    expect(result.status).toBe("dry-run");
    expect(existsSync(join(dir, "CLAUDE.md"))).toBe(false);
    expect(result.diff.some((d) => d.relPath === "CLAUDE.md" && d.action === "create")).toBe(true);
  });
});

describe("runInstall — add-only merge preserves pre-existing user content", () => {
  it("preserves a pre-existing CLAUDE.md's own content, appending rather than replacing", async () => {
    const dir = await makeTmpDir();
    await writeFile(join(dir, "CLAUDE.md"), "# My own project notes\n", "utf8");
    await runInstall(deps(dir), { dryRun: false });
    const claudeMd = await readFile(join(dir, "CLAUDE.md"), "utf8");
    expect(claudeMd).toContain("My own project notes");
  });

  it("preserves a pre-existing settings.json's own unrelated keys", async () => {
    const dir = await makeTmpDir();
    await mkdir(join(dir, ".claude"), { recursive: true });
    await writeFile(join(dir, ".claude", "settings.json"), '{"myOwnKey":42}\n', "utf8");
    await runInstall(deps(dir), { dryRun: false });
    const settings = JSON.parse(await readFile(join(dir, ".claude", "settings.json"), "utf8"));
    expect(settings.myOwnKey).toBe(42);
    expect(settings.attribution).toEqual({ commit: "", pr: "" });
  });
});

/**
 * The standing-approval bootstrap (ledger Gap 18; roadmap/10's 2026-07-28
 * scope amendment). `install` is the ONLY authoring moment for the policy —
 * a per-run confirmation would be the per-ChangeSet prompt the ruling
 * replaced, wearing a different interface.
 */
describe("runInstall — the standing policy", () => {
  const POLICY = EnvelopePolicySchema.parse({
    schemaVersion: 1,
    id: "11111111-1111-4111-8111-111111111111",
    createdAt: "2026-01-01T00:00:00.000Z",
    allowedPathPrefixes: ["src"],
  });

  function policyBag(dir: string, overrides: Record<string, unknown> = {}) {
    return {
      path: join(dir, "policy.json"),
      loadExisting: () => ({ status: "absent" as const }),
      derive: () => ({ policy: POLICY, vacuous: false }),
      confirm: () => Promise.resolve(true),
      write: () => Promise.resolve(),
      ...overrides,
    };
  }

  it("writes the policy once the owner confirms it", async () => {
    const dir = await makeTmpDir();
    const written: unknown[] = [];
    const result = await runInstall(
      {
        ...deps(dir),
        policy: policyBag(dir, {
          write: (_p: string, p: unknown) => {
            written.push(p);
            return Promise.resolve();
          },
        }),
      },
      { dryRun: false },
    );

    expect(result.policy).toEqual({ status: "written", policy: POLICY });
    expect(written).toEqual([POLICY]);
  });

  /** A human act by construction, exactly like confirmGitInit. Never defaulted to yes. */
  it("does not write when the owner declines, and still installs", async () => {
    const dir = await makeTmpDir();
    const written: unknown[] = [];
    const result = await runInstall(
      {
        ...deps(dir),
        policy: policyBag(dir, {
          confirm: () => Promise.resolve(false),
          write: (_p: string, p: unknown) => {
            written.push(p);
            return Promise.resolve();
          },
        }),
      },
      { dryRun: false },
    );

    expect(result.policy).toEqual({ status: "declined" });
    expect(written).toEqual([]);
    // A decline is not an install failure: the plugin works, dispatches refuse.
    expect(result.status).toBe("installed");
  });

  /**
   * Review 2026-07-30 (PR #16's round, F5): `bootstrapPolicy` had no
   * existing-file guard and `writeEnvelopePolicy` renames over the existing
   * path, so an owner re-running `install` — e.g. to acquire a newly added
   * policy field — silently wiped every hand-added grant (network,
   * credential and remote grants are never derived, so they exist ONLY by
   * hand). An existing policy is the owner's file: install must keep it.
   */
  it("KEEPS an existing valid policy untouched: no derive, no prompt, no write", async () => {
    const dir = await makeTmpDir();
    const touched: string[] = [];
    const result = await runInstall(
      {
        ...deps(dir),
        policy: policyBag(dir, {
          loadExisting: () => ({ status: "loaded" as const, policy: POLICY, digest: "sha256:x" }),
          derive: () => {
            touched.push("derive");
            return { policy: POLICY, vacuous: false };
          },
          confirm: () => {
            touched.push("confirm");
            return Promise.resolve(true);
          },
          write: () => {
            touched.push("write");
            return Promise.resolve();
          },
        }),
      },
      { dryRun: false },
    );

    expect(result.policy).toEqual({ status: "kept-existing" });
    expect(touched).toEqual([]);
    expect(result.status).toBe("installed");
  });

  it("refuses to overwrite an INVALID existing policy, surfacing its own reason", async () => {
    const dir = await makeTmpDir();
    const written: unknown[] = [];
    const result = await runInstall(
      {
        ...deps(dir),
        policy: policyBag(dir, {
          loadExisting: () => ({
            status: "invalid" as const,
            reason: "policy file X is not valid JSON",
          }),
          write: (_p: string, p: unknown) => {
            written.push(p);
            return Promise.resolve();
          },
        }),
      },
      { dryRun: false },
    );

    expect(result.policy).toEqual({
      status: "existing-invalid",
      reason: "policy file X is not valid JSON",
    });
    expect(written).toEqual([]);
  });

  it("reports kept-existing on a dry run too, before any confirmation machinery", async () => {
    const dir = await makeTmpDir();
    const result = await runInstall(
      {
        ...deps(dir),
        policy: policyBag(dir, {
          loadExisting: () => ({ status: "loaded" as const, policy: POLICY, digest: "sha256:x" }),
        }),
      },
      { dryRun: true },
    );
    expect(result.policy).toEqual({ status: "kept-existing" });
  });

  /**
   * Roast round 1, F9. An all-empty policy passes every structural check a
   * doctor can make while refusing every dispatch, so writing one silently
   * produces a green install, a green doctor, and a product that never runs.
   */
  it("refuses to write a vacuous policy, and never even asks", async () => {
    const dir = await makeTmpDir();
    const asked: unknown[] = [];
    const result = await runInstall(
      {
        ...deps(dir),
        policy: policyBag(dir, {
          derive: () => ({ policy: POLICY, vacuous: true }),
          confirm: (p: unknown) => {
            asked.push(p);
            return Promise.resolve(true);
          },
        }),
      },
      { dryRun: false },
    );

    expect(result.policy).toEqual({ status: "vacuous" });
    expect(asked).toEqual([]);
  });

  it("a dry run derives and reports without writing or asking", async () => {
    const dir = await makeTmpDir();
    const touched: string[] = [];
    const result = await runInstall(
      {
        ...deps(dir),
        policy: policyBag(dir, {
          confirm: () => {
            touched.push("confirm");
            return Promise.resolve(true);
          },
          write: () => {
            touched.push("write");
            return Promise.resolve();
          },
        }),
      },
      { dryRun: true },
    );

    expect(result.policy).toEqual({ status: "dry-run", policy: POLICY });
    expect(touched).toEqual([]);
  });

  /** Every pre-existing caller supplies no bag and must keep observing the same shape. */
  it("reports not-configured when no policy bag is supplied", async () => {
    const dir = await makeTmpDir();
    const result = await runInstall(deps(dir), { dryRun: false });
    expect(result.policy).toEqual({ status: "not-configured" });
  });
});
