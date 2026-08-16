import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { StageCompletionRecord } from "@crabgic/contracts";
import {
  loadStageCompletions,
  recordStageCompletion,
  resolveStageCompletionStorePath,
} from "./stage-completion-store.js";

/**
 * The durable answer to "has this stage closed?" — owner ruling R8, and ledger
 * Gap 23's disclosed residual 2.
 *
 * The schema and its two readers are tested in `@crabgic/contracts`. What these
 * tests cover is the durability half: that a completion survives, that a
 * malformed store fails SAFE rather than open, and that a predictable state path
 * gets the same hardening the `EnvelopePolicy`, the signing key and the
 * design-verdict store got.
 *
 * The fail-safe direction is the load-bearing property here and it is the
 * opposite of most stores': under R8 dispatch hangs on a stage having closed, so
 * every failure to read must mean NOT closed. A store that degraded to
 * "everything closed" would turn an unreadable file into an authorization.
 */

let home: string;
let storePath: string;
let stateHome: string;

const CHANGE_SET = "22222222-2222-4222-8222-222222222222";

function completion(overrides: Partial<StageCompletionRecord> = {}): StageCompletionRecord {
  return {
    schemaVersion: 1,
    changeSetId: CHANGE_SET,
    stage: "research",
    round: 2,
    artifactRef: "research-record:abc",
    closedAt: "2026-08-16T00:00:00.000Z",
    ...overrides,
  } as StageCompletionRecord;
}

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "crabgic-stage-completions-"));
  stateHome = join(home, "state");
  storePath = resolveStageCompletionStorePath(
    { HOME: home, XDG_STATE_HOME: stateHome },
    "projecthash",
  );
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

describe("resolveStageCompletionStorePath", () => {
  it("sits beside the other project-scoped state, under the project hash", () => {
    expect(storePath).toContain("projecthash");
    expect(storePath.endsWith(".json")).toBe(true);
  });

  it("is a different file from any other store in the same directory", () => {
    // A shared file would let one store's malformed write take out another's,
    // and the fail-safe directions differ between them.
    expect(storePath).not.toContain("design-verdicts");
    expect(storePath).not.toContain("findings");
  });
});

describe("recordStageCompletion / loadStageCompletions", () => {
  it("round-trips a completion", async () => {
    await recordStageCompletion(storePath, completion(), stateHome);
    expect(await loadStageCompletions(storePath)).toEqual([completion()]);
  });

  it("reads an absent store as empty, never as complete", async () => {
    // The fail-safe arm. Before anything has closed, nothing has closed.
    expect(await loadStageCompletions(storePath)).toEqual([]);
  });

  it("appends rather than replacing, so an earlier round is not erased", async () => {
    // Records append: a stage re-opened by an edit and re-closed must not erase
    // the round it closed on first, which is the only durable evidence of
    // whether it converged or was pushed through.
    await recordStageCompletion(storePath, completion({ round: 2 }), stateHome);
    await recordStageCompletion(storePath, completion({ round: 5 }), stateHome);
    const loaded = await loadStageCompletions(storePath);
    expect(loaded).toHaveLength(2);
    expect(loaded.map((r) => r.round)).toEqual([2, 5]);
  });

  it("keeps completions for different change sets apart", async () => {
    await recordStageCompletion(storePath, completion(), stateHome);
    await recordStageCompletion(
      storePath,
      completion({ changeSetId: "33333333-3333-4333-8333-333333333333", stage: "design-gate" }),
      stateHome,
    );
    expect(await loadStageCompletions(storePath)).toHaveLength(2);
  });

  it("refuses to record an invalid completion rather than writing it", async () => {
    // Throws rather than degrading: a silent no-op would leave a stage that the
    // server decided had closed looking permanently open, and the failure would
    // read as the pipeline stalling rather than as the write failing.
    await expect(
      recordStageCompletion(
        storePath,
        { ...completion(), stage: "not-a-stage" } as never,
        stateHome,
      ),
    ).rejects.toThrow(/invalid/i);
    expect(await loadStageCompletions(storePath)).toEqual([]);
  });
});

describe("fail-safe reads", () => {
  it("reads an unparseable store as empty, so dispatch refuses rather than proceeds", async () => {
    // The property that matters most under R8. An unreadable store must not be
    // an authorization to dispatch.
    mkdirSync(dirname(storePath), { recursive: true, mode: 0o700 });
    writeFileSync(storePath, "{ this is not json", { mode: 0o600 });
    expect(await loadStageCompletions(storePath)).toEqual([]);
  });

  it("drops an individual invalid entry instead of poisoning the file", async () => {
    // One corrupt record must not erase every valid completion beside it — that
    // would silently re-open stages that really did close.
    mkdirSync(dirname(storePath), { recursive: true, mode: 0o700 });
    writeFileSync(
      storePath,
      JSON.stringify([completion(), { schemaVersion: 1, stage: "research" }]),
      { mode: 0o600 },
    );
    expect(await loadStageCompletions(storePath)).toEqual([completion()]);
  });

  it("reads a store that is not an array as empty", async () => {
    mkdirSync(dirname(storePath), { recursive: true, mode: 0o700 });
    writeFileSync(storePath, JSON.stringify({ stage: "research" }), { mode: 0o600 });
    expect(await loadStageCompletions(storePath)).toEqual([]);
  });
});

describe("path hardening", () => {
  /**
   * `openOwnedFile` opens with `O_NOFOLLOW`, which refuses a symlinked FINAL
   * component. That is the property tested here, on both paths, and it is the
   * one the design-verdict store already relies on.
   *
   * The FIRST version of these tests asserted something stronger and false —
   * that a read through a symlinked PARENT DIRECTORY is refused. It is not, in
   * this store or in any of its siblings: `O_NOFOLLOW` constrains the last
   * component and POSIX follows the rest. The corrected residual is recorded in
   * this module's docblock rather than deleted with the assertion, because a
   * property nobody claims is a property nobody re-checks.
   */
  it("refuses to READ a store whose file is a symlink", async () => {
    // A symlink here would let anyone who can create one choose the file that
    // answers "has this stage closed?" — which under R8 is the file dispatch
    // hangs on.
    mkdirSync(dirname(storePath), { recursive: true, mode: 0o700 });
    const elsewhere = join(home, "elsewhere.json");
    writeFileSync(elsewhere, JSON.stringify([completion()]), { mode: 0o600 });
    symlinkSync(elsewhere, storePath);
    // Refused, and refused as EMPTY — the fail-safe direction, so a planted
    // symlink cannot authorize a dispatch.
    expect(await loadStageCompletions(storePath)).toEqual([]);
  });

  it("refuses to WRITE through a symlinked store path", async () => {
    mkdirSync(dirname(storePath), { recursive: true, mode: 0o700 });
    const elsewhere = join(home, "elsewhere-write.json");
    writeFileSync(elsewhere, "[]", { mode: 0o600 });
    symlinkSync(elsewhere, storePath);
    await expect(recordStageCompletion(storePath, completion(), stateHome)).rejects.toThrow();
  });

  it("refuses to write into a directory outside the state root", async () => {
    // `ensureOwnedDir` is the write path's own check, and it runs before any
    // descriptor is opened. This is the arm that covers the directory case that
    // `O_NOFOLLOW` does not.
    const outside = join(home, "outside", "stage-completions.json");
    await expect(recordStageCompletion(outside, completion(), stateHome)).rejects.toThrow();
  });
});
