/**
 * The exact key `engineering-orchestrator install` must write under
 * `.claude/settings.json`'s `enabledPlugins` map.
 *
 * LIVE-VERIFIED (2026-07-24) against a real `claude` 2.1.218 binary — NOT
 * asserted from memory/docs, per this repo's engine-fact-drift ground rule
 * (`roadmap/README.md`). Procedure: in a scratch project + scratch `HOME`,
 * `claude plugin marketplace add <this package's root>`, then
 * `claude plugin install engineering-orchestrator@engineering-orchestrator-
 * marketplace --scope project`, then `claude plugin enable
 * engineering-orchestrator@engineering-orchestrator-marketplace --scope
 * project`. The resulting project `.claude/settings.json` was:
 *
 * ```json
 * { "enabledPlugins": { "engineering-orchestrator@engineering-orchestrator-marketplace": true } }
 * ```
 *
 * — the key is `<plugin-name>@<marketplace-name>`, NOT the bare plugin
 * name `PLUGIN_CAPABILITY_NAME` alone. Composed here from
 * `PLUGIN_CAPABILITY_NAME` (`./capability-entry.ts`) and `MARKETPLACE_NAME`
 * (`./marketplace-schema.ts`) — the sole definition site; no consumer
 * hand-types the composite a second time.
 */
import { PLUGIN_CAPABILITY_NAME } from "./capability-entry.js";
import { MARKETPLACE_NAME } from "./marketplace-schema.js";

export const ENABLED_PLUGIN_KEY = `${PLUGIN_CAPABILITY_NAME}@${MARKETPLACE_NAME}` as const;
