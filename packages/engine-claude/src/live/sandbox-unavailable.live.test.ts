/**
 * `sandbox-unavailable.live.test` (roadmap/06 exit criterion: "`failIfUnavailable`
 * aborts (fails closed) when `bwrap` is unavailable"). Runs through the REAL
 * adapter with the compiled `READ_ONLY` profile — whose sandbox block carries
 * `enabled: true` + `failIfUnavailable: true` (see the golden
 * `read-only.sdk-call.json`) — but with the worker `PATH` starved down to just
 * the Node runtime's own directory, so `bwrap`/`socat` (in `/usr/bin`) are
 * unresolvable. The adapter's own env plumbing reads `process.env.PATH`, so
 * this probe temporarily starves it (restored in `finally`); the SDK still
 * finds Node (absolute `process.execPath`) to launch the pinned bundled
 * engine, but the engine's sandbox runtime cannot find `bwrap` and, because
 * `failIfUnavailable` is set, `query()` THROWS rather than degrading to an
 * unsandboxed run (baseline §6). ZERO model invocations: the throw happens at
 * sandbox init, before any turn.
 */
import { dirname } from "node:path";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { READ_ONLY_ENVELOPE, compileEnvelope } from "@eo/engine-core";
import type { AdjudicationCallback } from "@eo/engine-core";
import { buildTaskPacket } from "@eo/testkit";
import {
  assertLiveEnabled,
  collectEngineEvents,
  createLiveAdapterContext,
  ensureCanary,
} from "./live-harness.js";

const allowAll: AdjudicationCallback = async (_toolName, toolInput) => ({
  behavior: "allow",
  updatedInput: toolInput,
});

const NODE_ONLY_PATH = dirname(process.execPath);
let savedPath: string | undefined;

beforeAll(async () => {
  assertLiveEnabled();
  await ensureCanary();
});

beforeEach(() => {
  savedPath = process.env.PATH;
});

afterEach(() => {
  process.env.PATH = savedPath;
});

describe("failIfUnavailable fails closed when bwrap is unavailable", () => {
  it("query() throws (never degrades to unsandboxed) with PATH starved of bwrap/socat", async () => {
    const ctx = await createLiveAdapterContext();
    try {
      const profile = compileEnvelope(READ_ONLY_ENVELOPE);
      const packet = buildTaskPacket({
        objective: "This worker must never actually run — the sandbox is unavailable.",
        resourceLimits: { maxTurns: 1 },
        resultSchema: { type: "object" },
      });

      // Starve PATH to just Node's own directory: bwrap/socat (/usr/bin) become
      // unresolvable, while the SDK still finds Node (absolute) to launch the
      // pinned bundled engine.
      process.env.PATH = NODE_ONLY_PATH;

      const handle = ctx.adapter.spawn(packet, profile, allowAll);
      await expect(collectEngineEvents(handle.events)).rejects.toThrow();
    } finally {
      process.env.PATH = savedPath;
      await ctx.cleanup();
    }
  });
});
