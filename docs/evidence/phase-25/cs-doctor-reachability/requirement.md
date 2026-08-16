# Change set `cs-doctor-reachability` — requirement

**Source:** the three defects measured 2026-08-16 in
`../pipeline-surface-unreachable.md`. This change set addresses the third, which
is the one that let the other two survive undetected.

## Requirement

`crabgic doctor` must fail when the shipped pipeline surface is unreachable from
an ordinary session in this project. Two conditions, each independently
sufficient to make `/eo:pipeline` inert, and neither currently checked:

1. **Plugin registration.** The project declares
   `enabledPlugins["crabgic@crabgic-marketplace"]` in `.claude/settings.json`,
   but the engine's own registries (`~/.claude/plugins/known_marketplaces.json`,
   `~/.claude/plugins/installed_plugins.json`) do not carry a matching entry. The
   key names a plugin the engine has never heard of and is ignored silently.

2. **Gateway tool reachability.** The `crabgic` binary that `.mcp.json` starts —
   resolved from `PATH`, not from this checkout — does not expose the gateway
   tools the shipped skills call by name (`pipeline.plan`, `review.submit`).

## Acceptance criteria

| id  | criterion                                                                                                                                         |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| AC1 | A doctor check fails, with severity `error`, when the marketplace named in `enabledPlugins` is absent from the engine's `known_marketplaces.json` |
| AC2 | A doctor check fails, with severity `error`, when the plugin named in `enabledPlugins` is absent from `installed_plugins.json`                    |
| AC3 | A doctor check fails when the `crabgic` resolved from `PATH` does not expose every tool name the shipped skills reference                         |
| AC4 | Each new check carries a `repairStep` naming the exact command that fixes it                                                                      |
| AC5 | Each check passes on this checkout as repaired on 2026-08-16, and reddens when the corresponding registry entry is removed                        |
| AC6 | No check shells out to the engine's network surface; all evidence is read from local files or a local stdio handshake                             |

## Non-goals

- Changing what `crabgic install` writes. The installer's decision not to write
  skills is deliberate; this change set makes the resulting gap **visible**, not
  absent.
- Auto-repairing. `doctor` reports and names the repair; it does not run it.

## Owned paths

- `packages/cli/src/doctor/**`
- `docs/evidence/phase-25/cs-doctor-reachability/**`
