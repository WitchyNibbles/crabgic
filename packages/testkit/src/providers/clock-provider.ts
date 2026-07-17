import type { Timestamp } from "@eo/contracts";
import { TimestampSchema } from "@eo/contracts";

/**
 * Deterministic clock provider — roadmap/02-contracts-and-schemas.md work
 * item 10: "a clock provider producing TimestampSchema-valid ISO strings
 * from a fixed epoch + step." Consumed by every fixture builder in
 * `../fixtures/` in place of `new Date().toISOString()`, so every
 * fixture's default output is byte-reproducible run-to-run.
 *
 * Same two-layer shape as `./id-provider.ts` — see that module's doc
 * comment for the pure-core / closure-wrapper rationale.
 */

export interface ClockProviderState {
  readonly epochMs: number;
  readonly stepMs: number;
  readonly ticks: number;
}

/**
 * A fresh provider state at tick 0. Defaults: epoch `2026-01-01T00:00:00.000Z`
 * (this repo's own "current date" context — a stable, arbitrary fixed
 * instant, not `Date.now()`), step `1000`ms.
 */
export function createClockProviderState(
  epochMs: number = Date.UTC(2026, 0, 1),
  stepMs: number = 1000,
): ClockProviderState {
  return { epochMs, stepMs, ticks: 0 };
}

export interface TimestampDraw {
  readonly timestamp: Timestamp;
  readonly state: ClockProviderState;
}

/** Pure: derives the next timestamp and the next state from the current state. Never mutates `state`. */
export function drawTimestamp(state: ClockProviderState): TimestampDraw {
  const ms = state.epochMs + state.stepMs * state.ticks;
  const timestamp = TimestampSchema.parse(new Date(ms).toISOString());
  return { timestamp, state: { ...state, ticks: state.ticks + 1 } };
}

export interface ClockProvider {
  /** Returns the next deterministic timestamp, advancing this provider's own private tick counter. */
  next(): Timestamp;
}

/**
 * Closure-counter convenience factory (documented — see `./id-provider.ts`'s
 * matching `createIdProvider` for the identical rationale). The tick
 * counter it advances is private to the returned object, never a
 * shared/hidden module-level global.
 */
export function createClockProvider(epochMs?: number, stepMs?: number): ClockProvider {
  let state = createClockProviderState(epochMs, stepMs);
  return {
    next(): Timestamp {
      const draw = drawTimestamp(state);
      state = draw.state;
      return draw.timestamp;
    },
  };
}
