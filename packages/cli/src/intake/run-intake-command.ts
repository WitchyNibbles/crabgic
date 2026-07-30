/**
 * `run` command's pre-dispatch intake -> contract -> approval sequence —
 * roadmap/11-intake-contract-approval.md §Interfaces consumed, 09: "`run`
 * CLI command surface + typed UDS client — 11 implements the pre-dispatch
 * intake -> contract -> approval sequence that `run` invokes before handing
 * an approved `ChangeSet` to 13."
 *
 * SCOPE NOTE (documented deviation — see `docs/evidence/phase-11/`): this
 * module implements the full sequence as a directly-callable, fully-tested
 * orchestration function. It is deliberately NOT wired into `../argv/
 * types.ts`'s `RunCommand`/`../argv/parse-command.ts` with a new
 * request-payload flag — that would touch 09's own pre-existing argv
 * surface (and its own committed tests) for a request shape this phase's
 * source material never pins the argv encoding of. `../commands/
 * dispatch.ts`'s `run` case is wired to call this function whenever
 * `CliDependencies.intake` is supplied (mirroring the exact optional-
 * dependency pattern roadmap/10's `install`/`upgrade`/`uninstall` cases
 * already use for `deps.installer`) — real production wiring is
 * `../bootstrap.ts`'s job, out of this phase's own file-touch boundary.
 *
 * The drafted `IntentContract` narrative/requirement/work-unit content
 * itself (the manager-session `eo-explore`/`eo-reviewer` output) is
 * supplied via the injected `readIntakeRequest` — this module never drafts
 * it itself (see `@crabgic/supervisor`'s `contract-builder.ts` for the identical
 * scope note on the deterministic-assembly/live-drafting boundary).
 */
import type {
  AuthorizationEnvelope,
  ChangeSet,
  IntentContract,
  WorkUnit,
} from "@crabgic/contracts";
import type { JournalStore } from "@crabgic/journal";
import {
  runIntake,
  type IntakeOutcome,
  type IntakeRequest,
  type Registry,
} from "@crabgic/supervisor";
import type { LoadPolicyResult } from "../policy/policy-store.js";
import { applyStandingApproval, type StandingApprovalOutcome } from "./standing-approval.js";

export interface RunIntakeCommandDeps {
  readonly journal: JournalStore;
  readonly changeSets: Registry<ChangeSet>;
  readonly workUnits: Registry<WorkUnit>;
  /** CRITICAL C1 repair: durable envelope store `runIntake` persists the built envelope into — required so `contract.approve` can later derive the expected digest server-side. */
  readonly envelopes: Registry<AuthorizationEnvelope>;
  /** Durable contract store, for the same cross-process reason as `envelopes`: `contract.approve` resolves this ChangeSet's declared `requirementIds` from here to run its unmapped-requirement readiness gate. */
  readonly intentContracts: Registry<IntentContract>;
  /** Resolves the drafted intake request content (e.g. a manager-session-authored JSON file) — this module never drafts it itself. */
  readonly readIntakeRequest: () => Promise<IntakeRequest>;
  /**
   * Reads the project's standing `EnvelopePolicy` (ledger Gap 18) — REQUIRED,
   * because it is the approval decision. It was optional, defaulting to "prompt
   * for everything", which meant a caller that forgot it silently got the
   * pre-Gap-18 behaviour instead of an error.
   */
  readonly loadPolicy: () => LoadPolicyResult;
}

export interface RunIntakeCommandResult {
  readonly outcome: IntakeOutcome;
  /**
   * The standing-policy decision (ledger Gap 18). Absent only for a
   * `conflict`, which is resolved before authority is even considered.
   *
   * No token appears anywhere in this result, by construction: this function
   * does not mint one. `run --json` used to print the token it minted — the
   * model-as-courier exposure Gap 18's audit recorded — and now there is
   * nothing to print because there is nothing to spend.
   */
  readonly standing?: StandingApprovalOutcome;
}

/**
 * Runs intake, then lets the standing policy decide (ledger Gap 18). A
 * `conflict` outcome returns before any approval is considered — the caller
 * must resolve the requestKey collision first (see `@crabgic/supervisor`'s
 * `runIntake` doc comment).
 *
 * THIS FUNCTION NEVER PROMPTS, AND NEVER MINTS (2026-07-30). It used to render
 * an approval prompt whenever the standing policy declined to decide, and
 * adversarial review showed that path was broken in three ways at once: in the
 * primary invocation form, `crabgic run < intake.json`, the request read has
 * already drained stdin, so the prompt hit an ended stream and auto-declined —
 * it could never be answered; it rendered only a bare envelope digest, the
 * exact "no envelope content whatsoever" failure the standing design exists to
 * end; and a human who did answer it got a token spent, a `ready` ChangeSet,
 * and no dispatch, reported at exit 0.
 *
 * For an AUTHORITY escalation the remedy is the standing policy, not a token:
 * the daemon's dispatch gate is containment-only and reads no token
 * (`docs/interface-ledger.md` Gap 18 part 2), so `crabgic approve` — which
 * gates only the `awaiting_approval → ready` transition, i.e. consent to the
 * plan — cannot grant missing authority. The escalation message therefore
 * names the policy file to edit, and this module leaves the ChangeSet
 * `awaiting_approval` for a re-run once the policy grants the authority.
 */
export async function runIntakeCommand(
  deps: RunIntakeCommandDeps,
): Promise<RunIntakeCommandResult> {
  const request = await deps.readIntakeRequest();
  const outcome = await runIntake(
    {
      journal: deps.journal,
      changeSets: deps.changeSets,
      workUnits: deps.workUnits,
      envelopes: deps.envelopes,
      intentContracts: deps.intentContracts,
    },
    request,
  );

  if (outcome.status === "conflict") {
    return { outcome };
  }

  // THE APPROVAL DECISION (ledger Gap 18). Contained in the standing policy →
  // the ChangeSet is ready and nobody was asked. Anything else stops here and
  // is reported, naming the policy file to widen — the dispatch gate is
  // containment-only, so editing the policy (not `crabgic approve`) is the
  // remedy for an authority escalation.
  const standing = await applyStandingApproval(
    outcome.artifacts.changeSet,
    outcome.artifacts.envelope,
    {
      journal: deps.journal,
      changeSets: deps.changeSets,
      workUnits: deps.workUnits,
      intentContracts: deps.intentContracts,
      loadPolicy: deps.loadPolicy,
    },
  );
  return { outcome, standing };
}
