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
import { hashPacketContent } from "./attempt-cache.js";

function packet(overrides: Parameters<typeof buildTaskPacket>[0] = {}) {
  return buildTaskPacket({
    objective: "implement the login form",
    ownedPaths: ["packages/example/src"],
    resourceLimits: { maxTurns: 40 },
    resultSchema: { type: "object" },
    ...overrides,
  });
}

describe("hashPacketContent", () => {
  it("is stable across two packets that differ ONLY in their per-attempt id", () => {
    const first = packet({ id: "11111111-1111-4111-8111-111111111111" });
    const second = packet({ id: "22222222-2222-4222-8222-222222222222" });
    expect(first.id).not.toBe(second.id);
    expect(hashPacketContent(first)).toBe(hashPacketContent(second));
  });

  it("is a sha256: digest string", () => {
    expect(hashPacketContent(packet())).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it("changes when any WORK field changes", () => {
    const base = hashPacketContent(packet());
    expect(hashPacketContent(packet({ objective: "implement the logout form" }))).not.toBe(base);
    expect(hashPacketContent(packet({ baseObjectId: "feedface" }))).not.toBe(base);
    expect(hashPacketContent(packet({ ownedPaths: ["packages/other/src"] }))).not.toBe(base);
    expect(hashPacketContent(packet({ resourceLimits: { maxTurns: 7 } }))).not.toBe(base);
    expect(
      hashPacketContent(packet({ resultSchema: { type: "object", required: ["outcome"] } })),
    ).not.toBe(base);
  });

  it("does not depend on object key insertion order (deep-sorted before hashing)", () => {
    const a = hashPacketContent(packet({ resultSchema: { type: "object", title: "r" } }));
    const b = hashPacketContent(packet({ resultSchema: { title: "r", type: "object" } }));
    expect(a).toBe(b);
  });
});
