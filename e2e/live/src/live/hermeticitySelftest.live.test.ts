/**
 * `@live` hermeticity self-test — roadmap/23-release-hardening.md work
 * item 7's "later wave" (03/06's compiled-profile self-test, re-run on a
 * clean host). Unlike `sandbox.selftest` (real `bwrap`, no auth needed —
 * proven for real in the default gate by `../sandboxSelftestHarness.
 * test.ts`), `hermeticity.selftest`'s real probe genuinely spawns `claude
 * -p ...` and consumes a real subscription turn
 * (`packages/cli/src/doctor/checks/hermeticity-selftest.ts`'s own
 * `createRealHermeticitySelftestProbe`) — this is the one part of this
 * work item's self-test pair that is `@live`-gated rather than run
 * unconditionally, exactly per that work item's own instruction.
 */
import { beforeAll, describe, expect, it } from "vitest";
import {
  createHermeticitySelftestCheck,
  createRealHermeticitySelftestProbe,
  createRealProcessProbe,
} from "crabgic";
import { assertLiveEnabled } from "./liveGate.js";

beforeAll(() => {
  assertLiveEnabled();
});

describe("hermeticity self-test (real claude spawn, clean host)", () => {
  it("a planted rogue CLAUDE.md marker never leaks into a real, isolated-settingSources claude turn", async () => {
    const probe = createRealHermeticitySelftestProbe(createRealProcessProbe());
    const check = createHermeticitySelftestCheck({ probe });
    const finding = await check.run();

    expect(finding.passed).toBe(true);
    expect(finding.evidence).toContain("no effect");
  });
});
