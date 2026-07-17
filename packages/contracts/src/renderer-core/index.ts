/**
 * `renderer-core` — a module inside `packages/contracts` (never a
 * standalone package; interface-ledger Gap 3 ruling), housing the
 * length/line counters and attribution-token scanner primitives that
 * phase 17's `lint()` stages and phase 08's belt-and-suspenders
 * attribution assertion both build on. See roadmap/02 In-scope's
 * "`renderer-core` module" bullet and Work item 6.
 */
export * from "./length-counter.js";
export * from "./line-counter.js";
export * from "./limit-check.js";
export * from "./attribution-scanner.js";
