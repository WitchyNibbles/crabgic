/**
 * `zz-live-run-record` — the suite finalizer (named to sort LAST among
 * `src/live/*.live.test.ts` under the sequential live runner). Writes
 * `packages/engine-claude/live-run-record.json` (`{engineVersion, runId,
 * suiteDigest}` — consumed by 14's `engine-conformance` binding gate) and
 * appends the journal `evidence_pointer` recording the run.
 *
 * GREEN-RUN SEMANTICS: vitest runs every file sequentially regardless of
 * earlier failures, so this finalizer writes a record whenever it is reached;
 * the "green run" gate is the overall `npm run test:live` exit status — the CI
 * job uploads the artifact only `if: success()`, and a local run's record is
 * trusted/committed only on a fully-green pass (documented in wi5-live.md).
 * It consumes 0 extra live invocations: `ensureCanary()` is memoized across
 * the run, and `engineVersion` comes from the adapter's offline
 * `capabilities()` resolution.
 */
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import {
  assertLiveEnabled,
  createLiveAdapterContext,
  ensureCanary,
  writeLiveRunRecord,
} from "./live-harness.js";

beforeAll(async () => {
  assertLiveEnabled();
  await ensureCanary();
});

describe("live-run-record + journal evidence_pointer", () => {
  it("writes {engineVersion, runId, suiteDigest} and journals the green run", async () => {
    const canary = await ensureCanary();
    const ctx = await createLiveAdapterContext();
    try {
      const record = await writeLiveRunRecord({
        engineVersion: canary.engineVersion,
        journal: ctx.journal,
        workUnitId: randomUUID(),
      });
      expect(record.engineVersion).toBe(canary.engineVersion);
      expect(record.suiteDigest).toMatch(/^[0-9a-f]{64}$/);
      expect(record.runId.length).toBeGreaterThan(0);

      // The journal actually received the evidence_pointer entry.
      const entries: unknown[] = [];
      for await (const entry of ctx.journal.queryEntries({ type: "evidence_pointer" })) {
        entries.push(entry);
      }
      expect(entries.length).toBeGreaterThan(0);
    } finally {
      await ctx.cleanup();
    }
  });
});
