/**
 * `project.inspect` aggregator — roadmap/11-intake-contract-approval.md §In
 * scope: "read-only repo/stack/connection summary — 07 freeze when a
 * control clone exists, 12 detection when available; graceful degradation
 * before 12 (and before any freeze exists) ... Also answers ChangeSet-state
 * queries; no separate change-set-family tool family exists" (this doc
 * comment deliberately avoids spelling the underscore-dotted literal this
 * package's own Gap 1 conformance scanner bans — see
 * `../router/no-change-set-operation.test.ts`'s identical convention). §Work item 1's
 * failing-first framing: "empty-journal fixture (fresh repo, no 07/12 data
 * yet) returns a valid partial report, not an error."
 *
 * `07`'s freeze data is journal-persisted (`git_freeze` entries, read
 * directly here — no dependency on `packages/git-engine`, whose own module
 * only WRITES that entry type). `12`'s `StackEvidence` is NOT itself
 * journaled anywhere in this system (`StackEvidence` has no
 * `JournalEntryType` member of its own — see `@eo/contracts`'s
 * `journal-entry-type.ts`, a closed 13-member union with no such member);
 * this aggregator therefore accepts an OPTIONAL `stackEvidenceProvider`
 * dependency the caller supplies (e.g. `packages/cli`'s orchestration layer
 * invoking `packages/detect`'s `buildStackEvidence` directly — this
 * package, `@eo/supervisor`, never depends on `packages/detect`, see
 * `./capability-manifest-builder.ts`'s own doc comment for why) — an
 * absent/undefined provider, or one that itself resolves `undefined`
 * (pre-12, nothing detected yet), degrades gracefully rather than erroring.
 * ChangeSet-state queries read directly from the in-process
 * `ChangeSetsRegistry` (Gap 1: this is the ONLY ChangeSet-state read
 * surface in the whole system — no dedicated wire tool).
 */
import type { ChangeSet, StackEvidence } from "@eo/contracts";
import type { JournalStore } from "@eo/journal";
import type { Registry } from "../registries/registry.js";

export interface FreezeSummary {
  readonly scopePath: string;
  readonly reason: string;
  readonly frozenAt: string;
}

export interface ProjectInspectQuery {
  /** When supplied, restricts the ChangeSet-state portion of the report to this one id. Omit to list every known ChangeSet. */
  readonly changeSetId?: string;
}

export interface ProjectInspectDeps {
  readonly journal: Pick<JournalStore, "queryEntries">;
  /** Read-only — `project.inspect` never writes; deliberately narrower than the full `Registry<ChangeSet>` so a caller can satisfy this with a read-only UDS-backed adapter (`registry.changeSets.get`/`.list`) with no `put`/`query` to accidentally expose. */
  readonly changeSets: Pick<Registry<ChangeSet>, "get" | "list">;
  /** Reads (or produces) the current `StackEvidence`, if any is available. Optional — omitted entirely before 12 exists in the caller's wiring. */
  readonly stackEvidenceProvider?: () => Promise<StackEvidence | undefined>;
}

export interface ProjectInspectReport {
  readonly freeze?: FreezeSummary;
  readonly stackEvidence?: StackEvidence;
  readonly changeSets: readonly ChangeSet[];
  /** Human-readable notes on which sections degraded gracefully (no data available yet) — never a thrown error for these cases. */
  readonly degraded: readonly string[];
}

/** Reads every `git_freeze` entry and returns the most recently timestamped one — the CURRENT freeze state (a later freeze entry always supersedes an earlier one; there is no explicit "unfreeze" entry type in this system). */
async function readLatestFreeze(
  journal: Pick<JournalStore, "queryEntries">,
): Promise<FreezeSummary | undefined> {
  let latest: FreezeSummary | undefined;
  for await (const entry of journal.queryEntries({ type: "git_freeze" })) {
    if (entry.type !== "git_freeze") continue;
    if (latest === undefined || entry.timestamp > latest.frozenAt) {
      latest = {
        scopePath: entry.payload.scopePath,
        reason: entry.payload.reason,
        frozenAt: entry.timestamp,
      };
    }
  }
  return latest;
}

/** Runs the aggregator. Never throws for a fresh/empty journal or an absent 12 provider — returns a valid partial report with `degraded` notes instead (roadmap/11 work item 1's failing-first framing). */
export async function runProjectInspect(
  deps: ProjectInspectDeps,
  query: ProjectInspectQuery = {},
): Promise<ProjectInspectReport> {
  const degraded: string[] = [];

  const freeze = await readLatestFreeze(deps.journal);
  if (freeze === undefined) {
    degraded.push("no git_freeze journaled yet — 07's control clone has not frozen this repo");
  }

  let stackEvidence: StackEvidence | undefined;
  if (deps.stackEvidenceProvider === undefined) {
    degraded.push(
      "no StackEvidence provider supplied — 12's stack detection has not been wired yet",
    );
  } else {
    stackEvidence = await deps.stackEvidenceProvider();
    if (stackEvidence === undefined) {
      degraded.push(
        "StackEvidence provider returned no result — 12 has not detected this repo's stack yet",
      );
    }
  }

  const changeSets =
    query.changeSetId === undefined
      ? deps.changeSets.list()
      : (() => {
          const found = deps.changeSets.get(query.changeSetId!);
          if (found === undefined) {
            degraded.push(`no ChangeSet found for id "${query.changeSetId}"`);
            return [];
          }
          return [found];
        })();

  return {
    ...(freeze !== undefined ? { freeze } : {}),
    ...(stackEvidence !== undefined ? { stackEvidence } : {}),
    changeSets,
    degraded,
  };
}
