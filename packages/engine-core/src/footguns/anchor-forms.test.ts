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

  // The numRuns bump from 5000 to 10000 (Test plan: ≥10k cases) plus the
  // CRITICAL 1 fix's larger deny array (10 new Edit/Write backstop
  // entries) pushes this specific nested-loop property over vitest's
  // default 5000ms per-test timeout under v8 coverage instrumentation — a
  // coverage-instrumentation timing artifact, not a correctness issue (the
  // equivalent property.test.ts properties, with less nested work per
  // iteration, stay under the default). Scoped to this one test via `it`'s
  // own per-test timeout argument — vitest.config.ts is off-limits to this
  // worker.
  const SLOW_PROPERTY_TIMEOUT_MS = 20000;

  it(
    "no allow rule ever appears verbatim in the deny list, and vice versa, for any owned-path/command/network/credential input (fast-check, ≥10k cases)",
    () => {
      fc.assert(
        fc.property(envelopeArbitrary(), (envelope) => {
          const profile = compileEnvelope(envelope);
          for (const denyRule of profile.permissions.deny) {
            expect(profile.permissions.allow).not.toContain(denyRule);
          }
        }),
        { numRuns: 10000 },
      );
    },
    SLOW_PROPERTY_TIMEOUT_MS,
  );

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
