/**
 * Locates this package's own on-disk root directory (the directory
 * containing `.claude-plugin/plugin.json`, `skills/`, `agents/`, `hooks/`,
 * `.mcp.json`) — every other module in this package that reads those
 * artifacts goes through this single resolver rather than hand-rolling its
 * own relative-path guess, so a future rename/move of `src/` only needs to
 * update this one file.
 *
 * `import.meta.url` for THIS file is always `<pluginRoot>/dist/plugin-root.js`
 * at runtime (compiled) or `<pluginRoot>/src/plugin-root.ts` under a
 * ts-node-style loader — one directory up from `dist`/`src` is the package
 * root either way.
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export function resolvePluginRoot(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return join(here, "..");
}
