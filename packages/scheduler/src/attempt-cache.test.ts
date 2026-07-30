/**
 * Content-hash keying for the attempt cache — the piece that turns the
 * generic `SchedulerCache` (phase 13, shipped with zero production callers)
 * into something `driveRun` can actually consult.
 *
 * WHAT THE KEY MUST AND MUST NOT SEE. A `TaskPacket`'s `id` is minted
 * `randomUUID()` per dispatch attempt (`run-dispatcher.ts`'s `buildPacket`),
 * so a hash over the whole record would NEVER collide across re-drives and
 * the cache would never hit — a control that looks installed and is not,
 * the exact defect shape phase 06's probes exist because of. Everything
 * else on the packet IS authorization/work content and must be seen:
 * a different objective, base object id, owned path, turn budget or result
 * schema is different work.
 */
import { describe, expect, it } from "vitest";
import { buildTaskPacket } from "@crabgic/testkit";
import { hashAttemptContent } from "./attempt-cache.js";

const RUN = "44444444-4444-4444-8444-444444444444";

function packet(overrides: Parameters<typeof buildTaskPacket>[0] = {}) {
  return buildTaskPacket({
    objective: "implement the login form",
    ownedPaths: ["packages/example/src"],
    resourceLimits: { maxTurns: 40 },
    resultSchema: { type: "object" },
    ...overrides,
  });
}

describe("hashAttemptContent", () => {
  it("is stable across two packets that differ ONLY in their per-attempt id", () => {
    const first = packet({ id: "11111111-1111-4111-8111-111111111111" });
    const second = packet({ id: "22222222-2222-4222-8222-222222222222" });
    expect(first.id).not.toBe(second.id);
    expect(hashAttemptContent(RUN, first)).toBe(hashAttemptContent(RUN, second));
  });

  it("is a sha256: digest string", () => {
    expect(hashAttemptContent(RUN, packet())).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it("changes when any WORK field changes", () => {
    const base = hashAttemptContent(RUN, packet());
    expect(hashAttemptContent(RUN, packet({ objective: "implement the logout form" }))).not.toBe(
      base,
    );
    expect(hashAttemptContent(RUN, packet({ baseObjectId: "feedface" }))).not.toBe(base);
    expect(hashAttemptContent(RUN, packet({ ownedPaths: ["packages/other/src"] }))).not.toBe(base);
    expect(hashAttemptContent(RUN, packet({ resourceLimits: { maxTurns: 7 } }))).not.toBe(base);
    expect(
      hashAttemptContent(RUN, packet({ resultSchema: { type: "object", required: ["outcome"] } })),
    ).not.toBe(base);
  });

  it("does not depend on object key insertion order (deep-sorted before hashing)", () => {
    const a = hashAttemptContent(RUN, packet({ resultSchema: { type: "object", title: "r" } }));
    const b = hashAttemptContent(RUN, packet({ resultSchema: { title: "r", type: "object" } }));
    expect(a).toBe(b);
  });

  it("a DIFFERENT run is a different key: a retry run never absorbs a cancelled run's work", () => {
    // Adversarial review, 2026-07-30: without run scoping, a retry of the
    // same change set on an untouched repo (same frozen base) hashed
    // identically to the run the owner cancelled — and silently reused work
    // they cancelled precisely because it was wrong, invisibly to
    // `status <new-run>`, with no invalidation API to force re-execution.
    const one = packet({ id: "11111111-1111-4111-8111-111111111111" });
    expect(hashAttemptContent(RUN, one)).not.toBe(
      hashAttemptContent("99999999-9999-4999-8999-999999999999", one),
    );
  });
});
