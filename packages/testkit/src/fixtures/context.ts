import { createClockProvider, type ClockProvider } from "../providers/clock-provider.js";
import { createIdProvider, type IdProvider } from "../providers/id-provider.js";

/**
 * Shared per-call fixture context — every `build<Contract>()` call in this
 * directory creates one fresh context (seed `0`, default fixed epoch/step),
 * so a single builder invocation can draw multiple distinct ids/timestamps
 * (e.g. a contract's own `id` plus a cross-reference `changeSetId`) while
 * the ENTIRE fixture's default output stays byte-reproducible across every
 * run, on every machine — the "deterministic across runs" requirement
 * (roadmap/02-contracts-and-schemas.md work item 10) applied at the
 * fixture-builder level, not just the raw-provider level.
 */
export interface FixtureContext {
  readonly ids: IdProvider;
  readonly clock: ClockProvider;
}

/** A fresh, deterministic context: id provider seeded at `0`, clock provider at its fixed default epoch/step. */
export function createFixtureContext(): FixtureContext {
  return { ids: createIdProvider(0), clock: createClockProvider() };
}
