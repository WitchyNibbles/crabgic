import { z } from "zod";

/**
 * The schema version every one of this phase's 21 contracts is currently
 * pinned to. Bumped whenever a contract's shape changes in a
 * backward-incompatible way; the old version's schema (and a migration
 * function to the new version) must be kept alongside the new one — see
 * `schema-version-migration.demo.ts` for the pattern every future bump
 * follows.
 */
export const CURRENT_SCHEMA_VERSION = 1 as const;

/**
 * Every contract embeds `schemaVersion: SchemaVersionField` as its first
 * field (Risks bullet, roadmap/02-contracts-and-schemas.md: "schemaVersion
 * is carried on every contract from day one — the journal (04) must
 * survive contract evolution across versions").
 */
export const SchemaVersionField = z.literal(CURRENT_SCHEMA_VERSION);

/**
 * A migration is a pure function from one version's parsed shape to the
 * next version's parsed shape. Never mutates its input (coding-style:
 * immutability) — always returns a new object.
 */
export type Migration<TFrom, TTo> = (input: TFrom) => TTo;
