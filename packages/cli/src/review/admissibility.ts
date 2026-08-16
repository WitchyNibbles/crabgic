import { createHash } from "node:crypto";
import type { ReviewFinding } from "@crabgic/contracts";
import { normalizePlannedPath } from "@crabgic/git-engine";
import { GLOB_METACHARACTER_PATTERN } from "@crabgic/engine-core";

/**
 * Owner ruling R4 (2026-08-15) draws FOUR admissibility bounds —
 * `docs/design/owner-pipeline-conformance.md` §4.3; roadmap/25 work item 6 —
 * and THIS MODULE implements three of them: scope (BOUND 1), obligation
 * (BOUND 2) and identity (BOUND 3). The fourth, monotonicity — a repair may
 * not enlarge the `PlannedWriteSet`, on pain of re-entering the plan stage in
 * the open — is enforced where a repair's write set is decided, not here; a
 * pure admissibility function over one round's findings has no round-over-round
 * write-set history to compare against. Naming it "four bounds" without saying
 * so would leave a reader counting `BOUND` labels in this file one short and
 * assuming a bound this module owns went missing, rather than living
 * elsewhere.
 *
 * THE PROBLEM THIS SOLVES, stated exactly. The owner asked for a loop that ends
 * when the reviewers find no issues, warnings or buts. This repository measured
 * that loop over rounds 21-32: twelve rounds on one subsystem, every finding
 * real and reproducible, zero rounds that found nothing. The conclusion recorded
 * at the time — that a codebase holds an inexhaustible supply of true defects —
 * is half of the story. What was actually unbounded was the SEARCH SPACE:
 *
 *   - the reviewer's charter was "refute the artifact" over a whole subsystem,
 *     with no bound on what was in scope;
 *   - it was never issued an enumerated list of what it owed an answer about;
 *   - and nothing keyed two findings as the same finding, so a re-raising was
 *     indistinguishable from a discovery.
 *
 * Under those conditions "the reviewer found nothing" was not evidence of
 * quality and was never reachable. The bounds below make the space finite,
 * enumerable and non-growing, so a quiet round is a statement about a finite set
 * rather than about a reviewer running out of ideas.
 *
 * NONE OF THIS IS A SEVERITY FLOOR. Severity plays no part anywhere in this
 * module — an advisory finding holds a stage open exactly as a blocking one
 * does, which is what the owner's "no issues, warnings, or buts" says and is the
 * clause the superseded progress-based rule could not honour. What is excluded
 * is out-of-scope and already-answered, never too-minor.
 *
 * WHAT IS NOT PROVED. A repair writes new code inside the write set, and new
 * code carries new obligations. The space is non-increasing per element but not
 * globally, so termination rests on the repair rate exceeding the
 * new-obligation rate — empirical, not proved. The runaway guard exists because
 * of that gap, and `closureVerdict` reports hitting it as `stalled`, never as
 * closed.
 */

/** Why a finding was refused admission. Never empty — a silent refusal is a drop. */
export interface Admissibility {
  readonly admissible: boolean;
  readonly reason: string;
}

const normalizePaths = (paths: readonly string[]): readonly string[] =>
  paths.map(normalizePlannedPath).filter((path) => path.length > 0);

/**
 * A path this module cannot bound, as distinct from one that is out of scope.
 *
 * FOUND BY THE FIRST LIVE REVIEW ROUND (2026-08-15), security and correctness
 * lenses, both with executed reproductions:
 *
 *   - `normalizePlannedPath` deliberately does not resolve `..` — safe for the
 *     overlap analyzer's exact-set membership test, UNSOUND here, where the same
 *     string is used for prefix containment. `packages/cli/src/review/../../etc/passwd`
 *     was admitted as in-scope, which restores the unbounded space this module
 *     exists to bound: any path becomes admissible by spelling it as a child of
 *     a written directory.
 *   - An absolute path loses its leading slash to the same normalizer, becoming
 *     a different path entirely, and was then reported as "pre-existing code" —
 *     a SPELLING problem reported as a scope verdict. The reviewer prompts in
 *     this repository ask for absolute paths, so this was not hypothetical.
 *
 * Both are refused rather than resolved. Resolving would require a repository
 * root to resolve against, which this module does not have and should not
 * acquire: a pure function that reads the filesystem to decide admissibility is
 * a different kind of thing. Refusing with a reason that names the spelling
 * tells the reviewer what to fix, which "out of scope" never did.
 */
function unboundablePath(raw: string): string | undefined {
  if (raw.startsWith("/")) {
    return `the path "${raw}" is absolute; give it relative to the repository root, or it cannot be compared with this change set's write set`;
  }
  if (normalizePlannedPath(raw).split("/").includes("..")) {
    return `the path "${raw}" contains a ".." traversal segment; the write-set comparison is textual, so a traversal cannot be bounded — give the canonical path`;
  }
  if (GLOB_METACHARACTER_PATTERN.test(raw)) {
    /**
     * Added in round 2 after the security lens found glob-bearing paths
     * admitted on the finding side. A pattern names no file: it evades the
     * pathless refusal that exists to stop unscopeable findings, cannot be
     * matched by `selectDebtTouchedBy` if deferred, and every spelling of it
     * mints a distinct identity key — so a reviewer can hold a stage open
     * indefinitely with findings that name no file at all.
     *
     * The metacharacter set is IMPORTED, not restated. This module already
     * shipped a hand-rolled version recognising `*` alone, which is the
     * two-definitions-diverge failure arriving inside a fix.
     */
    return `the path "${raw}" contains a glob metacharacter; a pattern names no file, so it can be neither scoped nor deferred — name the file the problem bites hardest in`;
  }
  return undefined;
}

/**
 * A finding path is in scope if the change set writes it, or writes a directory
 * above it.
 *
 * Directory matching is deliberate: a `PlannedWriteSet` names directories as
 * well as files, and comparing only exact strings would make a whole tree
 * inadmissible — silently shrinking the loop, which is the failure this bound is
 * supposed to prevent rather than cause.
 *
 * The containment is ONE-DIRECTIONAL — only `plannedPath` is treated as a
 * directory a finding can sit under; a `findingPath` that is an ancestor of
 * `plannedPath` does not match. This is not an oversight: only the write set
 * follows the `PlannedWriteSet` directory-naming convention above, and a
 * finding is a reviewer's claim about specific code, which this repository's
 * other bound already requires to name at least one path. Matching the
 * reverse direction too would let a finding naming any shallow ancestor —
 * `packages/`, or the repository root — become in-scope for nearly every
 * change set simply because something is always written somewhere under it,
 * which restores the unbounded search space this bound exists to close by a
 * different route than the one it was built to close.
 */
function touches(findingPath: string, plannedPath: string): boolean {
  if (findingPath === plannedPath) return true;
  return findingPath.startsWith(`${plannedPath}/`);
}

/**
 * BOUND 1 — SCOPE. A finding is admissible only if it concerns a path this
 * change set writes.
 *
 * Code the change set does not touch is pre-existing. It is not dismissed: it
 * goes to the debt index, which reclassifies it `blocking` when that code is
 * next touched (`docs/staged-review-pipeline.md` §7.3). Debt is therefore paid
 * at the cheapest possible moment rather than never.
 *
 * A PATHLESS FINDING IS REFUSED, and this is the trade-off §4.3 discloses rather
 * than an oversight. A finding naming no path cannot be excluded by any scope
 * rule, so admitting it would restore the unbounded space in one move. It is
 * refused here and recorded to the debt index — never dropped — and the residual
 * is that a genuinely cross-cutting finding has to name at least one path to
 * hold this stage open. That is a low bar for a finding that carries an executed
 * reproduction, which every admissible finding must.
 */
export function admissibilityOf(
  finding: ReviewFinding,
  plannedWritePaths: readonly string[],
): Admissibility {
  for (const raw of finding.paths) {
    const refusal = unboundablePath(raw);
    if (refusal !== undefined) return { admissible: false, reason: refusal };
  }

  const findingPaths = normalizePaths(finding.paths);
  if (findingPaths.length === 0) {
    /**
     * CORRECTED after the compliance lens's finding (2026-08-15, blocking).
     *
     * This reason used to say the finding was "recorded as debt". It is not, and
     * cannot be: `ReviewFindingSchema` refuses `accepted-debt` without paths, and
     * `selectDebtTouchedBy` matches on paths, so a pathless finding is
     * unreachable by every debt query. It was merged into the store and retained
     * indefinitely, undispositioned, with the caller told an obligation was being
     * met that no code path fulfilled.
     *
     * Stating the refusal honestly is the fix. A stated obligation nothing
     * fulfils is worse than an honest refusal, because the next reader trusts it.
     */
    return {
      admissible: false,
      reason:
        "the finding names no path, so it can neither be scoped nor deferred: the debt index is keyed by path and cannot hold it. Name at least one path — the file where the problem bites hardest is enough",
    };
  }
  const planned = normalizePaths(plannedWritePaths);
  const inScope = findingPaths.some((findingPath) =>
    planned.some((plannedPath) => touches(findingPath, plannedPath)),
  );
  return inScope
    ? { admissible: true, reason: "the finding concerns a path this change set writes" }
    : {
        admissible: false,
        reason:
          "the finding is outside this change set's planned write set — pre-existing code, recorded as debt and reopened when it is next touched",
      };
}

export interface AdmissibilityPartition {
  readonly admissible: readonly ReviewFinding[];
  /** Refused admission to THIS loop, and owed to the debt index. Never discarded. */
  readonly deferred: readonly ReviewFinding[];
}

/**
 * Partitions, rather than filtering.
 *
 * A function returning only the admissible findings would be shorter and would
 * lose the property that matters: a finding which did not count is visible, with
 * somewhere to go. Same reasoning as `lensesApplicableTo`'s partition — nothing
 * may fall out.
 */
export function partitionByAdmissibility(
  findings: readonly ReviewFinding[],
  plannedWritePaths: readonly string[],
): AdmissibilityPartition {
  const admissible: ReviewFinding[] = [];
  const deferred: ReviewFinding[] = [];
  for (const finding of findings) {
    if (admissibilityOf(finding, plannedWritePaths).admissible) admissible.push(finding);
    else deferred.push(finding);
  }
  return { admissible, deferred };
}

/**
 * BOUND 3 — IDENTITY. `(lens, normalized paths, normalized claim)`.
 *
 * The finding's own `id` is deliberately NOT part of the key. Ids are minted per
 * round, so keying on one would make every re-raising novel — which is the exact
 * mechanism by which twelve rounds each looked productive.
 *
 * The claim is lowercased and its whitespace collapsed before hashing. A
 * reviewer that rephrases is not reporting new information, and without this a
 * reviewer under pressure to produce findings could re-raise the same one
 * indefinitely by rewording it. That pressure is real and documented: the
 * external record calls it verbosity bias, and "always refute" instructions
 * amplify it.
 *
 * Paths are sorted, so the same finding reported with its paths in a different
 * order is the same finding. A NUL separates the FIELDS because it cannot occur
 * in a lens name or a hex digest. Written as the ESCAPE `\u0000` rather than as
 * a raw byte: `check:hygiene` refuses a raw NUL in a tracked text source.
 *
 * CORRECTED 2026-08-15. This comment previously claimed that "no combination of
 * field values can forge another key's preimage". That was false and was
 * disproved by an executed reproduction in the first live review round: the
 * paths field was comma-joined, and a comma is legal in a path. The separator
 * only ever guaranteed cross-FIELD unambiguity; intra-field ambiguity was a
 * separate problem and is now closed by hashing the path list. A false assurance
 * in a file is worse than silence, because the next change set trusts it rather
 * than re-deriving it.
 *
 * The lens is PASSED IN rather than read off the finding: it lives on the
 * `ReviewVerdict` that carries the findings, not on the finding itself. The
 * first version read `finding.lens`; `tsc` rejected it and vitest did not,
 * which is exactly the gap the typecheck job exists to close.
 */
export function findingKey(finding: ReviewFinding, lens: string): string {
  /**
   * The path field is a DIGEST of the canonical path list, not a joined string.
   *
   * Found by the security and correctness lenses in the same round, both with
   * executed reproductions: the list was comma-joined, and a comma is legal in a
   * POSIX path, so one finding naming `"a.ts,b.ts"` produced the same key as a
   * different finding naming `"a.ts"` and `"b.ts"`. An attacker who lands one
   * throwaway comma-spelled finding pre-seeds the key of a genuine multi-path
   * finding, which is then silently non-novel and never counted — the stage can
   * close on a real finding nobody ever answered.
   *
   * Hashing the JSON-encoded array removes the intra-field ambiguity the way the
   * NUL removed the cross-field one. Order stays immaterial because the array is
   * sorted; MULTIPLICITY is immaterial because it is deduplicated first.
   *
   * The dedup was added in round 2, after the correctness lens found that
   * sorting alone left one finding with unboundedly many keys: `['a.ts']`,
   * `['a.ts','./a.ts']` and `['a.ts','a.ts']` normalize to the same path and
   * were three different keys. A reviewer re-raising the same claim with one
   * extra repetition each round is novel every round — the twelve-round
   * non-termination this module exists to bound, reachable by a reviewer that is
   * not even trying to game it.
   */
  const paths = createHash("sha256")
    .update(JSON.stringify([...new Set(normalizePaths(finding.paths))].sort()), "utf8")
    .digest("hex");
  const claim = finding.claim.trim().toLowerCase().replace(/\s+/g, " ");
  const digest = createHash("sha256").update(claim, "utf8").digest("hex");
  return `${lens}\u0000${paths}\u0000${digest}`;
}

/**
 * Findings nobody has raised before, deduplicated within the round too.
 *
 * The within-round dedup matters because a panel runs several lenses at once and
 * two of them can reach the same conclusion. Under the key above that is one
 * finding owing one disposition; counting it twice would inflate the round and,
 * worse, make the loop look busier than it is.
 */
export function novelFindings(
  findings: readonly ReviewFinding[],
  seenKeys: ReadonlySet<string>,
  lens: string,
): readonly ReviewFinding[] {
  const novel: ReviewFinding[] = [];
  const thisRound = new Set<string>();
  for (const finding of findings) {
    const key = findingKey(finding, lens);
    if (seenKeys.has(key) || thisRound.has(key)) continue;
    thisRound.add(key);
    novel.push(finding);
  }
  return novel;
}

/** Sentinel for a lens that was issued no checklist at all. */
export const NO_OBLIGATIONS_ISSUED = "<no obligations were issued to this lens>";

/**
 * BOUND 2 — OBLIGATION. What the lens owed an answer about and did not give one.
 *
 * An EMPTY issued list is reported as unmet rather than satisfied. `[].every(…)`
 * is `true`, so an unchecklisted lens would otherwise prove it had answered
 * everything it owed — and a lens that was never told what it owed has not
 * covered anything. This repository has now paid for that same vacuity at five
 * separate criteria, which is why it is a sentinel and not a comment.
 *
 * An answer naming an obligation that was never ISSUED is dropped rather than
 * flagged. That is safe, not merely silent: this function only ever reports an
 * entry of `issued` that `answered` fails to cover, so a stray answer cannot
 * forge coverage for a real obligation the way an empty issued list could —
 * the two ids would have to collide, and an id that collided would BE the
 * obligation, not a stray one. What an unissued answer can still signal is an
 * id that drifted between the issuing and the answering side; that drift
 * surfaces on its own, as the issued obligation it was meant to cover being
 * reported unrun, so no separate check is owed here.
 */
export function unrunObligations(
  issued: readonly string[],
  answered: readonly string[],
): readonly string[] {
  if (issued.length === 0) return [NO_OBLIGATIONS_ISSUED];
  const done = new Set(answered);
  return issued.filter((obligation) => !done.has(obligation));
}

export interface ClosureInput {
  readonly findings: readonly ReviewFinding[];
  /**
   * The lens this round was reviewed under.
   *
   * Passed in because it lives on the `ReviewVerdict`, not on the finding. Two
   * lenses reaching the same conclusion is corroboration and each owes its own
   * disposition, which is why the lens is part of the identity key at all.
   */
  readonly lens: string;
  readonly seenKeys: ReadonlySet<string>;
  readonly plannedWritePaths: readonly string[];
  readonly obligationsIssued: readonly string[];
  readonly obligationsAnswered: readonly string[];
  readonly round: number;
  readonly runawayGuard: number;
}

export interface ClosureVerdict {
  readonly closed: boolean;
  /** True only when the runaway guard stopped the loop. A stall is not a close. */
  readonly stalled: boolean;
  readonly reason: string;
  readonly novel: readonly ReviewFinding[];
  readonly deferred: readonly ReviewFinding[];
}

/**
 * The owner's exit: a stage closes on a round that produced no admissible novel
 * finding, with every obligation answered and every finding on record
 * dispositioned.
 *
 * ORDER OF CHECKS IS LOAD-BEARING. Obligations are checked BEFORE findings,
 * because a lens that never ran reports nothing and a lens that ran and found
 * nothing also reports nothing. Deciding closure on the findings first would
 * make silence and satisfaction identical — the inert-control failure
 * `docs/deploy-posture.md` exists to surface, applied to review coverage.
 *
 * The undispositioned check is preserved verbatim from the superseded rule and
 * is NOT softened by R4: a stage may not advance holding a finding of any
 * severity that nobody answered. R4 changed what ENDS the loop, not what a
 * finding is owed.
 *
 * The runaway guard is checked last and reports `stalled`, never `closed`. A run
 * that ends there has not converged, and calling it closed would be the
 * syntactic kill-switch the literature warns about, wearing a verdict's clothes.
 * Under ruling R3 the caller takes its declared default and journals it rather
 * than halting for the owner.
 */
/**
 * Why no admissible finding path could ever match this write set.
 *
 * ROUND 2 CORRECTION. The first version of this guard tested EMPTINESS, which
 * the correctness lens showed was the wrong question: an absolute,
 * traversal-bearing or glob write set survives normalization as non-empty
 * garbage, makes every finding inadmissible, and closes the stage — the same
 * vacuous closure, through a different input, with closure once again takeable
 * by the caller.
 *
 * `AuthorizationEnvelope` and `TaskPacket` both type owned paths as bare
 * non-empty strings, and this repository's own fixtures use glob and absolute
 * spellings, so none of these inputs is exotic.
 *
 * Symmetry is the rule: a spelling this module refuses on the FINDING side
 * cannot be trusted on the WRITE-SET side either.
 */
function unmatchableWriteSet(plannedWritePaths: readonly string[]): string | undefined {
  if (plannedWritePaths.length === 0) {
    return "this change set has an empty planned write set, so no finding can be admissible and a quiet round would mean nothing — refusing to close rather than closing vacuously";
  }

  /**
   * EVERY entry must be matchable, not merely one of them.
   *
   * The first version returned as soon as one entry was usable, and the security
   * lens showed what that costs: an actor spelling one owned path literally and
   * the rest as globs keeps arbitrary AUTHORIZED trees permanently out of review
   * scope, with findings about them misfiled as "pre-existing code, recorded as
   * debt" and never reopened for this change set either. The guard stayed
   * silent throughout.
   *
   * This is the same rule the finding side already follows and the same one this
   * function's docblock states: a spelling refused on one side cannot be trusted
   * on the other. Naming the offending entries is what makes it actionable —
   * "your write set is wrong" sends an operator through the whole list.
   */
  const unusable = plannedWritePaths.filter(
    (raw) => unboundablePath(raw) !== undefined || normalizePlannedPath(raw).length === 0,
  );
  if (unusable.length === 0) return undefined;
  return `this change set's planned write set contains ${String(unusable.length)} entr${unusable.length === 1 ? "y" : "ies"} a finding cannot be compared against (${unusable.join(", ")}) — absolute, traversal-bearing and glob spellings cannot be matched textually, so findings about those paths would be silently inadmissible`;
}

export function closureVerdict(input: ClosureInput): ClosureVerdict {
  const { admissible, deferred } = partitionByAdmissibility(
    input.findings,
    input.plannedWritePaths,
  );
  const novel = novelFindings(admissible, input.seenKeys, input.lens);
  const unrun = unrunObligations(input.obligationsIssued, input.obligationsAnswered);

  /**
   * A DEGENERATE WRITE SET CANNOT CLOSE A STAGE.
   *
   * The worst finding of the first live round (correctness lens, blocking, with
   * an executed reproduction). An empty `plannedWritePaths` makes every finding
   * inadmissible, so the scope bound silently degenerates into "nothing can ever
   * hold this stage open" — and production reaches it: the gateway passes
   * `envelope?.ownedPaths ?? []`, so a round with no authorization envelope
   * closed vacuously while holding an undispositioned BLOCKING finding.
   *
   * This is the exact failure the module exists to prevent, arriving through its
   * own front door, and it is what ledger Gap 19's warning names: "a caller that
   * widens them to make a round quiet has removed the only thing making a quiet
   * round mean anything". An empty write set is the widest possible widening.
   */
  const unmatchable = unmatchableWriteSet(input.plannedWritePaths);
  if (unmatchable !== undefined) {
    return { novel, deferred: input.findings, closed: false, stalled: false, reason: unmatchable };
  }

  /**
   * Scoped to ADMISSIBLE findings, and the scoping is load-bearing.
   *
   * Requiring a disposition from every finding on record — deferred ones
   * included — would let an out-of-scope finding hold this stage open, which
   * defeats the scope bound completely: the loop would be unbounded again by a
   * different route. A deferred finding is owed a disposition by the DEBT
   * INDEX, at the change set that next touches its code, not by this stage.
   *
   * (Found by the test that asserts an out-of-scope finding does not block
   * closure. The first version of this function checked `input.findings`.)
   */
  const undispositioned = admissible.filter((finding) => finding.disposition === undefined);
  const base = { novel, deferred } as const;

  const blockers: string[] = [];
  if (unrun.length > 0) blockers.push(`an obligation went unanswered: ${unrun.join(", ")}`);
  if (undispositioned.length > 0) {
    blockers.push(
      `${String(undispositioned.length)} admissible finding(s) have no disposition, and a stage may not advance holding one at any severity`,
    );
  }
  if (novel.length > 0) {
    blockers.push(`${String(novel.length)} admissible novel finding(s) this round`);
  }

  if (blockers.length === 0) {
    return {
      ...base,
      closed: true,
      stalled: false,
      reason: "every obligation answered and no admissible novel finding this round",
    };
  }

  /**
   * The guard is checked once the stage is known not to close, so it fires for
   * ANY non-closing reason rather than only for novel findings. A loop sitting
   * at the guard with an unanswered obligation has stalled just as surely as
   * one still producing findings, and reporting only the latter would hide the
   * more alarming case.
   */
  if (input.round >= input.runawayGuard) {
    return {
      ...base,
      closed: false,
      stalled: true,
      reason: `the runaway guard stopped this loop at round ${String(input.round)}; it did not converge, and these stand: ${blockers.join("; ")}`,
    };
  }

  return { ...base, closed: false, stalled: false, reason: blockers.join("; ") };
}
