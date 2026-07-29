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
      // Round 11 made the reason MORE precise: an unusable entry is now named
      // as such rather than being reported only as "the policy grants
      // nothing", which is true but does not say which line to fix.
      expect(finding.evidence).toMatch(/cannot grant anything|grants no writable paths/);
    },
  );

  /**
   * INVERTED by round 11. This asserted that a mixed list PASSES, which
   * encoded the defect rather than the requirement: `["src/**", "src"]` is
   * not vacuous -- one prefix works -- so the check reported it healthy while
   * rendering `src/**` as granted, and a worker owning anything under it was
   * refused for ever with nothing pointing at the policy line. The assertion
   * was written by the round-3 fix and survived four rounds because vacuity
   * and usability are different questions and only one was being asked.
   */
  it("FAILS a mixed list, naming the entry that grants nothing", async () => {
    const finding = await run(() => ({
      status: "loaded" as const,
      policy: policy({ allowedPathPrefixes: ["src/**", "src"] }),
      digest: "sha256:mixed",
    }));

    expect(finding.passed).toBe(false);
    expect(finding.evidence).toMatch(/src\/\*\*/);
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

/**
 * Roast round 11. The round-9 usability check was applied to
 * `allowedWriteScratchPaths` and never carried to `allowedPathPrefixes`, so a
 * MIXED list passed: `["src", "dist/**"]` rendered as "grants paths [src,
 * dist/**]" while `isContained` refused every dispatch for ever.
 * `isVacuousPolicy` needs only one usable prefix, so it cannot catch this.
 *
 * Round 3's F3 in its third field -- and reachable through the very remedy
 * this check prints, since "edit the policy by hand" is how such a list gets
 * written.
 */
describe("policy.standing — unusable entries in EITHER list field", () => {
  it.each(["dist/**", "/etc", "~/x", "../up"])(
    "FAILS a mixed prefix list containing %j",
    async (bad) => {
      const finding = await run(() => ({
        status: "loaded" as const,
        policy: policy({ allowedPathPrefixes: ["src", bad] }),
        digest: "sha256:mixed",
      }));

      expect(finding.passed).toBe(false);
      expect(finding.evidence).toMatch(/cannot grant anything/i);
      expect(finding.evidence).toMatch(/allowedPathPrefixes/);
    },
  );

  it("names which field the offending entry is in", async () => {
    const finding = await run(() => ({
      status: "loaded" as const,
      policy: policy({
        allowedPathPrefixes: ["src", "bad/**"],
        allowedWriteScratchPaths: ["dist", "worse/**"],
      }),
      digest: "sha256:both",
    }));

    expect(finding.evidence).toMatch(/allowedPathPrefixes "bad\/\*\*"/);
    expect(finding.evidence).toMatch(/allowedWriteScratchPaths "worse\/\*\*"/);
  });

  it("still passes when every entry in both fields is usable", async () => {
    const finding = await run(() => ({
      status: "loaded" as const,
      policy: policy({
        allowedPathPrefixes: ["src", "packages"],
        allowedWriteScratchPaths: ["dist", "packages/cli/dist"],
      }),
      digest: "sha256:clean",
    }));

    expect(finding.passed).toBe(true);
  });
});

/**
 * The unusable-entry check runs BEFORE the vacuity check, and the order
 * determines which message an owner reads. Pinned because "both are failures"
 * is not good enough: one names the line to fix and the other does not, and
 * nothing else in this suite asserts which one arrives.
 */
describe("policy.standing — the most actionable diagnosis wins", () => {
  it("names the offending entry when there is one to name", async () => {
    const finding = await run(() => ({
      status: "loaded" as const,
      policy: policy({ allowedPathPrefixes: ["src/**"] }),
      digest: "d",
    }));

    // "grants no writable paths" is also true here, but it does not tell the
    // owner WHICH line is wrong.
    expect(finding.evidence).toMatch(/cannot grant anything/);
    expect(finding.evidence).toMatch(/src\/\*\*/);
  });

  it("falls back to the vacuity message when there is nothing to name", async () => {
    const finding = await run(() => ({
      status: "loaded" as const,
      policy: policy({ allowedPathPrefixes: [] }),
      digest: "d",
    }));

    expect(finding.evidence).toMatch(/grants no writable paths/);
    expect(finding.repairStep).toMatch(/allowedPathPrefixes/);
  });
});

/**
 * Roast round 12: reporting one problem at a time cost the owner a round
 * trip. A policy with an empty prefix list AND an unusable scratch entry
 * reported only the glob -- so they fixed it, re-ran, and only then learned
 * the policy grants nothing at all.
 */
describe("policy.standing — reports every problem it can see at once", () => {
  it("names the unusable entry AND says the policy still grants nothing", async () => {
    const finding = await run(() => ({
      status: "loaded" as const,
      policy: policy({ allowedPathPrefixes: [], allowedWriteScratchPaths: ["dist/**"] }),
      digest: "d",
    }));

    expect(finding.passed).toBe(false);
    expect(finding.evidence).toMatch(/dist\/\*\*/);
    expect(finding.evidence).toMatch(/grants no usable writable path at all/);
    expect(finding.repairStep).toMatch(/add at least one directory/);
  });

  it("does not claim vacuity when the policy has a usable prefix", async () => {
    const finding = await run(() => ({
      status: "loaded" as const,
      policy: policy({ allowedPathPrefixes: ["src"], allowedWriteScratchPaths: ["dist/**"] }),
      digest: "d",
    }));

    expect(finding.evidence).not.toMatch(/grants no usable writable path/);
  });

  /** The consequence is stated per field -- a scratch glob does not refuse runs. */
  it("states the consequence that actually applies to the offending field", async () => {
    const scratchOnly = await run(() => ({
      status: "loaded" as const,
      policy: policy({ allowedPathPrefixes: ["src"], allowedWriteScratchPaths: ["dist/**"] }),
      digest: "d",
    }));
    expect(scratchOnly.evidence).toMatch(/build be denied at runtime/);
    expect(scratchOnly.evidence).not.toMatch(/refuses every run/);

    const prefixToo = await run(() => ({
      status: "loaded" as const,
      policy: policy({ allowedPathPrefixes: ["src", "bad/**"] }),
      digest: "d",
    }));
    expect(prefixToo.evidence).toMatch(/refuses every run/);
  });
});

/**
 * When both fields carry unusable entries the finding must explain BOTH.
 * Picking one consequence by `some()` was incomplete rather than false, but a
 * finding that lists two broken entries and explains one of them invites the
 * owner to fix only what was explained.
 */
describe("policy.standing — both consequences when both fields are broken", () => {
  it("explains the prefix AND the scratch consequence", async () => {
    const finding = await run(() => ({
      status: "loaded" as const,
      policy: policy({
        allowedPathPrefixes: ["src", "bad/**"],
        allowedWriteScratchPaths: ["dist", "worse/**"],
      }),
      digest: "d",
    }));

    expect(finding.evidence).toMatch(/refuses every run/);
    expect(finding.evidence).toMatch(/build be denied at runtime/);
    expect(finding.evidence).toMatch(/bad\/\*\*/);
    expect(finding.evidence).toMatch(/worse\/\*\*/);
  });

  it("explains only the one that applies", async () => {
    const prefixOnly = await run(() => ({
      status: "loaded" as const,
      policy: policy({ allowedPathPrefixes: ["src", "bad/**"] }),
      digest: "d",
    }));
    expect(prefixOnly.evidence).not.toMatch(/build be denied/);
  });
});

/**
 * Roast round 13, and the mutant that survived was the CORRECT
 * implementation.
 *
 * The vacuity sentence gates on whether the policy grants anything AS IT
 * STANDS, but it is a claim about the policy AFTER the repair it prints.
 * Measured: 3132 policies carried the sentence and 3066 were
 * execution-verified false. The repair-step half was the security-relevant
 * part -- under a standing approval it told the owner to add a directory they
 * do not need, widening a grant nobody reviews.
 */
describe("policy.standing — the vacuity claim must survive the repair", () => {
  /**
   * `is-contained.ts`'s own headline example. The policy IS vacuous today,
   * and fixing that single entry is exactly what makes it work.
   */
  it.each(["src/**", "packages/old[1]", "/abs/src", "~/src"])(
    "does not claim %j is unfixable when repairing it is enough",
    async (bad) => {
      const finding = await run(() => ({
        status: "loaded" as const,
        policy: policy({ allowedPathPrefixes: [bad] }),
        digest: "d",
      }));

      expect(finding.passed).toBe(false);
      expect(finding.evidence).not.toMatch(/will not make it work/);
      // And it must not tell the owner to widen the grant.
      expect(finding.repairStep).not.toMatch(/add at least one directory/);
    },
  );

  /** The one shape where there really is nothing to repair into a prefix. */
  it("still says so when the prefix list is empty", async () => {
    const finding = await run(() => ({
      status: "loaded" as const,
      policy: policy({ allowedPathPrefixes: [], allowedWriteScratchPaths: ["dist/**"] }),
      digest: "d",
    }));

    expect(finding.evidence).toMatch(/will not make it work/);
    expect(finding.repairStep).toMatch(/add at least one directory/);
  });

  it("repairing the named entry really does make the check pass", async () => {
    const broken = await run(() => ({
      status: "loaded" as const,
      policy: policy({ allowedPathPrefixes: ["src/**"] }),
      digest: "d",
    }));
    expect(broken.passed).toBe(false);

    // The repair the finding prints, applied.
    const repaired = await run(() => ({
      status: "loaded" as const,
      policy: policy({ allowedPathPrefixes: ["src"] }),
      digest: "d",
    }));
    expect(repaired.passed).toBe(true);
  });
});

/**
 * Round 13, finding 2: mutating the joiner to `""` survived all 67 tests,
 * emitting "…refuses every runan unusable build-output path lets…". Both
 * existing tests regex individual phrases, so nothing pinned that the two
 * consequences form a sentence -- in a round whose whole subject is
 * owner-facing wording.
 */
describe("policy.standing — the consequences read as one sentence", () => {
  it("joins two consequences legibly", async () => {
    const finding = await run(() => ({
      status: "loaded" as const,
      policy: policy({
        allowedPathPrefixes: ["src", "bad/**"],
        allowedWriteScratchPaths: ["dist", "worse/**"],
      }),
      digest: "d",
    }));

    expect(finding.evidence).toMatch(/refuses every run, and an unusable build-output path/);
    // Round 14: the entry LIST one line above had the identical defect, and
    // this test already constructs the only policy that renders it -- two
    // unusable entries -- while asserting just the consequence half. Mutating
    // its joiner to "" survived all 38 tests, emitting
    // `allowedPathPrefixes "bad/**"allowedWriteScratchPaths "worse/**"`.
    // That list is the round-12 fix's entire payload, so the unseparated
    // rendering hits exactly the case round 12 was added for.
    expect(finding.evidence).toMatch(
      /allowedPathPrefixes "bad\/\*\*", allowedWriteScratchPaths "worse\/\*\*"/,
    );
  });

  /**
   * Round 14, 2b: the repair step's text was never asserted end to end --
   * appending trailing garbage to its non-vacuous branch survived the whole
   * suite. It is the sentence an owner acts on, so it is pinned exactly.
   */
  it("prints a repair step with no trailing garbage", async () => {
    const withPrefix = await run(() => ({
      status: "loaded" as const,
      policy: policy({ allowedPathPrefixes: ["src", "bad/**"] }),
      digest: "d",
    }));
    expect(withPrefix.repairStep).toBe(
      `replace them with literal directory names in ${PATH} (no globs, no leading slash)`,
    );

    const emptyPrefix = await run(() => ({
      status: "loaded" as const,
      policy: policy({ allowedPathPrefixes: [], allowedWriteScratchPaths: ["dist/**"] }),
      digest: "d",
    }));
    expect(emptyPrefix.repairStep).toBe(
      `replace them with literal directory names in ${PATH} (no globs, no leading slash), and add at least one directory work may touch`,
    );
  });
});

/**
 * WHOLE STRINGS, not separators one at a time.
 *
 * Rounds 13, 14 and 15 each found the same defect one token further right:
 * a joiner or separator that no assertion covered, emitting things like
 * "refuses every runan unusable build-output path" or
 * `allowedPathPrefixes"bad/**"`. Pinning each separator as it was found is a
 * losing game -- round 15 said so plainly, and it was right: the next round
 * finds the next one.
 *
 * Asserting the complete rendered string subsumes every separator in it at
 * once, and it covers the branches that had NO assertion at all: the PASS
 * branch's rendered grant (which Gap 18's residual-risk disclosure rests on
 * -- "a gate nobody can inspect is a gate nobody can narrow"), the
 * `allowUnixSockets: true` case, and the absent-policy evidence.
 */
describe("policy.standing — every owner-facing string, in full", () => {
  it("renders the grant with multi-element lists and sockets allowed", async () => {
    const finding = await run(() => ({
      status: "loaded" as const,
      policy: policy({
        allowedPathPrefixes: ["src", "packages"],
        allowedWriteScratchPaths: ["dist", "packages/cli/dist"],
        allowedCommands: ["git status", "git diff"],
        allowedNetworkDestinations: ["registry.npmjs.org"],
        allowedCredentialReferences: ["JIRA_TOKEN"],
        allowedRemoteResourceReferences: ["ENG-1"],
        allowUnixSockets: true,
      }),
      digest: "sha256:abc",
    }));

    expect(finding.passed).toBe(true);
    expect(finding.evidence).toBe(
      "standing policy sha256:abc grants paths [src, packages]; " +
        "scratch [dist, packages/cli/dist]; commands [git status, git diff]; " +
        "network [registry.npmjs.org]; credentials [JIRA_TOKEN]; " +
        "remote resources [ENG-1]; unix sockets allowed",
    );
  });

  it("renders `denied` when sockets are not granted", async () => {
    const finding = await run(() => ({
      status: "loaded" as const,
      policy: policy({ allowedPathPrefixes: ["src"] }),
      digest: "sha256:abc",
    }));

    expect(finding.evidence).toBe(
      "standing policy sha256:abc grants paths [src]; scratch [none]; commands [none]; " +
        "network [none]; credentials [none]; remote resources [none]; unix sockets denied",
    );
  });

  it("renders the unusable-entry evidence in full, both fields", async () => {
    const finding = await run(() => ({
      status: "loaded" as const,
      policy: policy({
        allowedPathPrefixes: ["src", "bad/**"],
        allowedWriteScratchPaths: ["dist", "worse/**"],
      }),
      digest: "d",
    }));

    expect(finding.evidence).toBe(
      `the standing policy at ${PATH} lists paths that cannot grant anything: ` +
        'allowedPathPrefixes "bad/**", allowedWriteScratchPaths "worse/**". ' +
        "They are shown as granted but match nothing, so an unusable path prefix refuses " +
        "every run, and an unusable build-output path lets the build be denied at runtime " +
        "with nothing pointing back at the policy.",
    );
  });

  it("renders the absent-policy evidence in full", async () => {
    const finding = await run(() => ({ status: "absent" as const }));

    expect(finding.evidence).toBe(
      `no standing authorization policy at ${PATH}; every run will be refused until one exists`,
    );
  });
});

/**
 * Roast round 16, F5/F6. Round 13 removed a grant-widening hazard from the
 * unusable-entry branch -- "it told the owner to add a directory they do not
 * need, widening a grant nobody reviews" -- and left the VACUITY branch
 * pinned only by a regex. Mutating its repair step to say `add "/" to
 * allowedPathPrefixes` survived the full suite: under a standing approval,
 * instructing the owner to grant the filesystem root.
 *
 * F6 is the one junction the whole-string assertions did not transitively
 * reach: dropping the leading space on the vacuity clause emitted
 * "...back to the policy.It also grants no usable...".
 */
describe("policy.standing — the remaining owner-facing strings, in full", () => {
  it("renders the vacuity finding exactly, without widening the grant", async () => {
    const finding = await run(() => ({
      status: "loaded" as const,
      policy: policy({ allowedPathPrefixes: [] }),
      digest: "d",
    }));

    expect(finding.evidence).toBe(
      `the standing policy at ${PATH} grants no writable paths, so every run will be refused ` +
        "(it is well-formed, which is why nothing else reports it)",
    );
    expect(finding.repairStep).toBe(
      `add the directories work may touch to \`allowedPathPrefixes\` in ${PATH}`,
    );
    // The hazard round 13 removed from the sibling branch.
    expect(finding.repairStep).not.toMatch(/"\/"|\s\/\s/);
  });

  it("joins the vacuity clause onto the sentence before it", async () => {
    const finding = await run(() => ({
      status: "loaded" as const,
      policy: policy({ allowedPathPrefixes: [], allowedWriteScratchPaths: ["dist/**"] }),
      digest: "d",
    }));

    expect(finding.evidence).toMatch(/policy\. It also grants no usable writable path/);
  });
});
