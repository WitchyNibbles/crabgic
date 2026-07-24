/**
 * Advisory-hooks-only validator — roadmap/10-plugin-and-installer.md §In
 * scope: "advisory manager hooks (PostToolUse formatting warnings, Stop-time
 * reminders — non-blocking, distinct from the worker-context blocking hooks
 * owned by 03/06)." This package's `hooks/hooks.json` must only register
 * events from `ADVISORY_ONLY_EVENTS` — `PreToolUse` (which can block a tool
 * call outright) is deliberately never allowed here.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";

/** The only hook lifecycle events this plugin may register — both are inherently non-blocking-by-convention in this package's own scripts (§In scope: "non-blocking"). */
export const ADVISORY_ONLY_EVENTS = ["PostToolUse", "Stop"] as const;

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

  const allowed = new Set<string>(ADVISORY_ONLY_EVENTS);
  for (const eventName of Object.keys(result.data.hooks)) {
    if (!allowed.has(eventName)) {
      problems.push(
        `event "${eventName}" is not advisory-only (allowed: ${ADVISORY_ONLY_EVENTS.join(", ")})`,
      );
    }
  }
  return { ok: problems.length === 0, problems };
}
