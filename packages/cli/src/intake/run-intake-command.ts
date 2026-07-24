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
 * it itself (see `@eo/supervisor`'s `contract-builder.ts` for the identical
 * scope note on the deterministic-assembly/live-drafting boundary).
 */
import type { AuthorizationEnvelope, ChangeSet, WorkUnit } from "@eo/contracts";
import type { JournalStore } from "@eo/journal";
import { runIntake, type IntakeOutcome, type IntakeRequest, type Registry } from "@eo/supervisor";
import {
  runApprovalFlow,
  ApprovalDeclinedError,
  type ApprovalPromptIo,
} from "../approval/prompt.js";
import type { ApprovalTokenMinter, MintedApprovalToken } from "../approval/token.js";

export interface RunIntakeCommandDeps {
  readonly journal: JournalStore;
  readonly changeSets: Registry<ChangeSet>;
  readonly workUnits: Registry<WorkUnit>;
  /** CRITICAL C1 repair: durable envelope store `runIntake` persists the built envelope into — required so `contract.approve` can later derive the expected digest server-side. */
  readonly envelopes: Registry<AuthorizationEnvelope>;
  readonly minter: ApprovalTokenMinter;
  readonly io: ApprovalPromptIo;
  /** Resolves the drafted intake request content (e.g. a manager-session-authored JSON file) — this module never drafts it itself. */
  readonly readIntakeRequest: () => Promise<IntakeRequest>;
}

export interface RunIntakeCommandResult {
  readonly outcome: IntakeOutcome;
  /** Present only when the human confirmed the terminal approval prompt. */
  readonly approvalToken?: MintedApprovalToken;
  /** True when the human explicitly declined the approval prompt (never a token minted). */
  readonly declined?: true;
}

/**
 * Runs intake, then — if a `ChangeSet` was created or already exists
 * awaiting approval (i.e. not a `conflict` outcome) — renders the terminal
 * approval prompt for its envelope's canonical hash and mints a token on
 * explicit "yes" (via `runApprovalFlow`, 09's own sole mint-reachable
 * path). A `conflict` outcome never reaches the approval prompt at all —
 * the caller must resolve the requestKey collision first (see
 * `@eo/supervisor`'s `runIntake` doc comment).
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
    },
    request,
  );

  if (outcome.status === "conflict") {
    return { outcome };
  }

  try {
    const approvalToken = await runApprovalFlow(
      deps.minter,
      "envelope_hash",
      outcome.artifacts.envelope.canonicalHash,
      deps.io,
    );
    return { outcome, approvalToken };
  } catch (err) {
    if (err instanceof ApprovalDeclinedError) {
      return { outcome, declined: true };
    }
    throw err;
  }
}
