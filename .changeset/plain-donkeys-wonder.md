---
"crabgic": minor
---

Add a Claude Code status line, installed and registered by `crabgic install`.

The line shows the model and its reasoning effort, the current git branch and dirty
flag, session context-window usage as a meter, and the 5-hour and weekly subscription
usage windows — each value clearly divided from the next, on one shared green → amber →
red scale. A reset countdown appears on a usage window only once it passes 80%.

Two engine constraints shape the delivery (recorded in `docs/engine-baseline.md` §17,
read from the 2.1.220 binary): the plugin manifest has no `statusLine` key, and a
`settings.json` command referencing `${CLAUDE_PLUGIN_ROOT}` is rejected outright. So the
installer copies the script to `.claude/crabgic-statusline.mjs` as a wholly-owned
artifact and registers it via `$CLAUDE_PROJECT_DIR`, keeping a committed
`.claude/settings.json` portable across machines.

`statusLine` is add-only like every other key the installer writes: a status line you
already configured is never replaced.
