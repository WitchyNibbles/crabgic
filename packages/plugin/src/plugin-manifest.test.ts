import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resolvePluginRoot } from "./plugin-root.js";
import {
  validatePluginManifest,
  REQUIRED_SKILL_NAMES,
  REQUIRED_SUBAGENT_NAMES,
} from "./plugin-manifest.js";

const dirs: string[] = [];
function makeTmpDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "eo-plugin-manifest-"));
  dirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** Writes `skills/<name>/SKILL.md` — real Claude Code plugin convention (verified live against `claude plugin details --plugin-dir`, 2.1.218): a bare `skills/<name>.md` is silently invisible to the engine's own component inventory. */
function writeSkill(dir: string, name: string, frontmatterExtra = ""): void {
  mkdirSync(join(dir, "skills", name), { recursive: true });
  writeFileSync(
    join(dir, "skills", name, "SKILL.md"),
    `---\nname: ${name}\ndescription: d\n${frontmatterExtra}---\nbody\n`,
  );
}

function writeSubagent(dir: string, name: string, toolsJson = '["Read"]', model = "haiku"): void {
  mkdirSync(join(dir, "agents"), { recursive: true });
  writeFileSync(
    join(dir, "agents", `${name}.md`),
    `---\nname: ${name}\ndescription: d\ntools: ${toolsJson}\nmodel: ${model}\n---\nbody\n`,
  );
}

describe("validatePluginManifest — this package's own real artifacts", () => {
  it("passes against this package's own on-disk skills/agents", () => {
    const result = validatePluginManifest(resolvePluginRoot());
    if (!result.ok) {
      // Surface every problem for a legible failure message.
      throw new Error(
        JSON.stringify(
          result.findings.filter((f) => !f.ok),
          null,
          2,
        ),
      );
    }
    expect(result.ok).toBe(true);
    expect(result.findings).toHaveLength(
      REQUIRED_SKILL_NAMES.length + REQUIRED_SUBAGENT_NAMES.length,
    );
  });

  it("the approve skill sets disable-model-invocation: true (adaptation §5.5)", () => {
    const result = validatePluginManifest(resolvePluginRoot());
    const approve = result.findings.find((f) => f.kind === "skill" && f.name === "approve");
    expect(approve?.ok).toBe(true);
  });
});

describe("validatePluginManifest — rejects an incomplete manifest (work item 1's first failing test)", () => {
  it("rejects a manifest directory missing a required skill entry", () => {
    const dir = makeTmpDir();
    // Only 4 of 5 required skills present.
    for (const name of REQUIRED_SKILL_NAMES.filter((n) => n !== "connections")) {
      writeSkill(dir, name);
    }
    for (const name of REQUIRED_SUBAGENT_NAMES) writeSubagent(dir, name);

    const result = validatePluginManifest(dir);
    expect(result.ok).toBe(false);
    const connections = result.findings.find((f) => f.kind === "skill" && f.name === "connections");
    expect(connections?.ok).toBe(false);
    expect(connections?.problems.some((p) => p.includes("missing file"))).toBe(true);
  });

  it("rejects a manifest directory missing a required subagent entry", () => {
    const dir = makeTmpDir();
    for (const name of REQUIRED_SKILL_NAMES) writeSkill(dir, name);
    // Only eo-explore present, eo-reviewer missing.
    writeSubagent(dir, "eo-explore");

    const result = validatePluginManifest(dir);
    expect(result.ok).toBe(false);
    const reviewer = result.findings.find((f) => f.kind === "subagent" && f.name === "eo-reviewer");
    expect(reviewer?.ok).toBe(false);
  });

  it("rejects an approve skill that omits disable-model-invocation: true", () => {
    const dir = makeTmpDir();
    for (const name of REQUIRED_SKILL_NAMES) writeSkill(dir, name);
    for (const name of REQUIRED_SUBAGENT_NAMES) writeSubagent(dir, name);

    const result = validatePluginManifest(dir);
    const approve = result.findings.find((f) => f.kind === "skill" && f.name === "approve");
    expect(approve?.ok).toBe(false);
    expect(approve?.problems.some((p) => p.includes("disable-model-invocation"))).toBe(true);
  });

  it("rejects a subagent that declares Write (must be read-heavy only)", () => {
    const dir = makeTmpDir();
    for (const name of REQUIRED_SKILL_NAMES) writeSkill(dir, name);
    writeSubagent(dir, "eo-explore", '["Read", "Write"]');
    writeSubagent(dir, "eo-reviewer", '["Read"]', "sonnet");

    const result = validatePluginManifest(dir);
    const explore = result.findings.find((f) => f.kind === "subagent" && f.name === "eo-explore");
    expect(explore?.ok).toBe(false);
    expect(explore?.problems.some((p) => p.includes('"Write"'))).toBe(true);
  });

  it("rejects a subagent that declares Bash (adversarial-review finding, 2026-07-24: Bash is not read-only-constrainable and must be treated as write-capable)", () => {
    const dir = makeTmpDir();
    for (const name of REQUIRED_SKILL_NAMES) writeSkill(dir, name);
    writeSubagent(dir, "eo-explore");
    writeSubagent(dir, "eo-reviewer", '["Read", "Grep", "Glob", "Bash"]', "sonnet");

    const result = validatePluginManifest(dir);
    const reviewer = result.findings.find((f) => f.kind === "subagent" && f.name === "eo-reviewer");
    expect(reviewer?.ok).toBe(false);
    expect(reviewer?.problems.some((p) => p.includes('"Bash"'))).toBe(true);
  });

  it("rejects a subagent that declares NotebookEdit", () => {
    const dir = makeTmpDir();
    for (const name of REQUIRED_SKILL_NAMES) writeSkill(dir, name);
    writeSubagent(dir, "eo-explore", '["Read", "NotebookEdit"]');
    writeSubagent(dir, "eo-reviewer");

    const result = validatePluginManifest(dir);
    const explore = result.findings.find((f) => f.kind === "subagent" && f.name === "eo-explore");
    expect(explore?.ok).toBe(false);
    expect(explore?.problems.some((p) => p.includes('"NotebookEdit"'))).toBe(true);
  });

  it("this package's own real eo-reviewer.md no longer declares Bash (regression guard)", () => {
    const result = validatePluginManifest(resolvePluginRoot());
    const reviewer = result.findings.find((f) => f.kind === "subagent" && f.name === "eo-reviewer");
    expect(reviewer?.ok).toBe(true);
  });

  it("rejects a subagent with a missing/empty tools array", () => {
    const dir = makeTmpDir();
    for (const name of REQUIRED_SKILL_NAMES) writeSkill(dir, name);
    writeSubagent(dir, "eo-explore", "[]");
    writeSubagent(dir, "eo-reviewer");

    const result = validatePluginManifest(dir);
    const explore = result.findings.find((f) => f.kind === "subagent" && f.name === "eo-explore");
    expect(explore?.ok).toBe(false);
    expect(explore?.problems.some((p) => p.includes('"tools"'))).toBe(true);
  });

  it("rejects a subagent with a missing model", () => {
    const dir = makeTmpDir();
    for (const name of REQUIRED_SKILL_NAMES) writeSkill(dir, name);
    mkdirSync(join(dir, "agents"), { recursive: true });
    writeFileSync(
      join(dir, "agents", "eo-explore.md"),
      '---\nname: eo-explore\ndescription: d\ntools: ["Read"]\n---\nbody\n',
    );
    writeSubagent(dir, "eo-reviewer");

    const result = validatePluginManifest(dir);
    const explore = result.findings.find((f) => f.kind === "subagent" && f.name === "eo-explore");
    expect(explore?.ok).toBe(false);
    expect(explore?.problems.some((p) => p.includes('"model"'))).toBe(true);
  });

  it("reports a frontmatter parse failure as a problem, not a thrown exception", () => {
    const dir = makeTmpDir();
    for (const name of REQUIRED_SKILL_NAMES.filter((n) => n !== "run")) writeSkill(dir, name);
    // No "---" delimiter at all — parseFrontmatter throws internally;
    // safeParseFrontmatter must catch it and report a problem instead.
    mkdirSync(join(dir, "skills", "run"), { recursive: true });
    writeFileSync(join(dir, "skills", "run", "SKILL.md"), "not even frontmatter-shaped content");
    for (const name of REQUIRED_SUBAGENT_NAMES) writeSubagent(dir, name);

    const result = validatePluginManifest(dir);
    const run = result.findings.find((f) => f.kind === "skill" && f.name === "run");
    expect(run?.ok).toBe(false);
    expect(run?.problems.length).toBeGreaterThan(0);
  });
});
