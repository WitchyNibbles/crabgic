import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createGateRegistry } from "./registry.js";
import type { GateContext, GateVerdict } from "./types.js";
import { firePacketGates } from "./packet-gates.js";
import { createTestJournal, type TestJournal } from "./test-support/test-journal.js";

/**
 * ⚠️ THE WIRE THAT WAS NEVER THERE.
 *
 * `TaskPacket.gates` has existed since roadmap/13, is schema-validated, is cited in
 * `@crabgic/contracts` to both 13:19 and `14-quality-security-gates.md:49`, and is populated on
 * every packet the scheduler builds. MEASURED 2026-08-18, before this module existed: a grep for
 * `\.gates\b` across every non-test source file in the repository, excluding the schema that
 * declares it, returned **exactly one hit** — `packages/scheduler/src/task-packet-builder.ts:127`,
 * `gates: [...(options.gates ?? [])]`, which is the builder WRITING the field.
 *
 * Nothing read it. Every packet ever dispatched to a worker carried a list of gate tags that no
 * code anywhere looked at, and every suite was green the whole time.
 *
 * The consequence is not cosmetic. `implement-gates-pass` and `implement-tests-first` are derived
 * server-side from journaled `EvidenceRecord.gateVerdict` values (`@crabgic/cli`'s
 * `review/gate-criteria.ts`), and `evidence_attach` carries no `gateVerdict` field, so no caller
 * can mint one. Gates that never fire produce no verdicts, so those two criteria are underivable
 * for every change set — which is exactly where owner ruling R7's staged run stopped, at stage 6
 * of 9. This is the third appearance of the shape
 * `docs/evidence/criteria-closeout/defects/14-gate-registry-never-composed.md` names: declared,
 * schema-valid, unit-tested, never wired.
 *
 * DIRECTION OF THE DEPENDENCY, because it decides where this module can live. `@crabgic/gates`
 * depends on `@crabgic/scheduler` and not the reverse (measured from both package manifests), and
 * roadmap/14 consumes from 13 rather than the other way about. The scheduler therefore cannot
 * fire gates, and this wire belongs on the 14 side, reading a packet's declared tags.
 */

const CHANGE_SET_ID = "9f1c2d3e-4a5b-4c6d-8e7f-0a1b2c3d4e5f";
const OBJECT_ID = "0123456789abcdef0123456789abcdef01234567";

let tj: TestJournal;

beforeEach(async () => {
  tj = await createTestJournal();
});

afterEach(async () => {
  await tj.cleanup();
});

function buildContext(): GateContext {
  return {
    stage: "verifying",
    changeSetId: CHANGE_SET_ID,
    objectId: OBJECT_ID,
    workUnitId: "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d",
    journal: tj.store,
    now: () => new Date("2026-08-18T16:00:00.000Z"),
  };
}

function passingVerdict(command: string): GateVerdict {
  return {
    passed: true,
    command,
    exitStatus: 0,
    toolchainFingerprint: "node-24",
    artifactDigests: [],
    detail: `stub gate for ${command}`,
  };
}

describe("firePacketGates — a dispatched packet's declared gates actually fire", () => {
  /**
   * The whole point. A packet naming two tags fires those two handlers, and each firing leaves a
   * journaled `EvidenceRecord` behind — which is the only thing `deriveGateCriteria` will read.
   */
  it("fires exactly the tags the packet names, and journals one verdict-bearing record per firing", async () => {
    const registry = createGateRegistry();
    const fired: string[] = [];
    registry.register("tdd", "tdd-gate", async () => {
      fired.push("tdd");
      return passingVerdict("npm run test");
    });
    registry.register("coverage", "coverage-gate", async () => {
      fired.push("coverage");
      return passingVerdict("npm run coverage");
    });

    const results = await firePacketGates(registry, ["tdd", "coverage"], buildContext());

    expect(fired.sort()).toStrictEqual(["coverage", "tdd"]);
    expect(results.map((result) => result.tag).sort()).toStrictEqual(["coverage", "tdd"]);
    for (const result of results) {
      expect(result.evidence.gateVerdict, `${result.tag} journaled no verdict`).toBe("passed");
    }
  });

  /**
   * ⚠️ The anti-vacuity arm, and the one that makes the test above mean something. A test that
   * only asserts "the named tags fired" passes just as well against an implementation that fires
   * EVERYTHING — which is precisely the bug `fireAll` would introduce if it were used here by
   * mistake. A registered handler the packet does not name must not run.
   */
  it("does NOT fire a registered gate the packet did not name", async () => {
    const registry = createGateRegistry();
    let flakeFired = false;
    registry.register("tdd", "tdd-gate", async () => passingVerdict("npm run test"));
    registry.register("flake", "flake-gate", async () => {
      flakeFired = true;
      return passingVerdict("npm run flake");
    });

    const results = await firePacketGates(registry, ["tdd"], buildContext());

    expect(flakeFired, "a gate the packet never named was fired").toBe(false);
    expect(results.map((result) => result.tag)).toStrictEqual(["tdd"]);
  });

  /**
   * Fail closed on a tag nobody can honour. A packet naming a tag with no registered handler is a
   * packet asking for a check that will not happen; returning "nothing to do" would let a run
   * report a clean gate set it never ran. This is the same direction
   * `deriveGateCriteria` takes when a record carries no verdict: unproven, never presumed green.
   */
  it("REFUSES a packet naming a tag no handler is registered under, rather than silently skipping it", async () => {
    const registry = createGateRegistry();
    registry.register("tdd", "tdd-gate", async () => passingVerdict("npm run test"));

    await expect(firePacketGates(registry, ["tdd", "coverage"], buildContext())).rejects.toThrow(
      /coverage/,
    );
  });

  /**
   * A string that is not a risk tag at all is a different error from a tag nobody registered, and
   * both are refusals. `TaskPacket.gates` is `z.array(NonEmptyStringSchema)` — it does not
   * constrain members to the tag vocabulary — so this boundary is real, not hypothetical.
   */
  it("REFUSES a packet naming something that is not a gate risk tag", async () => {
    const registry = createGateRegistry();
    registry.register("tdd", "tdd-gate", async () => passingVerdict("npm run test"));

    await expect(firePacketGates(registry, ["not-a-real-tag"], buildContext())).rejects.toThrow(
      /not-a-real-tag/,
    );
  });

  /**
   * An empty list is a legitimate no-op and must NOT degenerate into "fire everything". Stated as
   * its own arm because the natural sloppy implementation — treat empty as unfiltered — is
   * exactly the `fireAll` bug, and it would be invisible in a repository where most packets name
   * every default tag anyway.
   */
  it("fires nothing for a packet with an empty gate list, rather than firing every registered gate", async () => {
    const registry = createGateRegistry();
    let anyFired = false;
    registry.register("tdd", "tdd-gate", async () => {
      anyFired = true;
      return passingVerdict("npm run test");
    });

    const results = await firePacketGates(registry, [], buildContext());

    expect(anyFired, "an empty gate list fired a gate").toBe(false);
    expect(results).toStrictEqual([]);
  });

  /**
   * A failing gate is reported as failing, and its record says so. Without this arm the module
   * could hard-code `gateVerdict: "passed"` and every assertion above would still hold — which is
   * the sycophancy inversion in miniature, at the one place a verdict is minted.
   */
  it("journals a FAILED verdict when the handler fails, rather than reporting the firing as a pass", async () => {
    const registry = createGateRegistry();
    registry.register("tdd", "tdd-gate", async () => ({
      passed: false,
      command: "npm run test",
      exitStatus: 1,
      toolchainFingerprint: "node-24",
      artifactDigests: [],
      detail: "the stub gate fails on purpose",
    }));

    const results = await firePacketGates(registry, ["tdd"], buildContext());

    expect(results).toHaveLength(1);
    expect(results[0]?.verdict.passed).toBe(false);
    expect(results[0]?.evidence.gateVerdict).toBe("failed");
  });
});
