/**
 * Change-sets registry — roadmap/05-supervisor-daemon.md §Registries:
 * "the change-set registry is populated by 11 and read back by 11's own
 * `project.inspect` over this same UDS surface — there is no dedicated
 * change-set-family MCP tool anywhere in v1; ChangeSet-state queries
 * are answered exclusively that way." This phase provides only the store +
 * read path (`registry.changeSets.get`/`registry.changeSets.list`,
 * `../router/operations.ts`) — writes are 11's, not exercised here beyond
 * the plain `Registry<ChangeSet>.put()` a future 11 integration calls.
 */
import { type ChangeSet } from "@eo/contracts";
import { createInMemoryRegistry, type Registry } from "./registry.js";

export function createChangeSetsRegistry(): Registry<ChangeSet> {
  return createInMemoryRegistry<ChangeSet>();
}
