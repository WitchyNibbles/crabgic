/**
 * Plugin-manifest completeness check — roadmap/10-plugin-and-installer.md
 * work item 1's first failing test: "plugin-manifest schema validation
 * rejects a manifest missing a required skill or subagent entry." This
 * validates the on-disk `skills/*.md` / `agents/*.md` layout against the
 * fixed set of skills/subagents this phase's §Interfaces produced names —
 * NOT Claude Code's own `.claude-plugin/plugin.json` JSON Schema (that
 * schema is Anthropic-owned and out of scope to re-implement here).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseFrontmatter } from "./frontmatter.js";

/** The five skills roadmap/10 §Interfaces produced names verbatim, minus the leading `/eo:`. */
export const REQUIRED_SKILL_NAMES = [
  "run",
  "status",
  "approve",
  "evidence",
  "connections",
] as const;

/** The two manager-side subagents roadmap/10 §Interfaces produced names verbatim. */
export const REQUIRED_SUBAGENT_NAMES = ["eo-explore", "eo-reviewer"] as const;

/** Adaptation §5.5: "the model must not be able to satisfy its own approval gate" — `/eo:approve` MUST set this. */
const SKILLS_REQUIRING_DISABLED_MODEL_INVOCATION: ReadonlySet<string> = new Set(["approve"]);

/**
 * Every tool that can mutate the filesystem or run arbitrary commands —
 * roadmap/10 §In scope: these subagents are "read-heavy exploration/review
 * ... never write-capable workers." `Bash` belongs here alongside
 * `Write`/`Edit`/`NotebookEdit`: it is not itself read-only-constrainable at
 * the tool-declaration level (adversarial-review finding, 2026-07-24 —
 * `eo-reviewer.md` originally declared `Bash` "for read-only inspection",
 * which the manifest validator below did not catch because it only checked
 * `Write`/`Edit`).
 */
const WRITE_CAPABLE_TOOLS: ReadonlySet<string> = new Set(["Write", "Edit", "NotebookEdit", "Bash"]);

export interface ManifestFinding {
  readonly kind: "skill" | "subagent";
  readonly name: string;
  readonly ok: boolean;
  readonly problems: readonly string[];
}

export interface ManifestValidationResult {
  readonly ok: boolean;
  readonly findings: readonly ManifestFinding[];
}

function validateSkillFile(pluginRoot: string, name: string): ManifestFinding {
  const problems: string[] = [];
  // Real Claude Code plugin convention (verified against a live `claude
  // plugin details --plugin-dir` inventory, 2.1.218): a Skill is a
  // `skills/<name>/SKILL.md` subdirectory, NOT a bare `skills/<name>.md`
  // file — the latter is silently invisible to the engine's own component
  // inventory (0 skills detected) despite passing this package's earlier,
  // untested assumption.
  const path = join(pluginRoot, "skills", name, "SKILL.md");
  let content: string;
  try {
    content = readFileSync(path, "utf8");
  } catch {
    return { kind: "skill", name, ok: false, problems: [`missing file: skills/${name}/SKILL.md`] };
  }
  const { attributes } = safeParseFrontmatter(content, problems);
  if (attributes.name !== name) {
    problems.push(
      `frontmatter "name" (${JSON.stringify(attributes.name)}) does not match "${name}"`,
    );
  }
  if (typeof attributes.description !== "string" || attributes.description.length === 0) {
    problems.push('missing/empty frontmatter "description"');
  }
  if (
    SKILLS_REQUIRING_DISABLED_MODEL_INVOCATION.has(name) &&
    attributes["disable-model-invocation"] !== true
  ) {
    problems.push('this skill MUST set "disable-model-invocation: true" (adaptation §5.5)');
  }
  return { kind: "skill", name, ok: problems.length === 0, problems };
}

function validateSubagentFile(pluginRoot: string, name: string): ManifestFinding {
  const problems: string[] = [];
  const path = join(pluginRoot, "agents", `${name}.md`);
  let content: string;
  try {
    content = readFileSync(path, "utf8");
  } catch {
    return { kind: "subagent", name, ok: false, problems: [`missing file: agents/${name}.md`] };
  }
  const { attributes } = safeParseFrontmatter(content, problems);
  if (attributes.name !== name) {
    problems.push(
      `frontmatter "name" (${JSON.stringify(attributes.name)}) does not match "${name}"`,
    );
  }
  if (typeof attributes.description !== "string" || attributes.description.length === 0) {
    problems.push('missing/empty frontmatter "description"');
  }
  const tools = attributes.tools;
  if (!Array.isArray(tools) || tools.length === 0) {
    problems.push(
      'missing/empty frontmatter "tools" array (subagents must declare a narrow tool set)',
    );
  } else {
    const declaredWriteCapable = tools.filter((t): t is string => WRITE_CAPABLE_TOOLS.has(t));
    if (declaredWriteCapable.length > 0) {
      problems.push(
        `subagent must not declare any write-capable tool (${declaredWriteCapable.map((t) => `"${t}"`).join(", ")}) — manager subagents are read-heavy only, never write-capable (roadmap/10 §In scope, §Out of scope)`,
      );
    }
  }
  if (typeof attributes.model !== "string" || attributes.model.length === 0) {
    problems.push('missing frontmatter "model" (subagents must route to an explicit model)');
  }
  return { kind: "subagent", name, ok: problems.length === 0, problems };
}

function safeParseFrontmatter(
  content: string,
  problems: string[],
): { attributes: Readonly<Record<string, unknown>> } {
  try {
    return parseFrontmatter(content);
  } catch (err) {
    problems.push(err instanceof Error ? err.message : String(err));
    return { attributes: {} };
  }
}

/**
 * Validates that every required skill and subagent (per the constants above)
 * exists on disk under `pluginRoot` with a well-formed frontmatter. Never
 * throws — a missing/malformed entry is a non-`ok` finding, not an
 * exception, so a caller can report every problem in one pass rather than
 * stopping at the first.
 */
export function validatePluginManifest(pluginRoot: string): ManifestValidationResult {
  const findings: ManifestFinding[] = [
    ...REQUIRED_SKILL_NAMES.map((name) => validateSkillFile(pluginRoot, name)),
    ...REQUIRED_SUBAGENT_NAMES.map((name) => validateSubagentFile(pluginRoot, name)),
  ];
  return { ok: findings.every((f) => f.ok), findings };
}
