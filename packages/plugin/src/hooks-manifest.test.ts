import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { validateHooksManifest } from "./hooks-manifest.js";
import { resolvePluginRoot } from "./plugin-root.js";

const dirs: string[] = [];
function makeTmpDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "eo-hooks-manifest-"));
  dirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("validateHooksManifest — this package's own real hooks.json", () => {
  it("is advisory-only (PostToolUse/Stop only, never PreToolUse)", () => {
    const result = validateHooksManifest(resolvePluginRoot());
    expect(result.ok).toBe(true);
    expect(result.problems).toEqual([]);
  });
});

describe("validateHooksManifest — rejects a blocking (PreToolUse) hook", () => {
  it("flags a PreToolUse entry as not advisory-only", () => {
    const dir = makeTmpDir();
    const hooksDir = join(dir, "hooks");
    mkdirSync(hooksDir, { recursive: true });
    writeFileSync(
      join(hooksDir, "hooks.json"),
      JSON.stringify({
        hooks: {
          PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "false" }] }],
        },
      }),
    );
    const result = validateHooksManifest(dir);
    expect(result.ok).toBe(false);
    expect(result.problems.some((p) => p.includes("PreToolUse"))).toBe(true);
  });

  it("flags a malformed hooks.json (schema violation) rather than throwing", () => {
    const dir = makeTmpDir();
    const hooksDir = join(dir, "hooks");
    mkdirSync(hooksDir, { recursive: true });
    writeFileSync(
      join(hooksDir, "hooks.json"),
      JSON.stringify({ hooks: { PostToolUse: "not-an-array" } }),
    );
    const result = validateHooksManifest(dir);
    expect(result.ok).toBe(false);
  });

  it("flags a missing hooks.json rather than throwing", () => {
    const dir = makeTmpDir();
    const result = validateHooksManifest(dir);
    expect(result.ok).toBe(false);
  });
});

describe("the two real hook scripts never block (always exit 0)", () => {
  it("post-tool-use-format-warning.mjs exits 0 given no stdin at all", () => {
    const root = resolvePluginRoot();
    expect(() =>
      execFileSync("node", [join(root, "hooks", "post-tool-use-format-warning.mjs")], {
        input: "",
      }),
    ).not.toThrow();
  });

  it("post-tool-use-format-warning.mjs exits 0 given malformed JSON on stdin", () => {
    const root = resolvePluginRoot();
    expect(() =>
      execFileSync("node", [join(root, "hooks", "post-tool-use-format-warning.mjs")], {
        input: "not json",
      }),
    ).not.toThrow();
  });

  it("post-tool-use-format-warning.mjs warns to stderr for a file containing console.log(", () => {
    const dir = makeTmpDir();
    const filePath = join(dir, "sample.ts");
    writeFileSync(filePath, 'console.log("x");');
    const root = resolvePluginRoot();
    const result = spawnSync("node", [join(root, "hooks", "post-tool-use-format-warning.mjs")], {
      input: JSON.stringify({ tool_input: { file_path: filePath } }),
      encoding: "utf8",
    });
    expect(result.status).toBe(0);
    expect(result.stderr).toContain("console.log(");
  });

  it("stop-reminder.mjs exits 0 and writes an advisory reminder to stderr", () => {
    const root = resolvePluginRoot();
    const result = spawnSync("node", [join(root, "hooks", "stop-reminder.mjs")], {
      encoding: "utf8",
    });
    expect(result.status).toBe(0);
    expect(result.stderr.length).toBeGreaterThan(0);
  });
});
