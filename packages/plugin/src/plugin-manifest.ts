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
  // roadmap/25 WI 7, added 2026-08-15. The callable surface that DRIVES the
  // pipeline: ask `pipeline.plan` what runs next, dispatch it through the
  // `crabgic-stage-round` workflow, submit the verdicts, repeat. Every other
  // piece of phase 25 decides something; this is the one that acts, and
  // without it every lens the plan named was a review nobody performed.
  "pipeline",
  // Added 2026-07-27 alongside the manager operating protocol (roadmap/10
  // amendment). Carries the long-form rationale the always-loaded `CLAUDE.md`
  // block is deliberately too small to hold; both render from
  // `./manager-protocol.ts`. Model-invocable on purpose — it changes no state,
  // and the manager needs to be able to reach it mid-run when it is unsure
  // whether a situation is a real stop condition.
  "protocol",
] as const;

/**
 * Every manager-side subagent the installer copies into a consuming repo.
 *
 * This list and `agents/` must agree, and a test asserts they do. They did not,
 * once: `eo-architect` and `eo-planner` were added as files on 2026-07-29 and
 * not added here, so a real `crabgic install` copied three of five and the other
 * two were unreachable from any consuming repo. Nothing caught it — the content
 * digest enumerates the DIRECTORY, this list is enumerated by the manifest
 * validator and the installer, and the two disagreed in silence.
 *
 * The first three are roadmap/10 §Interfaces' own names, verbatim. The next two
 * are the staged review pipeline's producers (`docs/staged-review-pipeline.md`
 * §4.4): a design stage and a plan stage need an agent that makes the artifact,
 * not only agents that review it.
 *
 * The last three are roadmap/25's producers, added 2026-08-15 — and they are the
 * reason the paragraph above is worth re-reading rather than skimming. Three
 * stages of the owner's pipeline (design panel, audit, document) plus the
 * research stage had criteria, a plan and no agent that could produce anything,
 * and `pipeline.plan` would have returned lens names nobody could run. Adding
 * the files without adding them here would have reproduced the 2026-07-29 defect
 * exactly: copied by nothing, unreachable from any consuming repo, silent.
 */
export const REQUIRED_SUBAGENT_NAMES = [
  "eo-explore",
  "eo-reviewer",
  "eo-roaster",
  "eo-architect",
  "eo-planner",
  "eo-domain-reviewer",
  "eo-researcher",
  "eo-documenter",
] as const;

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
  const { attributes, raw } = safeParseFrontmatter(content, problems);
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
  // `maxTurns` is OPTIONAL — omitting it is a (costly) default, not a
  // malformed manifest — but declaring it WRONGLY is worse than omitting it,
  // because it looks like a bound and is not one. Measured against the pinned
  // 2.1.218 engine binary (`docs/engine-baseline.md` §21): a value the loader
  // cannot read is warned about ("Plugin agent file … has invalid maxTurns
  // '…'. Must be a positive integer.") and then DROPPED, silently restoring
  // the built-in 200-turn default. A subagent's turns never reach the parent's
  // `num_turns`, so nothing downstream would notice.
  //
  // READ FROM `raw`, NOT FROM `attributes` — and that is the whole point of
  // this rule's second revision (review finding, 2026-08-06). `parseScalar`
  // strips one layer of DOUBLE quotes, so an `attributes`-based check saw
  // `maxTurns: "30"` as a bare `30` and passed it, while `maxTurns: '30'` was
  // rejected because single quotes survive that stripper. One value, two
  // spellings, two verdicts, decided by our own parser rather than by the
  // engine.
  //
  // ONLY THE BARE INTEGER LITERAL IS ACCEPTED, and the reason is a limit of
  // the evidence rather than a claim about quotes. §21 records `$to()`
  // coercing via `String(e)` before its integer test, which POINTS toward a
  // quoted value being coerced and installed — but the coercion helper it
  // calls shares a mangled name with a second, unrelated function in the same
  // bundle, and the loader's warning could not be surfaced through any free
  // local command to decide between them (`plugin details`, with and without
  // `-d`, prints nothing even for a deliberately invalid value). So the bare
  // literal is the one form whose installation is settled, and it is the one
  // form this manifest allows. If a later probe settles the quoted case, this
  // rule may be relaxed — not before.
  const maxTurns = raw.maxTurns;
  if (maxTurns !== undefined && !/^[1-9][0-9]*$/.test(maxTurns)) {
    problems.push(
      `frontmatter "maxTurns" (${JSON.stringify(maxTurns)}) must be a BARE positive integer literal, unquoted — a value the engine's loader cannot read is warned about and dropped, silently restoring its built-in 200-turn default, and quoted forms are undetermined at the pinned engine version (docs/engine-baseline.md §21)`,
    );
  }
  return { kind: "subagent", name, ok: problems.length === 0, problems };
}

function safeParseFrontmatter(
  content: string,
  problems: string[],
): { attributes: Readonly<Record<string, unknown>>; raw: Readonly<Record<string, string>> } {
  try {
    return parseFrontmatter(content);
  } catch (err) {
    problems.push(err instanceof Error ? err.message : String(err));
    return { attributes: {}, raw: {} };
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
