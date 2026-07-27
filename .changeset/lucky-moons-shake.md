---
"crabgic": patch
---

Fix the status line rendering nothing when it is invoked through a symlink.

The script's main-module guard compared `import.meta.url` against
`process.argv[1]` directly. `argv[1]` is the path as invoked, but
`import.meta.url` is the real path — Node resolves symlinks for module
identity — so a symlinked invocation looked like a plain import and the entry
point silently declined to run: exit 0, empty stdout, no error, and Claude
Code rendering a blank status row with nothing to debug. Resolving `argv[1]`
before the comparison makes both invocations agree.

Direct-path invocation, which is what `crabgic install` writes into
`.claude/settings.json`, was never affected. This only bit a status line
pointed at the script through a symlink — for example one at
`~/.claude/crabgic-statusline.mjs` aimed at a globally installed copy, which
is how it was found.

The suite now spawns the script for real, both directly and through a
symlink, because the regression is invisible to a test that imports it.
