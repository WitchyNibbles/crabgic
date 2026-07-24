/**
 * On-disk layout for the content-addressed capability store — roadmap/12
 * §In scope, "Content-addressed capability store" bullet: "under
 * `$XDG_CACHE_HOME/engineering-orchestrator/<project-hash>/capability-
 * store/` (same convention, pinned in 04)." Interface-ledger Gap 14:
 * `@eo/journal`'s `resolveCacheRoot` is the SOLE definition site of the
 * shared cache root — this module only nests this phase's own subpath
 * under it, mirroring `packages/git-engine/src/layout.ts`'s own
 * convention for `git-control/`.
 */
import { join } from "node:path";
import { resolveCacheRoot, type XdgEnv } from "@eo/journal";

export const CAPABILITY_STORE_SUBDIR = "capability-store";

/** `$XDG_CACHE_HOME/engineering-orchestrator/<project-hash>/capability-store/` — the pinned capability-store path (Gap 14). */
export function resolveCapabilityStoreDir(env: XdgEnv, projectHash: string): string {
  return join(resolveCacheRoot(env, projectHash), CAPABILITY_STORE_SUBDIR);
}

/** `.../capability-store/<key>/` — one directory per content-addressed store key (see `./key.ts`). */
export function resolveCapabilityEntryDir(env: XdgEnv, projectHash: string, key: string): string {
  return join(resolveCapabilityStoreDir(env, projectHash), key);
}
