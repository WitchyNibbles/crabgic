/**
 * The standing policy's doctor check (ledger Gap 18's disclosed mitigations).
 *
 * The case that matters is VACUITY: roast round 1 (F9) established that an
 * all-empty policy passes every structural check that can be made of it --
 * exists, parses, 0600, untracked -- while refusing every dispatch, so an
 * owner would see a green install, a green doctor, and a product that
 * silently never runs.
 */
import { describe, expect, it } from "vitest";
import { EnvelopePolicySchema } from "@crabgic/contracts";
import { buildStandingPolicyCheck } from "./standing-policy.js";

const PATH = "/state/envelope-policy.json";

function policy(overrides: Record<string, unknown> = {}) {
  return EnvelopePolicySchema.parse({
    schemaVersion: 1,
    id: "11111111-1111-4111-8111-111111111111",
    createdAt: "2026-01-01T00:00:00.000Z",
    allowedPathPrefixes: ["src"],
    ...overrides,
  });
}

type Loaded = ReturnType<typeof import("../../policy/policy-store.js").loadEnvelopePolicy>;

function run(load: () => Loaded) {
  return buildStandingPolicyCheck({ path: PATH, load: () => load() }).run();
}

describe("policy.standing", () => {
  it("passes and renders the whole grant when the policy is usable", async () => {
    const finding = await run(() => ({
      status: "loaded" as const,
      policy: policy({ allowedCommands: ["git status"] }),
      digest: "sha256:abc",
    }));

    expect(finding.passed).toBe(true);
    expect(finding.evidence).toContain("sha256:abc");
    expect(finding.evidence).toContain("paths [src]");
    expect(finding.evidence).toContain("commands [git status]");
    // Empty dimensions are rendered too: an owner who cannot see the standing
    // grant cannot narrow it, and "none" is the most important thing on it.
    expect(finding.evidence).toContain("network [none]");
    expect(finding.evidence).toContain("unix sockets denied");
  });

  /**
   * The whole point of the check. Well-formed, correct mode, untracked -- and
   * completely non-functional. Nothing else in the doctor set reports it.
   */
  it("FAILS a well-formed policy that grants nothing", async () => {
    const finding = await run(() => ({
      status: "loaded" as const,
      policy: policy({ allowedPathPrefixes: [] }),
      digest: "sha256:empty",
    }));

    expect(finding.passed).toBe(false);
    expect(finding.severity).toBe("error");
    expect(finding.evidence).toMatch(/grants no writable paths/);
    expect(finding.repairStep).toMatch(/allowedPathPrefixes/);
  });

  it("fails when there is no policy, and points at install", async () => {
    const finding = await run(() => ({ status: "absent" as const }));

    expect(finding.passed).toBe(false);
    expect(finding.repairStep).toMatch(/crabgic install/);
  });

  /** Invalid is a different owner problem from absent and must not be repaired by re-installing blindly. */
  it("surfaces an invalid policy's own reason", async () => {
    const finding = await run(() => ({
      status: "invalid" as const,
      reason: "policy file X is accessible to other accounts (mode 644)",
    }));

    expect(finding.passed).toBe(false);
    expect(finding.evidence).toMatch(/other accounts/);
    expect(finding.repairStep).toMatch(/edit .* by hand/);
  });

  /**
   * Every failure mode here stops the product working entirely, so none of
   * them is a warning. A warning would describe a broken installation as a
   * nit.
   */
  it("reports every outcome at error severity, never warning", async () => {
    for (const load of [
      () => ({ status: "absent" as const }),
      () => ({ status: "invalid" as const, reason: "x" }),
      () => ({
        status: "loaded" as const,
        policy: policy({ allowedPathPrefixes: [] }),
        digest: "d",
      }),
      () => ({ status: "loaded" as const, policy: policy(), digest: "d" }),
    ]) {
      expect((await run(load as () => Loaded)).severity).toBe("error");
    }
  });
});

/**
 * Roast round 3, F3. `is-contained.ts` documents this scenario verbatim --
 * "parses, is not vacuous, passes every doctor check, matches nothing" -- and
 * the fix had been applied to the containment refusal message but not to this
 * check, which was written afterwards.
 */
describe("policy.standing — prefixes that cannot grant", () => {
  it.each(["src/**", "/abs/src", "~/src", "../escape"])(
    "FAILS a policy whose only prefix is %j",
    async (prefix) => {
      const finding = await run(() => ({
        status: "loaded" as const,
        policy: policy({ allowedPathPrefixes: [prefix] }),
        digest: "sha256:unusable",
      }));

      expect(finding.passed).toBe(false);
      expect(finding.evidence).toMatch(/grants no writable paths/);
    },
  );

  it("passes when at least one prefix is usable", async () => {
    const finding = await run(() => ({
      status: "loaded" as const,
      policy: policy({ allowedPathPrefixes: ["src/**", "src"] }),
      digest: "sha256:mixed",
    }));

    expect(finding.passed).toBe(true);
  });
});
