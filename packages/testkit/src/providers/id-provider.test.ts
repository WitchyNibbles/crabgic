import { describe, expect, it } from "vitest";
import { IdSchema } from "@eo/contracts";
import { createIdProvider, createIdProviderState, drawId } from "./id-provider.js";

/**
 * Deterministic ID provider — roadmap/02-contracts-and-schemas.md work item
 * 10: "an ID provider producing IdSchema-valid (RFC-4122-shaped) UUIDs from
 * a seed/counter — deterministic across runs." Failing-first (TDD): this
 * file is written before `id-provider.ts` exists.
 */
describe("drawId (pure core)", () => {
  it("produces an IdSchema-valid UUID", () => {
    const state = createIdProviderState(0);
    const { id } = drawId(state);
    expect(IdSchema.safeParse(id).success).toBe(true);
  });

  it("is deterministic: same seed + same counter always yields the same id", () => {
    const a = drawId(createIdProviderState(42));
    const b = drawId(createIdProviderState(42));
    expect(a.id).toBe(b.id);
  });

  it("advances the counter without mutating the input state (immutability)", () => {
    const state = createIdProviderState(7);
    const frozenCopy = { ...state };
    const { state: nextState } = drawId(state);
    expect(state).toEqual(frozenCopy);
    expect(nextState).not.toBe(state);
    expect(nextState.counter).toBe(state.counter + 1);
  });

  it("produces distinct ids for successive counters from the same seed", () => {
    const state0 = createIdProviderState(1);
    const draw1 = drawId(state0);
    const draw2 = drawId(draw1.state);
    expect(draw1.id).not.toBe(draw2.id);
    expect(IdSchema.safeParse(draw2.id).success).toBe(true);
  });

  it("different seeds produce different ids for the same counter position", () => {
    const a = drawId(createIdProviderState(1));
    const b = drawId(createIdProviderState(2));
    expect(a.id).not.toBe(b.id);
  });
});

describe("createIdProvider (closure convenience factory)", () => {
  it("documented closure-counter factory: .next() returns IdSchema-valid, sequentially-advancing ids", () => {
    const provider = createIdProvider(0);
    const first = provider.next();
    const second = provider.next();
    expect(IdSchema.safeParse(first).success).toBe(true);
    expect(IdSchema.safeParse(second).success).toBe(true);
    expect(first).not.toBe(second);
  });

  it("is deterministic across separate provider instances sharing a seed", () => {
    const providerA = createIdProvider(99);
    const providerB = createIdProvider(99);
    expect(providerA.next()).toBe(providerB.next());
    expect(providerA.next()).toBe(providerB.next());
  });

  it("never mutates a hidden module-level global — two independent providers never interfere", () => {
    const providerA = createIdProvider(1);
    const providerB = createIdProvider(1);
    providerA.next();
    providerA.next();
    const bFirst = providerB.next();
    // providerB's own first draw is unaffected by providerA's prior advances.
    const freshA = createIdProvider(1);
    expect(bFirst).toBe(freshA.next());
  });
});
