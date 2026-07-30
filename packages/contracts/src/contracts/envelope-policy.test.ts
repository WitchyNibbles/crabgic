/**
 * `EnvelopePolicy` schema — ledger Gap 18.
 *
 * These tests pin the properties the *ruling* rests on, not the field list:
 * every authority dimension defaults to deny, the grantable-command
 * vocabulary is closed, and nothing about the shape lets a policy author
 * believe a field bounds something it does not.
 */
import { describe, expect, it } from "vitest";
import {
  EnvelopePolicySchema,
  GRANTABLE_COMMAND_PREFIXES,
  type EnvelopePolicy,
} from "./envelope-policy.js";

const MINIMAL = {
  schemaVersion: 1,
  id: "11111111-1111-4111-8111-111111111111",
  createdAt: "2026-01-01T00:00:00.000Z",
  allowedPathPrefixes: ["src"],
};

describe("EnvelopePolicySchema", () => {
  it("accepts a policy that declares only paths", () => {
    expect(() => EnvelopePolicySchema.parse(MINIMAL)).not.toThrow();
  });

  /**
   * The single most important property in the schema. Roast round 1, F10:
   * a 9th authority axis added as a bare `.optional()` would let every
   * policy already on disk silently authorize a dimension its author never
   * saw. Defaulting each axis to the EMPTY set makes an omitted field deny,
   * so a new axis fails closed the way a 12th high-impact flag already does.
   */
  it("defaults every unstated authority dimension to deny, never to absent", () => {
    const policy: EnvelopePolicy = EnvelopePolicySchema.parse(MINIMAL);

    expect(policy.allowedCommands).toEqual([]);
    expect(policy.allowedNetworkDestinations).toEqual([]);
    expect(policy.allowedCredentialReferences).toEqual([]);
    expect(policy.allowedRemoteResourceReferences).toEqual([]);
    expect(policy.allowedWriteScratchPaths).toEqual([]);
    expect(policy.allowUnixSockets).toBe(false);
    // The worker turn budget is an authority axis like any other: a policy
    // written before the axis existed grants ZERO turns and every dispatch
    // escalates until its author states a ceiling — F10's fail-closed shape
    // for a numeric dimension (0 is the numeric empty set).
    expect(policy.maxWorkerTurnsPerAttempt).toBe(0);
  });

  it("accepts an explicit turn ceiling and rejects meaningless ones", () => {
    expect(
      EnvelopePolicySchema.parse({ ...MINIMAL, maxWorkerTurnsPerAttempt: 40 })
        .maxWorkerTurnsPerAttempt,
    ).toBe(40);
    // Zero is legal (it is the deny default written out explicitly).
    expect(
      EnvelopePolicySchema.parse({ ...MINIMAL, maxWorkerTurnsPerAttempt: 0 })
        .maxWorkerTurnsPerAttempt,
    ).toBe(0);
    for (const invalid of [-1, 1.5, "40", null, Number.NaN]) {
      expect(
        EnvelopePolicySchema.safeParse({ ...MINIMAL, maxWorkerTurnsPerAttempt: invalid }).success,
        `maxWorkerTurnsPerAttempt ${JSON.stringify(invalid)} must be rejected`,
      ).toBe(false);
    }
  });

  /**
   * Roast round 1, F6: `emitPermissionProfile` uses `envelope.commands` only
   * to gate which of four fixed literals are emitted; every other string is
   * silently discarded and grants nothing. An open `string[]` here would let
   * a policy author write `npm run lint`, believe they had granted it, and
   * get a run that halts over a string whose presence leaves the compiled
   * profile byte-identical.
   */
  it("closes the command vocabulary to what the compiler can actually grant", () => {
    expect(GRANTABLE_COMMAND_PREFIXES).toEqual([
      "npm run test",
      "npm run build",
      "git status",
      "git diff",
    ]);

    expect(() =>
      EnvelopePolicySchema.parse({ ...MINIMAL, allowedCommands: ["npm run lint"] }),
    ).toThrow();
    expect(() =>
      EnvelopePolicySchema.parse({ ...MINIMAL, allowedCommands: ["npm run test"] }),
    ).not.toThrow();
  });

  /**
   * Roast round 1, F4: `allowAllUnixSockets: true` is unconditional in the
   * compiled sandbox today, so `allowedNetworkDestinations: []` does not mean
   * "no network" -- a reachable docker socket is host-root write. The policy
   * makes it a declared grant; this pins that the declaration defaults off.
   */
  it("treats unix sockets as a grant that must be asked for", () => {
    expect(EnvelopePolicySchema.parse(MINIMAL).allowUnixSockets).toBe(false);
    expect(
      EnvelopePolicySchema.parse({ ...MINIMAL, allowUnixSockets: true }).allowUnixSockets,
    ).toBe(true);
  });

  it("rejects an unknown field rather than ignoring it", () => {
    expect(() => EnvelopePolicySchema.parse({ ...MINIMAL, allowedEverything: true })).toThrow();
  });

  /**
   * A policy is worthless if it cannot be authored to grant nothing, but a
   * policy that grants nothing must be *detectable* -- roast F9: all-empty
   * lists pass every existence/parse/mode/untracked check while every run
   * halts. The schema stays permissive and exports the predicate the doctor
   * check and the installer both use, so "vacuous" has one definition.
   */
  it("parses a vacuous policy but reports it as vacuous", async () => {
    const { isVacuousPolicy } = await import("./envelope-policy.js");
    expect(
      isVacuousPolicy(EnvelopePolicySchema.parse({ ...MINIMAL, allowedPathPrefixes: [] })),
    ).toBe(true);
    expect(isVacuousPolicy(EnvelopePolicySchema.parse(MINIMAL))).toBe(false);
  });
});

/**
 * Roast round 3, F3. A prefix that cannot grant anything must not make the
 * policy look healthy. `is-contained.ts` documented this exact scenario in
 * prose while the vacuity test, written afterwards, checked only length.
 */
describe("isVacuousPolicy — prefixes that cannot grant", () => {
  // `"  "` is deliberately absent: `NonEmptyStringSchema` trims, so the schema
  // rejects a whitespace-only prefix before this predicate is ever consulted.
  // That is the stronger guarantee, asserted separately below.
  it.each(["src/**", "src/*", "/abs/src", "~/src", "../escape", "src\\login"])(
    "treats a policy whose only prefix is %j as vacuous",
    async (prefix) => {
      const { isVacuousPolicy } = await import("./envelope-policy.js");
      expect(
        isVacuousPolicy(EnvelopePolicySchema.parse({ ...MINIMAL, allowedPathPrefixes: [prefix] })),
      ).toBe(true);
    },
  );

  it("is not vacuous when at least one prefix is usable", async () => {
    const { isVacuousPolicy } = await import("./envelope-policy.js");
    expect(
      isVacuousPolicy(
        EnvelopePolicySchema.parse({ ...MINIMAL, allowedPathPrefixes: ["src/**", "src"] }),
      ),
    ).toBe(false);
  });

  it("is rejected by the schema, not merely by the predicate, when whitespace-only", () => {
    expect(() => EnvelopePolicySchema.parse({ ...MINIMAL, allowedPathPrefixes: ["  "] })).toThrow();
  });

  it.each(["src", "packages/cli/src", "./src", "src/"])(
    "accepts the usable prefix %j",
    async (prefix) => {
      const { isUsablePathPrefix } = await import("./envelope-policy.js");
      expect(isUsablePathPrefix(prefix)).toBe(true);
    },
  );
});

/** Roast round 5: `./~` slipped past a leading-`~` check that ran before the split. */
describe("isUsablePathPrefix — home anchoring after collapse", () => {
  it.each(["~", "~/x", "./~", ".///~/.ssh"])("rejects %j", async (prefix) => {
    const { isUsablePathPrefix } = await import("./envelope-policy.js");
    expect(isUsablePathPrefix(prefix)).toBe(false);
  });

  it("still accepts a path merely containing a tilde mid-segment", async () => {
    const { isUsablePathPrefix } = await import("./envelope-policy.js");
    expect(isUsablePathPrefix("src/a~b")).toBe(true);
  });
});

/**
 * RETIRED after round 8. This block asserted that a whitespace-leading
 * segment disguises a home anchor, which round 8 disproved by measurement:
 * trimming segments to make `"./ ~"` "look like" `~` produced 1791
 * containment false positives, because the compiler trims only the whole
 * string and would grant the directory `" ~"` that the path actually names.
 * The corrected assertions live in the block above.
 */

/**
 * Roast round 7 measured the round-6 trim and found it made things worse:
 * 1143 mismatches became 6895 over a 51,911-prefix corpus. There is now ONE
 * normalizer, so the two answers cannot differ by construction -- this pins
 * the equivalence directly rather than sampling it.
 */
describe("isUsablePathPrefix is exactly normalizePathPrefix", () => {
  it.each([
    "src",
    "./src",
    "src/",
    "./ /src",
    "src/ /login",
    ".",
    "./",
    "./~",
    "./ ~",
    "src /",
    "~/x",
    "/abs",
    "../up",
    "./src/ ..",
    "src/**",
    "srcfoo",
    "  ",
    "a//b",
  ])("agrees on %j", async (prefix) => {
    const { isUsablePathPrefix, normalizePathPrefix } = await import("./envelope-policy.js");
    expect(isUsablePathPrefix(prefix)).toBe(normalizePathPrefix(prefix) !== undefined);
  });

  /**
   * The normalizer must name the SAME directory the compiler grants. It
   * removes `.` and empty segments -- which change nothing on disk -- and
   * leaves everything else alone, because `validateOwnedPath`, whose output
   * the compiler emits, trims only the whole string.
   */
  it("preserves whitespace segments, which name real directories", async () => {
    const { normalizePathPrefix } = await import("./envelope-policy.js");
    expect(normalizePathPrefix("./src")).toBe("src");
    expect(normalizePathPrefix("src/")).toBe("src");
    expect(normalizePathPrefix("./ /src")).toBe(" /src");
    expect(normalizePathPrefix("src /")).toBe("src ");
  });
});
