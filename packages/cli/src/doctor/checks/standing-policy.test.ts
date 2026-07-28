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

/**
 * Roast round 9. `allowedWriteScratchPaths` had no usability filter, so a
 * glob rendered as granted, kept the policy non-vacuous, passed every check,
 * and was silently dropped when the profile compiled -- leaving the worker's
 * build denied at runtime with nothing pointing at the policy. Round 3's F3,
 * fixed for path prefixes and never carried across to the sibling field.
 */
describe("policy.standing — scratch paths that cannot grant", () => {
  it.each(["dist/**", "/abs/dist", "~/dist", "../dist"])(
    "FAILS a policy whose scratch path %j grants nothing",
    async (scratch) => {
      const finding = await run(() => ({
        status: "loaded" as const,
        policy: policy({ allowedWriteScratchPaths: [scratch] }),
        digest: "sha256:scratch",
      }));

      expect(finding.passed).toBe(false);
      expect(finding.evidence).toMatch(/cannot grant anything/i);
      expect(finding.repairStep).toMatch(/literal directory names/i);
    },
  );

  it("passes when every scratch path is a literal directory", async () => {
    const finding = await run(() => ({
      status: "loaded" as const,
      policy: policy({ allowedWriteScratchPaths: ["dist", "packages/cli/dist"] }),
      digest: "sha256:ok",
    }));

    expect(finding.passed).toBe(true);
  });
});

/**
 * THE HEADLINE OF ROUND 9, UNTESTED UNTIL ROUND 10 SAID SO.
 *
 * `transient` exists for exactly one consumer decision: this repairStep
 * branch. It shipped with no test -- two independent mutants (force the
 * ternary false; delete it and restore the old static string) both SURVIVED a
 * green suite, and the file sat at 81.3% branch coverage, above the repo's
 * >=80% gate, which is how it got through.
 *
 * The commit that added it had just criticised another branch for shipping
 * untested, in those words. So this pins the distinction both ways: reverting
 * the ternary as a "dead conditional" must fail here.
 */
describe("policy.standing — a transient failure must not invite a rewrite", () => {
  it("tells the owner to retry, and explicitly NOT to re-run install", async () => {
    const finding = await run(() => ({
      status: "invalid" as const,
      transient: true as const,
      reason: "could not open /p because this process is out of resources (EMFILE)",
    }));

    expect(finding.passed).toBe(false);
    expect(finding.repairStep).toMatch(/retry/i);
    // Following "re-run install" renames a machine-derived policy over a
    // hand-tuned one because a descriptor table filled up.
    expect(finding.repairStep).toMatch(/do NOT re-run/i);
  });

  it("still points a genuinely broken policy at the file", async () => {
    const finding = await run(() => ({
      status: "invalid" as const,
      reason: "policy file /p is not valid JSON",
    }));

    expect(finding.passed).toBe(false);
    expect(finding.repairStep).toMatch(/edit .* by hand|crabgic install/i);
    expect(finding.repairStep).not.toMatch(/retry/i);
  });

  it("keeps the evidence and the remedy consistent", async () => {
    const transient = await run(() => ({
      status: "invalid" as const,
      transient: true as const,
      reason: "out of resources (EMFILE); the policy itself is probably fine",
    }));

    // Evidence says the file is fine; the remedy must not say to rewrite it.
    expect(transient.evidence).toMatch(/probably fine/);
    expect(transient.repairStep).not.toMatch(/edit .* by hand/i);
  });
});
