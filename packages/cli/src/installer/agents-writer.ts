/**
 * `.claude/agents/eo-*.md` writer — roadmap/10-plugin-and-installer.md §In
 * scope: "`.claude/agents/eo-*.md`" ("project-owned, like the plan's
 * `.codex/agents/*.toml` note"). These are wholly-owned (`kind: "full"`)
 * copies of the plugin's own `agents/*.md` — never merged, since the
 * installer is their sole author in the target project.
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { REQUIRED_SUBAGENT_NAMES } from "@eo/plugin";

export interface SubagentFileToInstall {
  readonly relPath: string;
  readonly content: string;
}

/** Reads every required subagent's markdown from the plugin's own `agents/` directory, ready to be written verbatim to `.claude/agents/<name>.md` in the target project. */
export async function loadSubagentFilesToInstall(
  pluginSourceDir: string,
): Promise<readonly SubagentFileToInstall[]> {
  const files: SubagentFileToInstall[] = [];
  for (const name of REQUIRED_SUBAGENT_NAMES) {
    const content = await readFile(join(pluginSourceDir, "agents", `${name}.md`), "utf8");
    files.push({ relPath: join(".claude", "agents", `${name}.md`), content });
  }
  return files;
}
