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
    expect(isContained(envelope({ credentialReferences: ["JIRA_TOKEN"] }), policy()).contained).toBe(
      false,
    );
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

describe("isContained — dimensions it deliberately does not gate", () => {
  /**
   * Roast F5: `prohibitedActions` is read by NO consumer -- not the compiler,
   * not a gate, not the gateway. Its only reader was the human being removed.
   * Treating "more prohibitions" as narrowing would be reasoning about an
   * enforcement that does not exist, so containment ignores the field in
   * BOTH directions and the schema documents it as inert.
   */
  it("ignores prohibitedActions rather than crediting it as a narrowing", () => {
    const withProhibitions = envelope({ ownedPaths: ["src"], prohibitedActions: ["do not touch src/auth"] });
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
