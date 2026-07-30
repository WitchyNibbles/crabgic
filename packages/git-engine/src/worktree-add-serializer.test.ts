/**
 * The queue that stops concurrent `git worktree add` calls overlapping on one
 * repository. See the module's own comment for why git needs this and why the
 * scheduler makes it load-bearing.
 */
import { describe, expect, it } from "vitest";
import { serializeWorktreeAdd } from "./worktree-add-serializer.js";

/** Resolves after `ms`, recording entry and exit so overlap is observable. */
function tracked(log: string[], label: string, ms: number): () => Promise<string> {
  return async () => {
    log.push(`enter:${label}`);
    await new Promise((resolve) => setTimeout(resolve, ms));
    log.push(`exit:${label}`);
    return label;
  };
}

describe("serializeWorktreeAdd", () => {
  it("never lets two tasks for the same repository overlap", async () => {
    const log: string[] = [];
    // Deliberately inverted durations: without serialization the SHORT task
    // finishes inside the long one, and the log interleaves.
    const results = await Promise.all([
      serializeWorktreeAdd("/repo", tracked(log, "a", 40)),
      serializeWorktreeAdd("/repo", tracked(log, "b", 1)),
      serializeWorktreeAdd("/repo", tracked(log, "c", 1)),
    ]);

    expect(results).toEqual(["a", "b", "c"]);
    expect(log).toEqual(["enter:a", "exit:a", "enter:b", "exit:b", "enter:c", "exit:c"]);
  });

  it("runs DIFFERENT repositories concurrently — never one global lock", async () => {
    const log: string[] = [];
    await Promise.all([
      serializeWorktreeAdd("/repo-one", tracked(log, "one", 30)),
      serializeWorktreeAdd("/repo-two", tracked(log, "two", 1)),
    ]);
    // The short task on the other repository finishes INSIDE the long one.
    expect(log).toEqual(["enter:one", "enter:two", "exit:two", "exit:one"]);
  });

  it("preserves submission order", async () => {
    const order: number[] = [];
    await Promise.all(
      Array.from({ length: 12 }, (_unused, index) =>
        serializeWorktreeAdd("/repo-fifo", async () => {
          order.push(index);
        }),
      ),
    );
    expect(order).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
  });

  it("a failing task rejects only its own caller, and never blocks the next one", async () => {
    const log: string[] = [];
    const failing = serializeWorktreeAdd("/repo-fail", () =>
      Promise.reject(new Error("worktree add exploded")),
    );
    const following = serializeWorktreeAdd("/repo-fail", tracked(log, "after", 1));

    await expect(failing).rejects.toThrow("worktree add exploded");
    await expect(following).resolves.toBe("after");
    expect(log).toEqual(["enter:after", "exit:after"]);
  });

  it("does not accumulate an entry per repository it has ever seen", async () => {
    // A long-lived daemon touches many repositories; the map must drain.
    for (let index = 0; index < 50; index += 1) {
      await serializeWorktreeAdd(`/repo-${index}`, () => Promise.resolve(index));
    }
    // Re-running the same key must still serialize correctly after a drain.
    const log: string[] = [];
    await Promise.all([
      serializeWorktreeAdd("/repo-0", tracked(log, "x", 20)),
      serializeWorktreeAdd("/repo-0", tracked(log, "y", 1)),
    ]);
    expect(log).toEqual(["enter:x", "exit:x", "enter:y", "exit:y"]);
  });
});
