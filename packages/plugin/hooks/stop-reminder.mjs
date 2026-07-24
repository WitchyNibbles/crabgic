#!/usr/bin/env node
/**
 * Advisory-only Stop-time reminder hook (roadmap/10-plugin-and-installer.md
 * §In scope, "advisory manager hooks"). Manager-context only, never blocking:
 * always exits 0. This is deliberately a static reminder rather than a live
 * query against the supervisor — the manager session's own `/eo:status` and
 * `/eo:evidence` skills are the authoritative source; this hook only nudges.
 */
process.stderr.write(
  "eo: session ending — remember to check `/eo:status` for any run still in " +
    "progress and `/eo:approve` for anything awaiting a human confirmation.\n",
);
process.exitCode = 0;
