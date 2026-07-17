import type { Id } from "@eo/contracts";
import { IdSchema } from "@eo/contracts";

/**
 * Deterministic ID provider — roadmap/02-contracts-and-schemas.md work item
 * 10: "an ID provider producing IdSchema-valid (RFC-4122-shaped) UUIDs from
 * a seed/counter — deterministic across runs." Consumed by every fixture
 * builder in `../fixtures/` in place of `crypto.randomUUID()`, so every
 * fixture's default output is byte-reproducible run-to-run.
 *
 * Two layers, per this worker's brief ("Pure/immutable — advancing returns
 * state, doesn't mutate hidden globals; a closure-counter factory is
 * acceptable if documented; prefer explicit"):
 *  1. `drawId` — the pure, explicit core: `(state) => { id, state }`, never
 *     mutates its input, always returns a fresh state.
 *  2. `createIdProvider` — a documented closure-counter convenience
 *     wrapper around (1), for fixture-authoring ergonomics. Its private
 *     counter lives only in its own closure — never a module-level
 *     variable — so two independently-constructed providers never observe
 *     or interfere with each other's draws (see `id-provider.test.ts`).
 */

export interface IdProviderState {
  readonly seed: number;
  readonly counter: number;
}

/** A fresh provider state at counter 0 for the given seed (default seed `0`). */
export function createIdProviderState(seed: number = 0): IdProviderState {
  return { seed, counter: 0 };
}

export interface IdDraw {
  readonly id: Id;
  readonly state: IdProviderState;
}

/**
 * 32-bit integer mix (xorshift-multiply, deterministic, no external
 * randomness source) — used only to spread `(seed, counter)` pairs across
 * the UUID's hex digits with reasonable-looking dispersion. Not
 * cryptographic; fixtures need determinism and RFC-4122 shape, not
 * unpredictability.
 */
function mix32(x: number): number {
  let h = x >>> 0;
  h = (h ^ (h >>> 16)) >>> 0;
  h = Math.imul(h, 0x45d9f3b) >>> 0;
  h = (h ^ (h >>> 16)) >>> 0;
  h = Math.imul(h, 0x45d9f3b) >>> 0;
  h = (h ^ (h >>> 16)) >>> 0;
  return h >>> 0;
}

function toHex8(n: number): string {
  return (n >>> 0).toString(16).padStart(8, "0");
}

const VARIANT_NIBBLES = "89ab";

/**
 * Pure derivation of an RFC-4122-shaped (version-4, variant-1) UUID string
 * from `(seed, counter)`. Deterministic: the same pair always produces the
 * same string, on any run, on any machine.
 */
function deriveUuid(seed: number, counter: number): Id {
  const base = (Math.imul(seed, 0x9e3779b1) + counter) >>> 0;
  const h0 = mix32(base);
  const h1 = mix32(h0 + 1);
  const h2 = mix32(h0 + 2);
  const h3 = mix32(h0 + 3);
  const hex = toHex8(h0) + toHex8(h1) + toHex8(h2) + toHex8(h3); // 32 hex chars
  const variantNibble = VARIANT_NIBBLES[h3 % 4];

  const uuid =
    `${hex.slice(0, 8)}-${hex.slice(8, 12)}-` +
    `4${hex.slice(13, 16)}-` +
    `${variantNibble}${hex.slice(17, 20)}-` +
    `${hex.slice(20, 32)}`;

  return IdSchema.parse(uuid);
}

/** Pure: derives the next id and the next state from the current state. Never mutates `state`. */
export function drawId(state: IdProviderState): IdDraw {
  const id = deriveUuid(state.seed, state.counter);
  return { id, state: { seed: state.seed, counter: state.counter + 1 } };
}

export interface IdProvider {
  /** Returns the next deterministic id, advancing this provider's own private counter. */
  next(): Id;
}

/**
 * Closure-counter convenience factory (documented, per this module's own
 * doc comment above). Equivalent to repeatedly calling `drawId` and
 * threading the returned state by hand; the counter it advances is private
 * to the returned object, never a shared/hidden module-level global.
 */
export function createIdProvider(seed: number = 0): IdProvider {
  let state = createIdProviderState(seed);
  return {
    next(): Id {
      const draw = drawId(state);
      state = draw.state;
      return draw.id;
    },
  };
}
