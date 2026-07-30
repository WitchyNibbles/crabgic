import { isUsablePathPrefix, isVacuousPolicy, type EnvelopePolicy } from "@crabgic/contracts";
import type { DoctorCheck, DoctorFinding } from "../framework.js";
import { loadEnvelopePolicy } from "../../policy/policy-store.js";

/**
 * `policy.standing` — the standing `EnvelopePolicy`'s health check (ledger
 * Gap 18's disclosed mitigations).
 *
 * WHY THIS IS AN ERROR AND NOT A WARNING. Under a standing approval this file
 * is the only thing standing between an owner and a run they never reviewed,
 * and every failure mode below stops the product working entirely: with no
 * policy, an invalid policy, or a vacuous one, every dispatch is refused.
 * A warning would be describing a broken installation as a nit.
 *
 * VACUITY IS THE FINDING THAT MATTERS. Roast round 1 (F9) established that an
 * all-empty policy passes every *structural* check that can be made of it —
 * it exists, it parses, it is `0600`, it is untracked — while refusing every
 * dispatch. An owner would see a green install, a green doctor, and a product
 * that silently never runs. So this check asserts the policy GRANTS
 * something, not merely that it is well-formed.
 *
 * It also renders what the policy grants, because Gap 18's residual-risk
 * disclosure turns on the owner being able to read the standing grant they
 * are living under. A gate nobody can inspect is a gate nobody can narrow.
 */
export interface StandingPolicyCheckOptions {
  /** Absolute path to the project's policy (`resolveEnvelopePolicyPath` in real usage). */
  readonly path: string;
  /** Seam so tests need no real file. Defaults to the real loader. */
  readonly load?: typeof loadEnvelopePolicy;
}

const CHECK_ID = "policy.standing";

export function buildStandingPolicyCheck(options: StandingPolicyCheckOptions): DoctorCheck {
  const load = options.load ?? loadEnvelopePolicy;

  return {
    id: CHECK_ID,
    severity: "error",
    run(): Promise<DoctorFinding> {
      const loaded = load(options.path);

      if (loaded.status === "absent") {
        return Promise.resolve({
          id: CHECK_ID,
          severity: "error",
          passed: false,
          evidence: `no standing authorization policy at ${options.path}; every run will be refused until one exists`,
          repairStep:
            "run `crabgic install` and accept the policy it renders (it is written outside the repository, and nothing Crabgic runs can change it)",
        });
      }

      if (loaded.status === "invalid") {
        return Promise.resolve({
          id: CHECK_ID,
          severity: "error",
          passed: false,
          evidence: loaded.reason,
          // The remedy has to agree with the evidence. A transient failure
          // means the FILE is fine, and telling the owner to re-run `install`
          // would rename a machine-derived policy over their hand-tuned one
          // because a descriptor table filled up (round 9).
          repairStep:
            loaded.transient === true
              ? `retry once this process has descriptors available, or raise the open-file limit; do NOT re-run \`crabgic install\`, which would replace ${options.path}`
              : `edit ${options.path} by hand to correct it, or re-run \`crabgic install\` to author a fresh one`,
        });
      }

      // Round 9: `allowedWriteScratchPaths` passes through no usability
      // filter, so `dist/**` renders as granted, keeps the policy
      // non-vacuous, passes every check -- and is silently dropped by
      // `narrowedAllowWrite`, leaving the worker's build denied at runtime
      // with nothing pointing at the policy. This is round 3's F3 in the
      // sibling field: the fix was applied to path prefixes and never carried
      // across.
      // BOTH list fields, not just scratch. Round 11: the round-9 fix was
      // applied to `allowedWriteScratchPaths` and never carried to
      // `allowedPathPrefixes`, so `["src", "dist/**"]` PASSED -- the evidence
      // rendered "grants paths [src, dist/**]" -- while `isContained` refused
      // every dispatch for ever with `policy path prefix "dist/**" ... grants
      // nothing`. `isVacuousPolicy` needs only ONE usable prefix, so a mixed
      // list slips through it. This is round 3's F3 in its third field, and
      // it was reachable through the very remedy this check prints.
      const unusable = [
        ...loaded.policy.allowedPathPrefixes
          .filter((entry) => !isUsablePathPrefix(entry))
          .map((entry) => ({ field: "allowedPathPrefixes", entry })),
        ...loaded.policy.allowedWriteScratchPaths
          .filter((entry) => !isUsablePathPrefix(entry))
          .map((entry) => ({ field: "allowedWriteScratchPaths", entry })),
      ];
      if (unusable.length > 0) {
        // Round 12: reporting ONE problem at a time cost the owner a round
        // trip. `{prefixes: [], scratch: ["dist/**"]}` reported only the
        // glob, so they fixed it, re-ran, and only then learned the policy
        // grants nothing at all. Every problem the check can see is named at
        // once, and the consequence is stated per FIELD rather than as a
        // disjunction -- an unusable prefix refuses every run, an unusable
        // scratch entry denies a build, and saying "or" for both was less
        // precise than the field-specific wording it replaced.
        // `length === 0`, NOT `isVacuousPolicy`. Round 13 measured the
        // difference: `isVacuousPolicy` asks whether the policy grants
        // anything AS IT STANDS, but the sentence below is a claim about the
        // policy AFTER the repair it prints. For `allowedPathPrefixes:
        // ["src/**"]` the policy is vacuous today AND fixing that one entry
        // is exactly what makes it work -- so the claim "fixing these entries
        // alone will not make it work" was false in 3066 of 3132 executed
        // cases. The repairStep half was worse than wrong: under a standing
        // approval it told the owner to add a directory they do not need,
        // widening a grant nobody reviews.
        //
        // An EMPTY prefix list is the only shape where there is genuinely
        // nothing to repair into a prefix -- the round-12 case this clause
        // was added for.
        const nothingToRepairInto = loaded.policy.allowedPathPrefixes.length === 0;
        const byField = unusable
          .map(({ field, entry }) => `${field} ${JSON.stringify(entry)}`)
          .join(", ");
        // Both consequences when both fields are affected. Picking one by
        // `some()` named the prefix consequence and silently dropped the
        // scratch one, which is incomplete rather than false — but a finding
        // that lists two broken entries and explains one of them invites the
        // owner to fix only what was explained.
        const hasBadPrefix = unusable.some((u) => u.field === "allowedPathPrefixes");
        const hasBadScratch = unusable.some((u) => u.field === "allowedWriteScratchPaths");
        const consequence = [
          ...(hasBadPrefix ? ["an unusable path prefix refuses every run"] : []),
          ...(hasBadScratch
            ? ["an unusable build-output path lets the build be denied at runtime"]
            : []),
        ].join(", and ");

        return Promise.resolve({
          id: CHECK_ID,
          severity: "error",
          passed: false,
          evidence:
            `the standing policy at ${options.path} lists paths that cannot grant anything: ` +
            `${byField}. They are shown as granted but match nothing, so ${consequence} ` +
            "with nothing pointing back at the policy." +
            (nothingToRepairInto
              ? " It also grants no usable writable path at all, so fixing these entries alone will not make it work."
              : ""),
          repairStep:
            `replace them with literal directory names in ${options.path} (no globs, no leading slash)` +
            (nothingToRepairInto ? ", and add at least one directory work may touch" : ""),
        });
      }

      if (isVacuousPolicy(loaded.policy)) {
        return Promise.resolve({
          id: CHECK_ID,
          severity: "error",
          passed: false,
          evidence: `the standing policy at ${options.path} grants no writable paths, so every run will be refused (it is well-formed, which is why nothing else reports it)`,
          repairStep: `add the directories work may touch to \`allowedPathPrefixes\` in ${options.path}`,
        });
      }

      // The turn-budget sibling of the vacuous case (same F9 shape: a green
      // doctor on an installation where every dispatch is refused). Every
      // envelope requests a positive turn budget, so a ceiling of 0 —
      // including every policy authored before the dimension existed, which
      // parses to the fail-closed default — escalates 100% of dispatches
      // while passing every structural check. That fail-closed parse is the
      // DESIGNED upgrade behavior; the doctor's job is to be the thing that
      // says so before the first refusal does.
      if (loaded.policy.maxWorkerTurnsPerAttempt === 0) {
        return Promise.resolve({
          id: CHECK_ID,
          severity: "error",
          passed: false,
          evidence:
            `the standing policy at ${options.path} grants zero worker turns per attempt, so every ` +
            "dispatch will be refused (a policy written before this dimension existed parses this " +
            "way deliberately — an absent authority axis fails closed)",
          repairStep: `set \`maxWorkerTurnsPerAttempt\` in ${options.path} (40 matches the previous built-in cap)`,
        });
      }

      return Promise.resolve({
        id: CHECK_ID,
        severity: "error",
        passed: true,
        evidence: renderGrant(loaded.policy, loaded.digest),
      });
    },
  };
}

/** One line, but a complete one: an owner who cannot see the standing grant cannot narrow it. */
function renderGrant(policy: EnvelopePolicy, digest: string): string {
  const or = (values: readonly string[]): string =>
    values.length === 0 ? "none" : values.join(", ");
  return (
    `standing policy ${digest} grants ` +
    `paths [${or(policy.allowedPathPrefixes)}]; ` +
    `scratch [${or(policy.allowedWriteScratchPaths)}]; ` +
    `commands [${or(policy.allowedCommands)}]; ` +
    `network [${or(policy.allowedNetworkDestinations)}]; ` +
    `credentials [${or(policy.allowedCredentialReferences)}]; ` +
    `remote resources [${or(policy.allowedRemoteResourceReferences)}]; ` +
    `unix sockets ${policy.allowUnixSockets ? "allowed" : "denied"}; ` +
    `worker turns per attempt ≤ ${String(policy.maxWorkerTurnsPerAttempt)}`
  );
}
