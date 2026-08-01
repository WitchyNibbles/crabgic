/**
 * Amendment flow — roadmap/11-intake-contract-approval.md §In scope,
 * "Approval" bullet: "Amendments create new envelope versions requiring
 * delta re-approval." §Interfaces produced item 8: "a material change to an
 * approved envelope produces a new, distinctly-hashed `AuthorizationEnvelope`
 * version and invalidates the prior approval token; a fresh mint/verify
 * cycle is required before any dispatch against the amended plan." §Work
 * item 5's failing-first framing: "approve, amend, then replay the OLD
 * token -- must fail."
 *
 * TOKEN INVALIDATION MECHANISM (documented — no extra bookkeeping needed):
 * `./envelope-builder.ts`'s `canonicalHash` is a pure function of the
 * envelope's CONTENT. 09's `ApprovalTokenMinter` binds a minted token to
 * exactly one digest string. Once this module produces a new envelope
 * whose content differs (hence a new `canonicalHash`), the OLD token —
 * minted against the OLD hash — can never verify against the NEW hash: the
 * signature-verified payload's own `digest` field simply won't match
 * whatever digest a caller passes as `expected.digest` for the amended
 * plan (`ApprovalTokenMismatchError`). This module therefore does not need
 * to track "the currently valid envelope hash" as separate state to make
 * the old-token-replay fixture fail — the hash mismatch alone is
 * sufficient and is exercised end-to-end in
 * `packages/cli/src/approval/durable-approval-ledger.test.ts`'s own
 * amendment fixture.
 *
 * This module's own job is narrower: build the new envelope version,
 * persist it into `../registries/authorization-envelopes-registry.ts`
 * (CRITICAL C1 repair — durable, so `contract.approve` can derive the
 * expected digest server-side from the ChangeSet it is actually asked to
 * flip, rather than trusting a caller-supplied digest), keep the owning
 * `ChangeSet`'s `authorizationEnvelopeId` cross-reference pointed at it
 * (immutable-replace — never a mutation in place), and journal a durable
 * `adjudication_decision` record of the amendment for audit (no dedicated
 * `JournalEntryType` exists for "envelope amended" specifically;
 * `adjudication_decision`'s free-text `decision`/`rationale` fields are
 * this package's own minimal-sufficient carrier, matching `./stop-
 * conditions.ts`'s identical reuse).
 *
 * MEDIUM M4 repair (adversarial-validation finding): an amendment against
 * an ALREADY-APPROVED `ChangeSet` (`ready` or any in-flight stage) must
 * never leave it pointing at the new, un-approved envelope while still
 * reporting the OLD approved state — a downstream consumer keying on
 * `state === "ready"` must never run against an escalated, never-approved
 * envelope. This module therefore demotes the `ChangeSet`'s own `state` as
 * part of the SAME amendment call, via the existing, unmodified
 * `./change-set-transition.js` (never a new state-machine state — 02's
 * enum is unchanged): `ready` demotes to `cancelled` (the ONLY legal edge
 * out of `ready` in 02's fixed transition table — `ready: ["running",
 * "cancelled"]` has no `-> awaiting_approval` or `-> blocked` edge, so
 * `cancelled` is the sole fail-closed option); every in-flight stage
 * (`running`/`verifying`/`integrating`/`final_verifying`) demotes to
 * `blocked` (mirrors `./stop-conditions.ts`'s own halt semantics — an
 * amendment mid-run is effectively a `material_amendment` stop condition).
 * `draft`/`awaiting_approval` need no demotion (still unapproved). An
 * already-ABSORBING (terminal) `ChangeSet` — `failed`/`blocked`/
 * `cancelled`/`published_local` — refuses the amendment outright
 * (`ChangeSetAlreadyTerminalError`) rather than silently repointing a dead
 * ChangeSet's envelope to something nobody will ever approve.
 */
import {
  isRunLifecycleAbsorbing,
  type AuthorizationEnvelope,
  type ChangeSet,
  type RunLifecycleState,
} from "@crabgic/contracts";
import type { JournalStore } from "@crabgic/journal";
import type { Registry } from "../registries/registry.js";
import { transitionChangeSet } from "./change-set-transition.js";
import {
  buildAuthorizationEnvelope,
  hashEnvelopeContent,
  type AuthorizationEnvelopeContent,
} from "./envelope-builder.js";

export class ChangeSetNotFoundForAmendmentError extends Error {
  constructor(changeSetId: string) {
    super(`intake: no ChangeSet found for id "${changeSetId}" — cannot amend its envelope`);
    this.name = "ChangeSetNotFoundForAmendmentError";
  }
}

/** MEDIUM M4: thrown when an amendment targets a ChangeSet already in one of the 4 absorbing (terminal) states — amending a dead ChangeSet's envelope would never be approved by anyone. */
export class ChangeSetAlreadyTerminalError extends Error {
  constructor(changeSetId: string, state: RunLifecycleState) {
    super(
      `intake: ChangeSet "${changeSetId}" is already terminal ("${state}") — refusing to amend its envelope`,
    );
    this.name = "ChangeSetAlreadyTerminalError";
  }
}

export interface AmendEnvelopeOptions {
  readonly journal: JournalStore;
  readonly changeSets: Registry<ChangeSet>;
  /** CRITICAL C1 repair: durable envelope store the new version is persisted into. */
  readonly envelopes: Registry<AuthorizationEnvelope>;
  readonly changeSetId: string;
  readonly newEnvelopeId: string;
  readonly createdAt: string;
  readonly content: AuthorizationEnvelopeContent;
  readonly reason: string;
}

export interface AmendEnvelopeResult {
  readonly envelope: ReturnType<typeof buildAuthorizationEnvelope>;
  readonly changeSet: ChangeSet;
  /**
   * Whether the new content actually differs from the envelope this ChangeSet
   * currently points at. Informational: this module builds and swaps in the new
   * envelope id either way, and the DEMOTION below is deliberately
   * unconditional — an amendment against an approved-looking state demotes
   * whether or not the content moved, because that is the fail-closed choice
   * and narrowing it is a security decision, not a reporting fix.
   *
   * `true` when the previous envelope cannot be resolved: "cannot tell" must
   * never be reported as "nothing changed".
   */
  readonly materialChange: boolean;
}

/** States that already reflect a completed human approval — an amendment against any of these must demote, never silently keep, that approved-looking state (MEDIUM M4). */
const DEMOTE_TO_CANCELLED: ReadonlySet<RunLifecycleState> = new Set(["ready"]);
const DEMOTE_TO_BLOCKED: ReadonlySet<RunLifecycleState> = new Set([
  "running",
  "verifying",
  "integrating",
  "final_verifying",
]);

export async function amendEnvelope(options: AmendEnvelopeOptions): Promise<AmendEnvelopeResult> {
  const current = options.changeSets.get(options.changeSetId);
  if (current === undefined) {
    throw new ChangeSetNotFoundForAmendmentError(options.changeSetId);
  }
  if (isRunLifecycleAbsorbing(current.state)) {
    throw new ChangeSetAlreadyTerminalError(options.changeSetId, current.state);
  }

  const envelope = buildAuthorizationEnvelope({
    id: options.newEnvelopeId,
    changeSetId: options.changeSetId,
    createdAt: options.createdAt,
    content: options.content,
  });

  // Answered BEFORE the new envelope replaces the old reference, which is the
  // only moment the previous hash is still reachable. This used to be the
  // literal `true`, so the one question the field exists to answer — did the
  // content actually move? — was answered "yes" for a caller re-submitting
  // byte-identical content, with `isMaterialEnvelopeChange` exported right
  // below and never consulted. An unresolvable previous envelope reports
  // `true`: "cannot tell" must never render as "nothing changed".
  const previous = options.envelopes.get(current.authorizationEnvelopeId);
  const materialChange =
    previous === undefined || isMaterialEnvelopeChange(previous.canonicalHash, options.content);

  options.envelopes.put(envelope);

  await options.journal.appendEntry({
    type: "adjudication_decision",
    changeSetId: options.changeSetId,
    payload: {
      decision: "amended",
      rationale: `envelope amended (new hash ${envelope.canonicalHash}): ${options.reason}`,
      subjectId: options.changeSetId,
    },
  });

  // Repoint the envelope reference FIRST — `transitionChangeSet` re-fetches
  // the current record from the registry, so the demotion below (if any)
  // preserves this already-repointed `authorizationEnvelopeId`.
  const repointed: ChangeSet = { ...current, authorizationEnvelopeId: envelope.id };
  options.changeSets.put(repointed);

  let finalChangeSet = repointed;
  if (DEMOTE_TO_CANCELLED.has(current.state)) {
    finalChangeSet = await transitionChangeSet({
      journal: options.journal,
      changeSets: options.changeSets,
      changeSetId: options.changeSetId,
      to: "cancelled",
    });
  } else if (DEMOTE_TO_BLOCKED.has(current.state)) {
    finalChangeSet = await transitionChangeSet({
      journal: options.journal,
      changeSets: options.changeSets,
      changeSetId: options.changeSetId,
      to: "blocked",
    });
  }

  return {
    envelope,
    changeSet: finalChangeSet,
    materialChange,
  };
}

/** Pure helper: true when `candidate`'s content hash differs from `previousHash` — usable by a caller deciding whether an edit is material BEFORE calling `amendEnvelope` at all. */
export function isMaterialEnvelopeChange(
  previousHash: string,
  candidate: AuthorizationEnvelopeContent,
): boolean {
  return hashEnvelopeContent(candidate) !== previousHash;
}
