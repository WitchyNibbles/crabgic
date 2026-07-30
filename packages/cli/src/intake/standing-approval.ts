/**
 * The routine approval path — ledger Gap 18, roadmap/11 §In scope
 * ("Approval, amended 2026-07-28").
 *
 * Routine approval is **standing, over an envelope class**, not per ChangeSet:
 * `crabgic install` writes an `EnvelopePolicy`, and a freshly-built envelope
 * contained in it needs no prompt and no token. Not contained → the run does
 * not silently proceed with less authority and does not half-approve; it stops
 * and the human decides. The decision is a POLICY edit, not a token: the
 * dispatch gate is containment-only (Gap 18 part 2), so `crabgic approve`
 * cannot grant the missing authority — it gates only the plan-consent
 * transition. The escalation the caller renders therefore names the policy
 * file to widen, then re-run.
 *
 * WHY THIS IS THE GATE, and the prompt is not. Gap 18 part 3: "The model can
 * never widen the policy. Creating or extending it is out-of-band." That —
 * not the prompt — is what makes "the model cannot satisfy its own approval
 * gate" true, because the policy is a human-authored artifact no
 * session-reachable surface may write. This module only READS it.
 *
 * Three outcomes, deliberately distinct, because they send the owner to three
 * different places:
 *
 * - `approved` — contained; the ChangeSet is `ready`, and the authorizing
 *   policy digest is journaled so "what was the human standing behind when
 *   this ran" stays answerable after the fact (part 4).
 * - `escalate` — an authority question: no policy, an unreadable one, or an
 *   envelope reaching outside it. A human can resolve this at a terminal.
 * - `not_ready` — a planning question: a requirement no WorkUnit owns. No
 *   approval of any kind fixes it, so it must not be reported as one that
 *   would; `contract.approve` refuses it on exactly the same grounds.
 *
 * Absent or unreadable both DENY (part 6: "unknown or absent means deny,
 * never skip"), and both are named separately because they are different
 * owner problems — one means `install` never ran, the other means a file was
 * edited into a state the schema rejects.
 */
import type {
  AuthorizationEnvelope,
  ChangeSet,
  IntentContract,
  WorkUnit,
} from "@crabgic/contracts";
import { isContained } from "@crabgic/engine-core";
import type { JournalStore } from "@crabgic/journal";
import {
  findUnmappedRequirements,
  transitionChangeSetToReady,
  type Registry,
} from "@crabgic/supervisor";
import type { LoadPolicyResult } from "../policy/policy-store.js";

/**
 * The ChangeSet states that mean "this work was already authorized": `ready`
 * and everything reachable from it. Listed explicitly rather than as
 * "not awaiting_approval", so a state added to the lifecycle later cannot
 * silently join the approved set — an unknown state must deny (Gap 18 part 6).
 */
const APPROVED_STATES: ReadonlySet<ChangeSet["state"]> = new Set([
  "ready",
  "running",
  "verifying",
  "integrating",
  "final_verifying",
  "published_local",
]);

export type StandingApprovalOutcome =
  /** Contained in the standing policy: `ready`, promptless, tokenless. */
  | {
      readonly status: "approved";
      readonly changeSet: ChangeSet;
      readonly policyDigest: string;
      /** True when this call found the ChangeSet already authorized (an idempotent re-run) and journaled nothing new. */
      readonly alreadyApproved?: true;
    }
  /** An authority question a human can answer at a terminal. */
  | { readonly status: "escalate"; readonly reason: string }
  /** A planning question no approval can answer. */
  | { readonly status: "not_ready"; readonly reason: string };

export interface StandingApprovalDeps {
  readonly journal: JournalStore;
  readonly changeSets: Registry<ChangeSet>;
  readonly workUnits: Registry<WorkUnit>;
  /** Read server-side for the requirement set — never taken from a caller, mirroring `./complete-envelope-approval.ts`. */
  readonly intentContracts: Registry<IntentContract>;
  /** Reads the project's standing policy. Injected so tests never touch a real XDG state root. */
  readonly loadPolicy: () => LoadPolicyResult;
}

export async function applyStandingApproval(
  changeSet: ChangeSet,
  envelope: AuthorizationEnvelope,
  deps: StandingApprovalDeps,
): Promise<StandingApprovalOutcome> {
  let loaded: LoadPolicyResult;
  try {
    loaded = deps.loadPolicy();
  } catch (err) {
    // A loader that throws is an unreadable policy, not an absent one, and
    // certainly not an approval: deny and say what happened.
    return {
      status: "escalate",
      reason: `the standing EnvelopePolicy could not be read (${err instanceof Error ? err.message : String(err)})`,
    };
  }

  if (loaded.status === "absent") {
    return {
      status: "escalate",
      reason:
        "this project has no standing EnvelopePolicy, so nothing is approved in advance; " +
        "run `crabgic install` to author one",
    };
  }
  if (loaded.status === "invalid") {
    return {
      status: "escalate",
      reason:
        loaded.transient === true
          ? `${loaded.reason}; treated as no standing approval rather than assuming one`
          : loaded.reason,
    };
  }

  const containment = isContained(envelope, loaded.policy);
  if (!containment.contained) {
    // Every escaping dimension, not the first: the owner has to edit a file
    // out-of-band, so one refusal must describe the whole gap rather than
    // making recovery an iterative guessing game.
    return {
      status: "escalate",
      reason: `this change set needs authority the standing policy does not grant: ${containment.reasons.join("; ")}`,
    };
  }

  // ALREADY AUTHORIZED. Intake is idempotent by design (roadmap/11: "re-
  // inspecting an unchanged repo state is idempotent — no duplicate
  // ChangeSet"), so a second `crabgic run` on the same request replays a
  // ChangeSet that this path already advanced. Found 2026-07-30 by running the
  // built binary twice: the transition below then threw `ready -> ready`
  // straight out of the command — AFTER journaling an authorization for work
  // that was already authorized, leaving a duplicate record behind.
  //
  // The containment check above still runs first, deliberately: if the policy
  // has narrowed since, this reports the escape rather than confirming a grant
  // the policy no longer makes. Only the journal-and-transition half is
  // skipped, because both already happened.
  if (changeSet.state !== "awaiting_approval") {
    return APPROVED_STATES.has(changeSet.state)
      ? { status: "approved", changeSet, policyDigest: loaded.digest, alreadyApproved: true }
      : {
          status: "not_ready",
          reason: `ChangeSet "${changeSet.id}" is ${changeSet.state}, which is not a state an approval can act on`,
        };
  }

  // Readiness is a separate question from authority, and it is checked BEFORE
  // anything is journaled or transitioned: a policy-contained envelope whose
  // DAG leaves a requirement unowned is not approvable by any route.
  const contract = deps.intentContracts.get(changeSet.intentContractId);
  if (contract === undefined) {
    return {
      status: "not_ready",
      reason: `ChangeSet "${changeSet.id}" has no resolvable IntentContract — refusing to approve without its declared requirements`,
    };
  }
  const workUnits = deps.workUnits.list();
  const unmapped = findUnmappedRequirements(contract.requirementIds, workUnits);
  if (unmapped.length > 0) {
    return {
      status: "not_ready",
      reason: `${unmapped.length} requirement(s) have no owning WorkUnit: ${unmapped.join(", ")}`,
    };
  }

  // Part 4. Journaled BEFORE the transition, so a crash between the two leaves
  // evidence that the authority was checked rather than a `ready` ChangeSet
  // nothing accounts for.
  await deps.journal.appendEntry({
    type: "adjudication_decision",
    changeSetId: changeSet.id,
    payload: {
      decision: "policy_contained",
      // BOTH digests. The policy digest answers "what was the human standing
      // behind"; the envelope's own `canonicalHash` answers "what was actually
      // authorized". Recording only the former left the second question
      // reachable only by joining through a mutable `authorizationEnvelopeId`,
      // while the human path binds its token to the envelope digest directly.
      rationale:
        `approval authorized by standing EnvelopePolicy ${loaded.digest} ` +
        `for envelope ${envelope.canonicalHash}`,
    },
  });

  const readyChangeSet = await transitionChangeSetToReady({
    journal: deps.journal,
    changeSets: deps.changeSets,
    changeSetId: changeSet.id,
    requirementIds: contract.requirementIds,
    workUnits,
  });

  return { status: "approved", changeSet: readyChangeSet, policyDigest: loaded.digest };
}
