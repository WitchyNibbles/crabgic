import { z } from "zod";
import type { Migration } from "./schema-version.js";

/**
 * Synthetic two-version schema pair, deliberately NOT one of this phase's
 * 21 real contracts. It exists only to prove out — and test — the
 * schemaVersion + migration pattern every real contract will follow the
 * first time any of them needs a v2 (none do yet on day one; every real
 * contract is pinned at `CURRENT_SCHEMA_VERSION = 1`). See
 * `schema-version-migration.test.ts`.
 */
export const DemoWidgetV1Schema = z.object({
  schemaVersion: z.literal(1),
  name: z.string().min(1),
});
export type DemoWidgetV1 = z.infer<typeof DemoWidgetV1Schema>;

export const DemoWidgetV2Schema = z.object({
  schemaVersion: z.literal(2),
  name: z.string().min(1),
  description: z.string(),
});
export type DemoWidgetV2 = z.infer<typeof DemoWidgetV2Schema>;

/** Upgrades a v1 payload to v2, defaulting the new `description` field. */
export const migrateDemoWidgetV1ToV2: Migration<DemoWidgetV1, DemoWidgetV2> = (v1) => ({
  schemaVersion: 2,
  name: v1.name,
  description: "",
});
