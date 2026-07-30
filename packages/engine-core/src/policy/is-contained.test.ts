/**
 * Containment check — ledger Gap 18, part 2.
 *
 * NON-VACUITY IS THE POINT OF THIS FILE, and it is a scope obligation from
 * roadmap/03, not a preference. This phase's own history is why: its "no
 * allow outside the envelope" property once re-derived the compiler's own
 * emitted string and so could not have detected a confinement escape by
 * construction. Every envelope below is therefore hand-authored against the
 * POLICY -- none is produced by `compileEnvelope`, `buildAuthorizationEnvelope`
 * or any fixture builder that shares assumptions with the code under test.
 *
 * The hostile cases come from `docs/evidence/gap-18/design-roast-round-1.md`.
 */
import { describe, expect, it } from "vitest";
import {
  EnvelopePolicySchema,
  type AuthorizationEnvelope,
  type EnvelopePolicy,
} from "@crabgic/contracts";
import { isContained } from "./is-contained.js";

function policy(overrides: Partial<EnvelopePolicy> = {}): EnvelopePolicy {
  return EnvelopePolicySchema.parse({
    schemaVersion: 1,
    id: "11111111-1111-4111-8111-111111111111",
    createdAt: "2026-01-01T00:00:00.000Z",
    allowedPathPrefixes: ["src"],
    // Granted in the base fixture so the turn-budget dimension stays out of
    // every OTHER dimension's test; its own describe below overrides this.
    maxWorkerTurnsPerAttempt: 40,
    ...overrides,
  });
}

/** Hand-authored, deliberately NOT built by any production builder. */
function envelope(overrides: Partial<AuthorizationEnvelope> = {}): AuthorizationEnvelope {
  return {
    schemaVersion: 1,
    id: "22222222-2222-4222-8222-222222222222",
    changeSetId: "33333333-3333-4333-8333-333333333333",
    createdAt: "2026-01-01T00:00:00.000Z",
    canonicalHash: "sha256:deadbeef",
    ownedPaths: [],
    commands: [],
    networkDestinations: [],
    credentialReferences: [],
    dependencies: [],
    remoteResourceAuthorizations: [],
    temporaryServices: [],
    prohibitedActions: [],
    maxTurnsPerAttempt: 40,
    ...overrides,
  };
}

describe("isContained — owned paths", () => {
  it("contains a path at or below an allowed prefix", () => {
    expect(isContained(envelope({ ownedPaths: ["src"] }), policy()).contained).toBe(true);
    expect(isContained(envelope({ ownedPaths: ["src/login"] }), policy()).contained).toBe(true);
    expect(isContained(envelope({ ownedPaths: ["src/a/b/c"] }), policy()).contained).toBe(true);
  });

  /** The classic prefix bug. `src` must not contain `srcfoo`. */
  it("is segment-aware, not string-prefix", () => {
    const result = isContained(envelope({ ownedPaths: ["srcfoo"] }), policy());
    expect(result.contained).toBe(false);
    expect(result.reasons.join(" ")).toMatch(/srcfoo/);
  });

  it("does not let a sibling share a prefix by accident", () => {
    expect(isContained(envelope({ ownedPaths: ["src-secrets/keys"] }), policy()).contained).toBe(
      false,
    );
  });

  /**
   * Roast round 1's own requirement: compare `validateOwnedPath`'s RETURN
   * value on both sides, or the same logical path halts or passes depending
   * on how it was typed. These are all `src/login` after normalization.
   */
  it.each(["src/login/", "src/login//", " src/login ", "./src/login", "src/./login"])(
    "normalizes both sides before comparing: %j",
    (typed) => {
      expect(isContained(envelope({ ownedPaths: [typed] }), policy()).contained).toBe(true);
    },
  );

  /**
   * `validateOwnedPath` THROWS on these. Containment must fail closed rather
   * than propagate: a malformed envelope is not contained, and refusing is
   * the safe answer at a gate whose false-positive cost is an unauthorized
   * run.
   */
  it.each(["/etc/cron.d", "~/.ssh", "src/../../etc", "src/*", "src/**", ""])(
    "fails closed rather than throwing on the hostile path %j",
    (hostile) => {
      const result = isContained(envelope({ ownedPaths: [hostile] }), policy());
      expect(result.contained).toBe(false);
    },
  );

  /** Same obligation on the policy's own side — a malformed policy grants nothing. */
  it("fails closed when the POLICY prefix is itself malformed", () => {
    const result = isContained(
      envelope({ ownedPaths: ["src/login"] }),
      policy({ allowedPathPrefixes: ["/"] }),
    );
    expect(result.contained).toBe(false);
  });

  /**
   * Roast round 2, F4. `"src/**"` is the natural way to write "everything
   * under src" and it grants NOTHING -- glob metacharacters are rejected. It
   * parses, it is not vacuous, and it passes every structural doctor check,
   * so the refusal reason is the only thing that can tell an owner their
   * policy is the broken file rather than the envelope.
   */
  it.each(["src/**", "src/*", "/abs/src", "~/src", "../src"])(
    "names the POLICY as the fault when the prefix %j cannot grant anything",
    (badPrefix) => {
      const result = isContained(
        envelope({ ownedPaths: ["src/login"] }),
        policy({ allowedPathPrefixes: [badPrefix] }),
      );

      expect(result.contained).toBe(false);
      expect(result.reasons.some((reason) => /policy path prefix/.test(reason))).toBe(true);
    },
  );

  /**
   * Roast round 2, F8: the interior-`//` case was never covered, so the
   * `segment !== ""` filter was dead to the suite -- deleting it left every
   * test passing. `validateOwnedPath` strips only TRAILING slashes.
   */
  it("normalizes an interior double slash", () => {
    expect(isContained(envelope({ ownedPaths: ["src//login"] }), policy()).contained).toBe(true);
  });

  /**
   * Roast round 2, F9: the collapse could return a string `validateOwnedPath`
   * itself rejects -- `"./~"` collapses to `"~"`, re-creating the
   * home-anchored form. Both sides must refuse it.
   */
  it.each(["./~", "./~/.ssh"])(
    "re-rejects %j, which the collapse would otherwise re-create",
    (raw) => {
      expect(isContained(envelope({ ownedPaths: [raw] }), policy()).contained).toBe(false);
      expect(
        isContained(envelope({ ownedPaths: ["src/login"] }), policy({ allowedPathPrefixes: [raw] }))
          .contained,
      ).toBe(false);
    },
  );

  /**
   * Roast round 2, F9: mutating the empty-result guard to `segments.join("/")`
   * left every test passing, because nothing used a path that collapses to
   * nothing. `"."` is the whole worktree written as a no-op.
   */
  it.each([".", "./", "./."])("treats %j, which collapses to nothing, as not contained", (raw) => {
    expect(isContained(envelope({ ownedPaths: [raw] }), policy()).contained).toBe(false);
  });

  it("contains nothing when the policy allows no paths", () => {
    expect(
      isContained(envelope({ ownedPaths: ["src"] }), policy({ allowedPathPrefixes: [] })).contained,
    ).toBe(false);
  });

  it("an envelope claiming no paths at all is trivially contained on that axis", () => {
    expect(isContained(envelope(), policy()).contained).toBe(true);
  });
});

describe("isContained — exact-set dimensions", () => {
  it("requires every command to be listed", () => {
    expect(
      isContained(envelope({ commands: ["npm run test"] }), policy({ allowedCommands: [] }))
        .contained,
    ).toBe(false);
    expect(
      isContained(
        envelope({ commands: ["npm run test"] }),
        policy({ allowedCommands: ["npm run test"] }),
      ).contained,
    ).toBe(true);
  });

  it("requires every network destination to be listed, and defaults to none", () => {
    expect(
      isContained(envelope({ networkDestinations: ["registry.npmjs.org"] }), policy()).contained,
    ).toBe(false);
    expect(
      isContained(
        envelope({ networkDestinations: ["registry.npmjs.org"] }),
        policy({ allowedNetworkDestinations: ["registry.npmjs.org"] }),
      ).contained,
    ).toBe(true);
  });

  it("requires every credential reference to be listed, and defaults to none", () => {
    expect(
      isContained(envelope({ credentialReferences: ["JIRA_TOKEN"] }), policy()).contained,
    ).toBe(false);
  });

  /**
   * Roast round 2, F7. Deleting both `.trim()` calls in `exactlyContained`
   * left every test passing, because no case ever passed an untrimmed value.
   * The trim is kept and now covered -- but note the asymmetry it creates:
   * `sandbox-profile.ts` does NOT trim, so a padded credential reference is
   * judged contained under one identity and compiled under another. It fails
   * closed (the variable will not resolve), and is recorded here rather than
   * silently relied on.
   */
  it("matches an untrimmed envelope value against a trimmed policy entry", () => {
    expect(
      isContained(
        envelope({ credentialReferences: [" JIRA_TOKEN "] }),
        policy({ allowedCredentialReferences: ["JIRA_TOKEN"] }),
      ).contained,
    ).toBe(true);
  });

  /**
   * Roast F2/F3: the high-impact flag taxonomy is assigned by static per-kind
   * tables rather than by risk, so a Grafana `dashboard` and a Jira
   * single-issue update both carry NO flag. A design keyed on flags would
   * have auto-granted rewriting a production dashboard under a policy that
   * auto-grants nothing. Keying on the reference makes ANY remote
   * authorization escalate by default.
   */
  it("escalates a remote resource authorization carrying no flags at all", () => {
    const result = isContained(
      envelope({
        remoteResourceAuthorizations: [{ reference: "prod-slo-overview", highImpactFlags: [] }],
      }),
      policy(),
    );
    expect(result.contained).toBe(false);
    expect(result.reasons.join(" ")).toMatch(/prod-slo-overview/);
  });

  it("contains a remote resource the policy names", () => {
    expect(
      isContained(
        envelope({
          remoteResourceAuthorizations: [{ reference: "ENG-1", highImpactFlags: ["assignment"] }],
        }),
        policy({ allowedRemoteResourceReferences: ["ENG-1"] }),
      ).contained,
    ).toBe(true);
  });
});

describe("isContained — worker turn budget", () => {
  it("contains a request at or below the policy ceiling", () => {
    expect(
      isContained(envelope({ maxTurnsPerAttempt: 40 }), policy({ maxWorkerTurnsPerAttempt: 40 }))
        .contained,
    ).toBe(true);
    expect(
      isContained(envelope({ maxTurnsPerAttempt: 1 }), policy({ maxWorkerTurnsPerAttempt: 40 }))
        .contained,
    ).toBe(true);
  });

  it("escapes when the envelope requests more turns than the policy grants, naming both numbers", () => {
    const result = isContained(
      envelope({ maxTurnsPerAttempt: 41 }),
      policy({ maxWorkerTurnsPerAttempt: 40 }),
    );
    expect(result.contained).toBe(false);
    expect(result.reasons).toHaveLength(1);
    expect(result.reasons[0]).toMatch(/41/);
    expect(result.reasons[0]).toMatch(/40/);
    expect(result.reasons[0]).toMatch(/maxWorkerTurnsPerAttempt/);
  });

  /**
   * THE F10 SHAPE for a numeric axis: a policy on disk from before this
   * dimension existed parses with the ceiling defaulted to 0 and denies every
   * envelope, escalating until its author states a grant. An absent field
   * must never mean "unconstrained".
   */
  it("escapes against a pre-existing policy that never stated a ceiling (schema default 0)", () => {
    const preExisting = EnvelopePolicySchema.parse({
      schemaVersion: 1,
      id: "11111111-1111-4111-8111-111111111111",
      createdAt: "2026-01-01T00:00:00.000Z",
      allowedPathPrefixes: ["src"],
    });
    const result = isContained(envelope({ maxTurnsPerAttempt: 1 }), preExisting);
    expect(result.contained).toBe(false);
    expect(result.reasons.some((reason) => reason.includes("maxWorkerTurnsPerAttempt"))).toBe(true);
  });

  /**
   * Fail closed on malformed numbers that BYPASS the schema (hostile caller) —
   * built by spreading past the parser, since the schema itself rejects them
   * and the whole point is what happens when it was never consulted.
   */
  it("fails closed on a malformed request or ceiling", () => {
    for (const [requested, granted] of [
      [Number.NaN, 40],
      [0, 40],
      [-5, 40],
      [1.5, 40],
      [40, Number.NaN],
      [40, -1],
    ] as const) {
      const hostileEnvelope = { ...envelope(), maxTurnsPerAttempt: requested };
      const hostilePolicy = { ...policy(), maxWorkerTurnsPerAttempt: granted };
      const result = isContained(hostileEnvelope, hostilePolicy);
      expect(
        result.contained,
        `requested=${String(requested)} granted=${String(granted)} must not be contained`,
      ).toBe(false);
    }
  });
});

describe("isContained — dimensions it deliberately does not gate", () => {
  /**
   * Roast F5: `prohibitedActions` is read by NO consumer -- not the compiler,
   * not a gate, not the gateway. Its only reader was the human being removed.
   * Treating "more prohibitions" as narrowing would be reasoning about an
   * enforcement that does not exist, so containment ignores the field in
   * BOTH directions and the schema documents it as inert.
   */
  it("ignores prohibitedActions rather than crediting it as a narrowing", () => {
    const withProhibitions = envelope({
      ownedPaths: ["src"],
      prohibitedActions: ["do not touch src/auth"],
    });
    const without = envelope({ ownedPaths: ["src"], prohibitedActions: [] });

    expect(isContained(withProhibitions, policy()).contained).toBe(
      isContained(without, policy()).contained,
    );
  });
});

describe("isContained — all-or-nothing", () => {
  /**
   * Ledger Gap 18 part 2: no partial grant of the contained subset. An
   * envelope that is 90% inside the policy is outside it.
   */
  it("refuses the whole envelope when one dimension escapes, and says which", () => {
    const result = isContained(
      envelope({
        ownedPaths: ["src/login"],
        commands: ["npm run test"],
        networkDestinations: ["evil.example.com"],
      }),
      policy({ allowedCommands: ["npm run test"] }),
    );

    expect(result.contained).toBe(false);
    expect(result.reasons).toHaveLength(1);
    expect(result.reasons[0]).toMatch(/evil\.example\.com/);
  });

  /** Every escaping dimension is reported, so one dispatch attempt tells the owner the whole gap. */
  it("reports every escaping dimension at once, not just the first", () => {
    const result = isContained(
      envelope({
        ownedPaths: ["outside"],
        networkDestinations: ["evil.example.com"],
        credentialReferences: ["SECRET"],
      }),
      policy(),
    );

    expect(result.contained).toBe(false);
    expect(result.reasons).toHaveLength(3);
  });
});

/**
 * THE GUARD THAT WAS MISSING. Roast round 8 measured 1791 containment false
 * positives -- the gate approving paths the COMPILER resolves somewhere else
 * -- while all 155 tests in the affected suites passed. Nothing compared the
 * two.
 *
 * The compiler is the authority: `emitPermissionProfile` emits
 * `validateOwnedPath`'s output, and that is the directory a worker actually
 * gets. So containment must agree with it, and this asserts that directly
 * rather than asserting the normalizer's internals.
 *
 * `is-contained.ts`'s own header names the direction that matters: "a false
 * negative costs one refused dispatch and a policy edit; a false positive is
 * an unreviewed run with authority nobody granted."
 */
describe("isContained agrees with what the compiler actually grants", () => {
  const CASES = [
    // [ownedPath, policyPrefix, mustBeContained]
    ["src", "src", true],
    ["src/login", "src", true],
    ["./src", "src", true],
    ["src/", "src", true],
    // Whitespace names a REAL directory. The compiler grants `src `, which
    // the policy's `src` never approved -- so containment must refuse.
    ["src /", "src", false],
    ["./ /src", "src", false],
    [" /src", "src", false],
    // ...but a whitespace segment BELOW an approved prefix is genuinely
    // inside it: the compiler grants `src/ /login`, which is under `src`.
    ["src/ /login", "src", true],
    // A trailing-whitespace directory can be OWNED but never GRANTED: the
    // whole-string trim that `validateOwnedPath` applies eats it on the
    // policy side, so `"src "` as a prefix means `src`. That asymmetry fails
    // CLOSED -- such a path is always refused -- and is left rather than
    // "fixed", because removing the trim on one side is exactly the kind of
    // divergence from the compiler that produced 1791 false positives.
    ["src /", "src ", false],
    ["srcfoo", "src", false],
  ] as const;

  it.each(CASES)(
    "ownedPath %j under policy %j -> contained=%s, matching the compiled grant",
    (ownedPath, prefix, expected) => {
      const result = isContained(
        envelope({ ownedPaths: [ownedPath] }),
        policy({ allowedPathPrefixes: [prefix] }),
      );
      expect(result.contained).toBe(expected);
    },
  );

  /**
   * Directly: whatever directory the compiler names must be at or below a
   * policy prefix whenever containment says yes. Asserted against
   * `validateOwnedPath`, which is literally what the profile emitters call.
   */
  it.each([
    "src",
    "src/login",
    "./src",
    "src/",
    "src /",
    "./ /src",
    "src/ /login",
    "srcfoo",
    "src-secrets/keys",
  ])("never approves %j while the compiler resolves it outside the policy", async (ownedPath) => {
    const { validateOwnedPath } = await import("../compiler/owned-path.js");
    const result = isContained(
      envelope({ ownedPaths: [ownedPath] }),
      policy({ allowedPathPrefixes: ["src"] }),
    );
    if (!result.contained) return;

    // The compiler's own view of which directory this is.
    const granted = validateOwnedPath(ownedPath);
    const segments = granted.split("/").filter((s) => s !== "" && s !== ".");
    expect(segments[0]).toBe("src");
  });
});
