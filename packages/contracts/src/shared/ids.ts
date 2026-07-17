import { z } from "zod";

/**
 * Canonical identifier schema. Every contract's own `id` field, and every
 * foreign-key-style reference to another contract's `id` (e.g.
 * `WorkUnit.changeSetId`), is exactly this schema — never a bespoke
 * string/format invented per contract.
 */
export const IdSchema = z.string().uuid();
export type Id = z.infer<typeof IdSchema>;

/**
 * Canonical timestamp schema: an ISO-8601 UTC instant, matching the exact
 * shape produced by `Date#toISOString()` (e.g. `2026-07-15T12:00:00.000Z`).
 */
export const TimestampSchema = z.string().datetime({ offset: false });
export type Timestamp = z.infer<typeof TimestampSchema>;

/** A non-empty, trimmed display string (titles, names, summaries). */
export const NonEmptyStringSchema = z.string().trim().min(1);
