/**
 * Manager-hook event allowlist — roadmap/10-plugin-and-installer.md §In scope.
 *
 * SCOPE AMENDMENT, 2026-07-27. This validator was originally named and
 * documented as "advisory-hooks-only": roadmap/10 scoped every manager-side
 * hook as non-blocking, "distinct from the worker-context blocking hooks owned
 * by 03/06". That is no longer true of one event. `hooks/stop-autonomy-gate.mjs`
 * is a `Stop` hook that DELIBERATELY BLOCKS, because the manager operating
 * protocol's autonomy clause is otherwise only a request the model may ignore —
 * and the defect that motivated it (a manager asking the owner to type
 * "continue" after every step) is exactly the case where it did ignore it.
 * The engine contract that makes this possible is recorded in
 * `docs/engine-baseline.md` §19; the amendment itself is in roadmap/10.
 *
 * WHAT DID NOT CHANGE, and must not: `PreToolUse` — which can block an
 * arbitrary tool call outright — is still never allowed in the manager
 * context. Blocking a turn from ENDING is a bounded, recoverable act with an
 * engine-provided loop guard (`stop_hook_active`, §19.2); blocking arbitrary
 * tool calls from a user-editable settings scope is not, and remains 03/06's
 * worker-context privilege alone.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";

/**
 * The only hook lifecycle events this plugin may register.
 *
 * `PostToolUse` remains advisory-only by convention (see
 * `hooks/post-tool-use-format-warning.mjs`, which always exits 0). `Stop` is
 * the one event permitted to block, and only via the autonomy gate — see the
 * file-level amendment note.
 */
export const MANAGER_HOOK_EVENTS = ["PostToolUse", "Stop"] as const;

/**
 * @deprecated Renamed to `MANAGER_HOOK_EVENTS` in the 2026-07-27 scope
 * amendment — the list is no longer "advisory-only". Kept as an alias so no
 * consumer breaks on the rename; prefer the new name.
 */
export const ADVISORY_ONLY_EVENTS = MANAGER_HOOK_EVENTS;

const HookCommandSchema = z
  .object({ type: z.literal("command"), command: z.string().min(1) })
  .strict();
const HookEntrySchema = z
  .object({
    matcher: z.string().min(1).optional(),
    hooks: z.array(HookCommandSchema).min(1),
    description: z.string().min(1).optional(),
  })
  .strict();

export const HooksManifestSchema = z
  .object({
    $schema: z.string().min(1).optional(),
    hooks: z.record(z.string(), z.array(HookEntrySchema)),
  })
  .strict();
export type HooksManifest = z.infer<typeof HooksManifestSchema>;

export interface HooksManifestValidationResult {
  readonly ok: boolean;
  readonly problems: readonly string[];
}

/** Reads, schema-validates, and event-allowlist-validates `<pluginRoot>/hooks/hooks.json`. Never throws — problems are returned, not thrown, so a caller can report every issue at once. */
export function validateHooksManifest(pluginRoot: string): HooksManifestValidationResult {
  const problems: string[] = [];
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(join(pluginRoot, "hooks", "hooks.json"), "utf8"));
  } catch (err) {
    return {
      ok: false,
      problems: [
        `could not read/parse hooks/hooks.json: ${err instanceof Error ? err.message : String(err)}`,
      ],
    };
  }

  const result = HooksManifestSchema.safeParse(raw);
  if (!result.success) {
    return { ok: false, problems: [`schema violation: ${result.error.message}`] };
  }

  const allowed = new Set<string>(MANAGER_HOOK_EVENTS);
  for (const eventName of Object.keys(result.data.hooks)) {
    if (!allowed.has(eventName)) {
      problems.push(
        `event "${eventName}" is not a permitted manager-hook event (allowed: ${MANAGER_HOOK_EVENTS.join(", ")})`,
      );
    }
  }
  return { ok: problems.length === 0, problems };
}
