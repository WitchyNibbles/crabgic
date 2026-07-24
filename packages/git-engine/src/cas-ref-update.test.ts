import { afterEach, describe, expect, it } from "vitest";
import type { JournalEntry, JournalEntryInput } from "@eo/journal";
import { applyCasUpdate } from "./cas-ref-update.js";
import { InvalidObjectIdError } from "./git-arg-guard.js";
import type { IntegrationJournalAppender } from "./integration-journal.js";
import { computeWorkingTreeHash } from "./invariance.js";
import { createGitPlumbing, createNodeGitSpawn } from "./plumbing.js";
import { buildBasicFixtureRepo, fixtureGit, removeDirTree } from "./test-support/fixture-repo.js";

/**
 * roadmap/08-integration-publication.md work item 2 — Failing-first per the
 * roadmap's own text: "two concurrent updates racing the same
 * `expectedOldValue` — the loser must retry-rebuild-or-block, never
 * silently overwrite."
 */

const plumbing = createGitPlumbing({ spawnFn: createNodeGitSpawn() });
const dirs: string[] = [];
afterEach(() => {
  while (dirs.length > 0) removeDirTree(dirs.pop()!);
});

const ZERO_OID = "0".repeat(40);

/** A capturing fake `IntegrationJournalAppender` — the same "spawn-capture shim" technique this package already uses for `GitSpawnFn`, applied to journal appends. Its `appendEntry` return value is never inspected by these tests, so it is safely fabricated rather than round-tripped through a real journal store. */
function createCapturingJournal(): {
  readonly entries: JournalEntryInput[];
} & IntegrationJournalAppender {
  const entries: JournalEntryInput[] = [];
  return {
    entries,
    async appendEntry(input) {
      entries.push(input);
      return input as unknown as JournalEntry;
    },
  };
}

function buildRepoWithTwoCommits(): {
  readonly dir: string;
  readonly first: string;
  readonly second: string;
} {
  const { dir, headObjectId: first } = buildBasicFixtureRepo();
  dirs.push(dir);
  fixtureGit(dir, ["commit", "--allow-empty", "-q", "-m", "second"]);
  const second = fixtureGit(dir, ["rev-parse", "HEAD"]).trim();
  return { dir, first, second };
}

function buildRepoWithThreeCommits(): {
  readonly dir: string;
  readonly first: string;
  readonly second: string;
  readonly third: string;
} {
  const { dir, first, second } = buildRepoWithTwoCommits();
  fixtureGit(dir, ["commit", "--allow-empty", "-q", "-m", "third"]);
  const third = fixtureGit(dir, ["rev-parse", "HEAD"]).trim();
  return { dir, first, second, third };
}

describe("applyCasUpdate", () => {
  it("creates a fresh ref when expectedOldValue is the zero sentinel", async () => {
    const { dir, first } = buildRepoWithTwoCommits();
    const result = await applyCasUpdate(plumbing, {
      repoDir: dir,
      ref: "refs/heads/integration-target",
      expectedOldValue: ZERO_OID,
      newValue: first,
    });
    expect(result).toEqual({
      status: "applied",
      ref: "refs/heads/integration-target",
      objectId: first,
      attempts: 1,
    });
    expect(fixtureGit(dir, ["rev-parse", "refs/heads/integration-target"]).trim()).toBe(first);
  });

  it("threads runId/changeSetId/workUnitId correlation through to the journaled entry when all three are supplied", async () => {
    const { dir, first, second } = buildRepoWithTwoCommits();
    fixtureGit(dir, ["update-ref", "refs/heads/target", first]);
    const journal = createCapturingJournal();

    await applyCasUpdate(plumbing, {
      repoDir: dir,
      ref: "refs/heads/target",
      expectedOldValue: first,
      newValue: second,
      journal,
      runId: "run-1",
      changeSetId: "cs-1",
      workUnitId: "wu-1",
    });

    expect(journal.entries[0]).toMatchObject({
      runId: "run-1",
      changeSetId: "cs-1",
      workUnitId: "wu-1",
    });
  });

  it("resolves to the zero-OID sentinel (never throws) when the ref never existed at all and a lost race is reported", async () => {
    const { dir, first } = buildRepoWithTwoCommits();
    // No ref created at all — a CAS attempt claiming a non-zero
    // expectedOldValue against a ref that has never existed always loses
    // (git can't verify an old value against nothing), and `rev-parse
    // --verify` on that same never-existed ref also fails outright.
    const result = await applyCasUpdate(plumbing, {
      repoDir: dir,
      ref: "refs/heads/never-existed",
      expectedOldValue: first,
      newValue: first,
    });

    expect(result.status).toBe("blocked");
  });

  it("advances a ref whose current value matches expectedOldValue, journaling exactly one attempt", async () => {
    const { dir, first, second } = buildRepoWithTwoCommits();
    fixtureGit(dir, ["update-ref", "refs/heads/target", first]);
    const journal = createCapturingJournal();

    const result = await applyCasUpdate(plumbing, {
      repoDir: dir,
      ref: "refs/heads/target",
      expectedOldValue: first,
      newValue: second,
      journal,
      changeSetId: "cs-1",
    });

    expect(result).toEqual({
      status: "applied",
      ref: "refs/heads/target",
      objectId: second,
      attempts: 1,
    });
    expect(journal.entries).toHaveLength(1);
    expect(journal.entries[0]).toMatchObject({
      type: "cas_ref_update",
      payload: { ref: "refs/heads/target", objectId: second },
      changeSetId: "cs-1",
    });
  });

  it("never overwrites on a lost race and blocks (no rebuild supplied), leaving the ref exactly at the winner's value", async () => {
    const { dir, first, second, third } = buildRepoWithThreeCommits();
    fixtureGit(dir, ["update-ref", "refs/heads/target", first]);

    // Integrator A wins: advances first -> second.
    const winner = await applyCasUpdate(plumbing, {
      repoDir: dir,
      ref: "refs/heads/target",
      expectedOldValue: first,
      newValue: second,
    });
    expect(winner.status).toBe("applied");

    // Integrator B raced against the SAME stale expectedOldValue (first) and
    // computed `third` before observing A's update — it must lose, never
    // silently overwrite `second`.
    const journal = createCapturingJournal();
    const loser = await applyCasUpdate(plumbing, {
      repoDir: dir,
      ref: "refs/heads/target",
      expectedOldValue: first,
      newValue: third,
      journal,
    });

    expect(loser.status).toBe("blocked");
    expect(fixtureGit(dir, ["rev-parse", "refs/heads/target"]).trim()).toBe(second); // never overwritten
    expect(journal.entries).toHaveLength(1); // the lost attempt is still journaled
    expect(journal.entries[0]).toMatchObject({
      type: "cas_ref_update",
      payload: { ref: "refs/heads/target", objectId: third },
    });
  });

  it("converges via the rebuild loop when the loser recomputes against the winner's new tip", async () => {
    const { dir, first, second, third } = buildRepoWithThreeCommits();
    fixtureGit(dir, ["update-ref", "refs/heads/target", first]);
    await applyCasUpdate(plumbing, {
      repoDir: dir,
      ref: "refs/heads/target",
      expectedOldValue: first,
      newValue: second,
    });

    const rebuildCalls: string[] = [];
    const result = await applyCasUpdate(plumbing, {
      repoDir: dir,
      ref: "refs/heads/target",
      expectedOldValue: first, // stale — matches "second" now, not "first"
      newValue: third,
      rebuild: (currentRefValue) => {
        rebuildCalls.push(currentRefValue);
        return { newValue: third }; // recomputed candidate is still acceptable against the new tip
      },
    });

    expect(result).toEqual({
      status: "applied",
      ref: "refs/heads/target",
      objectId: third,
      attempts: 2,
    });
    expect(rebuildCalls).toEqual([second]);
  });

  it("blocks when the rebuild callback itself reports blocked", async () => {
    const { dir, first, second } = buildRepoWithTwoCommits();
    fixtureGit(dir, ["update-ref", "refs/heads/target", first]);
    // Advance the ref out from under the caller's stale expectation.
    fixtureGit(dir, ["update-ref", "refs/heads/target", second]);

    const result = await applyCasUpdate(plumbing, {
      repoDir: dir,
      ref: "refs/heads/target",
      expectedOldValue: first,
      newValue: second,
      rebuild: () => ({ blocked: true, reason: "irreconcilable conflict on rebuild" }),
    });

    expect(result).toEqual({
      status: "blocked",
      ref: "refs/heads/target",
      attempts: 1,
      reason: "irreconcilable conflict on rebuild",
    });
  });

  it("terminates (never loops forever) when a competitor keeps racing ahead — bounded by maxAttempts", async () => {
    const { dir, first } = buildRepoWithTwoCommits();
    fixtureGit(dir, ["update-ref", "refs/heads/target", first]);

    let rebuildCallCount = 0;
    // Simulates a competitor that ALWAYS advances the real ref further the
    // instant this side tries to rebuild — every retry is guaranteed stale
    // again by the time it lands, so this can never converge.
    const rebuild = (currentRefValue: string): { newValue: string } => {
      rebuildCallCount += 1;
      fixtureGit(dir, [
        "commit",
        "--allow-empty",
        "-q",
        "-m",
        `competitor-${String(rebuildCallCount)}`,
      ]);
      const racedAhead = fixtureGit(dir, ["rev-parse", "HEAD"]).trim();
      fixtureGit(dir, ["update-ref", "refs/heads/target", racedAhead]);
      return { newValue: currentRefValue }; // recomputed against a value already stale by the time it's retried
    };

    const result = await applyCasUpdate(plumbing, {
      repoDir: dir,
      ref: "refs/heads/target",
      expectedOldValue: "0".repeat(40),
      newValue: first,
      maxAttempts: 3,
      rebuild,
    });

    expect(result.status).toBe("blocked");
    expect(result.attempts).toBe(3);
    expect(rebuildCallCount).toBe(2); // called after attempts 1 and 2, not wastefully after the final (3rd, unrecoverable) attempt
  });

  it("proves the invariance-harness extension: the working tree is byte-identical before/after", async () => {
    const { dir, first, second } = buildRepoWithTwoCommits();
    fixtureGit(dir, ["update-ref", "refs/heads/target", first]);
    const beforeHash = await computeWorkingTreeHash(dir);

    await applyCasUpdate(plumbing, {
      repoDir: dir,
      ref: "refs/heads/target",
      expectedOldValue: first,
      newValue: second,
    });

    const afterHash = await computeWorkingTreeHash(dir);
    expect(afterHash).toBe(beforeHash);
  });

  it("rejects a flag-shaped ref before ever spawning git", async () => {
    const { dir, first } = buildRepoWithTwoCommits();
    await expect(
      applyCasUpdate(plumbing, {
        repoDir: dir,
        ref: "--upload-pack=touch /tmp/should-not-exist",
        expectedOldValue: ZERO_OID,
        newValue: first,
      }),
    ).rejects.toThrow();
  });

  it("rejects a non-hex newValue before ever spawning git", async () => {
    const { dir } = buildRepoWithTwoCommits();
    await expect(
      applyCasUpdate(plumbing, {
        repoDir: dir,
        ref: "refs/heads/target",
        expectedOldValue: ZERO_OID,
        newValue: "not-an-oid",
      }),
    ).rejects.toBeInstanceOf(InvalidObjectIdError);
  });
});
