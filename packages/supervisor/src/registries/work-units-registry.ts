/**
 * Work-units registry — roadmap/05-supervisor-daemon.md §Registries:
 * "work units (11's DAG nodes)." Keyed by `WorkUnit.id`; `changeSetId` is
 * carried on each `WorkUnit` value itself (`@eo/contracts`), so
 * change-set-scoped listing is a `query()` filter, not a second index.
 */
import { type WorkUnit } from "@eo/contracts";
import { createInMemoryRegistry, type Registry } from "./registry.js";

export function createWorkUnitsRegistry(): Registry<WorkUnit> {
  return createInMemoryRegistry<WorkUnit>();
}
