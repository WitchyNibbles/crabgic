import { isVacuousPolicy, type EnvelopePolicy } from "@crabgic/contracts";
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
          repairStep: `edit ${options.path} by hand to correct it, or re-run \`crabgic install\` to author a fresh one`,
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
    `unix sockets ${policy.allowUnixSockets ? "allowed" : "denied"}`
  );
}
