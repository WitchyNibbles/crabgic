import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { hashCanonicalFields } from "../resources/resource-definitions.js";
import { resolveOptimisticConcurrencyConflict } from "./precondition.js";

/**
 * A tiny in-memory simulated remote resource — single-revision optimistic
 * concurrency, exactly the shape a real Grafana PUT/If-Match interaction
 * has (revision bumps by 1 on every accepted write; a write whose
 * `expectedRevision` doesn't match the CURRENT revision is refused with a
 * synthetic 409, never silently applied).
 */
class SimulatedRemoteResource {
  #revision = 0;
  #content: string;

  constructor(initialContent: string) {
    this.#content = initialContent;
  }

  read(): { revision: string; contentHash: string } {
    return {
      revision: String(this.#revision),
      contentHash: hashCanonicalFields({ content: this.#content }),
    };
  }

  /** Attempts a precondition-guarded write. Never applies when `expectedRevision` is stale. */
  tryWrite(
    expectedRevision: string,
    newContent: string,
  ): { ok: true } | { ok: false; status: 409 } {
    if (expectedRevision !== String(this.#revision)) {
      return { ok: false, status: 409 };
    }
    this.#content = newContent;
    this.#revision += 1;
    return { ok: true };
  }
}

/**
 * Simulates one writer's full attempt: an initial precondition-guarded
 * write against its OWN captured baseline; on a 409, fetch-compare-rebase
 * via `resolveOptimisticConcurrencyConflict`, then (only when resolved as
 * "rebase") exactly one retried write against the fresh revision — never
 * more than one retry, and NEVER a write when the resolution is "block".
 */
function simulateWriterAttempt(
  remote: SimulatedRemoteResource,
  baselineRevision: string,
  baselineContentHash: string,
  desiredContent: string,
): "applied" | "rebased-and-applied" | "blocked" {
  const first = remote.tryWrite(baselineRevision, desiredContent);
  if (first.ok) return "applied";

  const currentRemote = remote.read();
  const resolution = resolveOptimisticConcurrencyConflict({ baselineContentHash, currentRemote });
  if (resolution.kind === "block") return "blocked";

  // "rebase" was resolved ONLY because currentRemote's content hash already
  // equals our own baseline — proceeding here can never discard someone
  // else's different change, by construction.
  const retried = remote.tryWrite(resolution.freshRevision, desiredContent);
  // A genuinely concurrent 3rd writer could still race this retry in
  // principle; for THIS harness (single retried write, no further nesting)
  // that is out of scope — the invariant under test is about the FIRST
  // conflict's resolution never blindly overwriting divergent content.
  return retried.ok ? "rebased-and-applied" : "blocked";
}

const contentArb = fc.string({ minLength: 1, maxLength: 12 });

describe("resolveOptimisticConcurrencyConflict — concurrent-edit fuzzing (work item 4, exit criterion)", () => {
  it("two writers racing from the SAME baseline: the loser is NEVER a blind overwrite — it either observes identical content (safe rebase) or blocks", () => {
    fc.assert(
      fc.property(contentArb, contentArb, contentArb, (initial, writerAContent, writerBContent) => {
        const remote = new SimulatedRemoteResource(initial);
        const baseline = remote.read();

        const outcomeA = simulateWriterAttempt(
          remote,
          baseline.revision,
          baseline.contentHash,
          writerAContent,
        );
        const afterA = remote.read();
        const outcomeB = simulateWriterAttempt(
          remote,
          baseline.revision,
          baseline.contentHash,
          writerBContent,
        );
        const final = remote.read();

        // Writer A always wins the race for the shared baseline (goes first).
        expect(outcomeA).toBe("applied");

        // The resolution B sees depends ONLY on whether A's write actually
        // changed the remote's content relative to the shared baseline —
        // never on B's own desired content (resolveOptimisticConcurrencyConflict
        // compares baseline-vs-current, not baseline-vs-B's-own-proposal).
        if (writerAContent === initial) {
          // A's write was a no-op relative to the baseline — the remote's
          // content never actually changed, so rebasing is safe REGARDLESS
          // of what B itself wanted to write; B's rebase then applies B's
          // content on top of that unchanged state.
          expect(outcomeB).toBe("rebased-and-applied");
          expect(final.contentHash).toBe(hashCanonicalFields({ content: writerBContent }));
        } else {
          // A's write genuinely changed the remote's content away from the
          // baseline — B must NEVER silently apply over that; the remote
          // must still reflect exactly A's write, untouched by B.
          expect(outcomeB).toBe("blocked");
          expect(final.contentHash).toBe(afterA.contentHash);
        }
      }),
      { numRuns: 300 },
    );
  });

  it("N-writer fuzzed interleaving: the final remote state is always traceable to exactly one applied writer's content, never a hybrid/corrupted overwrite", () => {
    fc.assert(
      fc.property(
        contentArb,
        fc.array(contentArb, { minLength: 2, maxLength: 6 }),
        (initial, writerContents) => {
          const remote = new SimulatedRemoteResource(initial);
          const baseline = remote.read();

          const outcomes = writerContents.map((content) =>
            simulateWriterAttempt(remote, baseline.revision, baseline.contentHash, content),
          );

          const final = remote.read();
          // Every possible desired content the final state could legitimately
          // match: the initial content itself, or any writer's own content.
          const legitimateHashes = new Set([
            hashCanonicalFields({ content: initial }),
            ...writerContents.map((c) => hashCanonicalFields({ content: c })),
          ]);
          expect(legitimateHashes.has(final.contentHash)).toBe(true);

          // No outcome is ever a silent overwrite of divergent content: a
          // "blocked" writer's content must NOT be the final state unless
          // some other writer's IDENTICAL content also matches it.
          for (const [index, outcome] of outcomes.entries()) {
            if (outcome === "blocked") {
              const thisWriterHash = hashCanonicalFields({ content: writerContents[index] });
              const someWriterAppliedSameContent = writerContents.some(
                (c, i) =>
                  outcomes[i] !== "blocked" &&
                  hashCanonicalFields({ content: c }) === thisWriterHash,
              );
              if (!someWriterAppliedSameContent) {
                expect(final.contentHash).not.toBe(thisWriterHash);
              }
            }
          }
        },
      ),
      { numRuns: 300 },
    );
  });

  it("resolveOptimisticConcurrencyConflict itself: rebase iff content hash matches, block otherwise (exhaustive 2-branch check)", () => {
    fc.assert(
      fc.property(fc.string(), fc.string(), fc.string(), (baselineHash, currentHash, revision) => {
        const result = resolveOptimisticConcurrencyConflict({
          baselineContentHash: baselineHash,
          currentRemote: { revision, contentHash: currentHash },
        });
        if (baselineHash === currentHash) {
          expect(result).toEqual({ kind: "rebase", freshRevision: revision });
        } else {
          expect(result.kind).toBe("block");
        }
      }),
      { numRuns: 200 },
    );
  });
});
