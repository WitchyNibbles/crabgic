import { describe, expect, it } from "vitest";
import * as fc from "fast-check";
import { compileEnvelope } from "../compiler/compile-envelope.js";
import { buildEnvelopeFixture } from "../compiler/envelope-fixture.js";
import { envelopeArbitrary } from "./envelope-arbitrary.js";

/**
 * Footgun: `//` vs `~/` vs bare `/` anchor forms never collide or shadow
 * (roadmap/03-envelope-compiler-engine-adapter.md §Test plan, Property
 * bullet; adaptation §4.1: "`//abs/path/**` (filesystem root), `~/`,
 * `/path` (relative to the settings file's project), bare (cwd-relative)").
 * This compiler uses exactly two anchor families: `//` for owned-path
 * allow rules, `~/` for the mandatory credential/control-repo denies —
 * this suite proves they never accidentally collapse into the same rule
 * string, and that neither ever silently disappears/shadows the other.
 */
describe("footgun: '//' vs '~/' anchor forms never collide or shadow", () => {
  it("owned-path allow rules are always '//<worktree>'-anchored (filesystem-root anchor, worktree-scoped — CRITICAL 1 fix)", () => {
    const profile = compileEnvelope(buildEnvelopeFixture({ ownedPaths: ["packages/a/src"] }));
    const pathRules = profile.permissions.allow.filter(
      (r) => r.startsWith("Edit(") || r.startsWith("Write("),
    );
    expect(pathRules.length).toBeGreaterThan(0);
    for (const rule of pathRules) {
      expect(rule).toMatch(/^(Edit|Write)\(\/\/<worktree>\/.*\/\*\*\)$/);
    }
  });

  it("mandatory credential/control-repo Read denies are always '~/'-anchored (home anchor)", () => {
    const profile = compileEnvelope(buildEnvelopeFixture());
    const readDenies = profile.permissions.deny.filter((r) => r.startsWith("Read("));
    expect(readDenies.length).toBe(4);
    for (const rule of readDenies) {
      expect(rule).toMatch(/^Read\(~\/.*\)$/);
    }
  });

  // ONE assertion per generated case, not one per deny rule. The earlier
  // form asserted inside a `for (const denyRule of ...deny)` loop, which
  // at 10k cases x 20 mandatory deny rules meant 200,000 `expect()` calls
  // — and a vitest/chai `expect()` costs far more than the work it was
  // guarding. Measured on this suite (10k cases, no coverage):
  //
  //   generate the envelope only .................  245ms
  //   + compileEnvelope (the actual code under test)  478ms
  //   + per-deny-rule expect() loop (old form) ... 3942ms
  //   + Set intersection, one expect() (this form)  620ms
  //
  // i.e. 88% of the old runtime was assertion-object construction, not
  // property evaluation. That overhead is also the part that degrades
  // worst under full-suite parallel CPU contention, which is how this
  // suite kept flaking on a 20s timeout despite finishing in ~4s alone.
  //
  // The assertion is UNCHANGED in strength: `deny ∩ allow === ∅` is
  // exactly what the old loop checked, one membership test at a time, and
  // set intersection is symmetric so it still covers the "and vice versa"
  // direction. numRuns stays at the Test plan's mandated 10k. On failure
  // this form is strictly more informative — it reports every colliding
  // rule at once rather than aborting on the first.
  //
  // No per-test timeout override: the root vitest.config.ts already sets
  // `testTimeout: 20000` repo-wide (its comment cites this very suite).
  // The local override that used to sit here restated that same 20000 and
  // its rationale referenced a 5000ms default that no longer exists.
  it("no allow rule ever appears verbatim in the deny list, and vice versa, for any owned-path/command/network/credential input (fast-check, ≥10k cases)", () => {
    fc.assert(
      fc.property(envelopeArbitrary(), (envelope) => {
        const profile = compileEnvelope(envelope);
        const allowed = new Set(profile.permissions.allow);
        const collisions = profile.permissions.deny.filter((rule) => allowed.has(rule));
        expect(collisions).toEqual([]);
      }),
      { numRuns: 10000 },
    );
  });

  it("a mandatory deny is never accidentally emitted twice under two different anchor spellings", () => {
    const profile = compileEnvelope(buildEnvelopeFixture());
    const uniqueDenies = new Set(profile.permissions.deny);
    expect(uniqueDenies.size).toBe(profile.permissions.deny.length);
  });
});

describe("MAJOR 3 regression: the compiler must not treat a hostile owned path as valid, compilable output", () => {
  it("compileEnvelope rejects '~/'-prefixed owned paths outright instead of compiling them into a plausible-looking allow rule (the exact input the OLD anchor-forms assertion endorsed as correct)", () => {
    expect(() =>
      compileEnvelope(buildEnvelopeFixture({ ownedPaths: ["~/.ssh", "~/.aws"] })),
    ).toThrow();
  });
});
