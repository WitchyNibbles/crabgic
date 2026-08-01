/**
 * `@crabgic/testkit` public barrel — roadmap/02-contracts-and-schemas.md work
 * item 10. Exports:
 *  - Deterministic providers (`./providers/`): id + clock.
 *  - One fixture builder per contract, plus the two new closed-union
 *    instance builders (`./fixtures/`), and the fixture registry the
 *    meta-test and the ajv integration harness both iterate.
 *  - The ajv + `ajv-formats` integration harness (`./ajv-harness.ts`),
 *    reused (never re-derived) by later phases 03/16/18/19/20/22.
 */
export * from "./providers/clock-provider.js";
export * from "./providers/id-provider.js";
export * from "./fixtures/index.js";
export * from "./ajv-harness.js";

// Hermetic environment for any test that spawns a REAL `git` against a
// throwaway directory (`./git-env.ts`). Not tied to one phase: it exists
// because `cwd` does NOT isolate a git subprocess — an inherited `GIT_DIR`
// outranks it — and this repo's own pre-push hook runs the suite with
// `GIT_DIR` set. Every fixture that shells out to git must route through it.
export * from "./git-env.js";

// Fake engine (roadmap/03-envelope-compiler-engine-adapter.md work items
// 5-6): scriptable EngineAdapter implementation + envelope-conformance
// fixture format, reused byte-identical by 06's own @live suite.
export * from "./fake-engine/index.js";
