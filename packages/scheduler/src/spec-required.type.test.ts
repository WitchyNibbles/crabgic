/**
 * roadmap/25-owner-pipeline-conformance.md §Exit criteria: "A dispatched
 * worker's `TaskPacket` carries its acceptance criteria verbatim; omitting
 * `spec` fails compilation at every public dispatch entry point (integration
 * test + type-level fixture in CI)."
 *
 * The verbatim half is `./task-packet-builder.test.ts`, "passes the CALLER's
 * spec through, never a substitute". THIS file is the type-level half, and it
 * asserts the clause that sentence actually turns on: not that `TaskPacketSchema`
 * declares `spec` — it does, and a zod declaration is checked at runtime, on a
 * value someone already built — but that the DISPATCH ENTRY POINTS cannot be
 * reached with a packet that lacks one.
 *
 * ⚠️ WHY THAT DISTINCTION IS THE WHOLE POINT. `spec` carries the acceptance
 * criteria the worker is judged against. A runtime-only guarantee fails at the
 * moment of dispatch, in a process that has already opened a worktree and is
 * about to spend engine budget; a compile-time one fails in the editor of
 * whoever relaxed it. `spec-record.ts` states the failure mode this exists to
 * end — "an optional field is one a builder forgets, and the forgetting is
 * invisible: the packet still validates, the worker still runs, and it works
 * from the objective prose instead."
 *
 * HOW THIS IS SCORED, and it is the same mechanism as its sibling
 * `./criteria-seal-required.type.test.ts`: every `@ts-expect-error` below
 * asserts that the following line DOES NOT COMPILE. If `spec` is ever made
 * optional on `TaskPacket`, or a dispatch entry point starts accepting a packet
 * without one, the suppressed error disappears and TypeScript reports
 * `Unused '@ts-expect-error' directive` (TS2578), failing `tsc -b` — the
 * `typecheck` job in `.github/workflows/ci.yml`, on both arches.
 *
 * NOTHING HERE IS EXECUTED. The call fixtures live inside arrow functions that
 * are only ever inspected, never invoked. A compile-time assertion has no
 * business spawning a worker.
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createJournalStore } from "@crabgic/journal";
import type { TaskPacket } from "@crabgic/contracts";
import {
  buildFakeEngineScript,
  buildTaskPacket,
  buildWorkerResult,
  FakeEngineAdapter,
} from "@crabgic/testkit";
import {
  allowAllAdjudicate,
  buildMinimalCompiledProfile,
} from "./test-support/minimal-compiled-profile.js";
import { dispatchAttempt, type DispatchAttemptOptions } from "./executor.js";

const WORK_UNIT_ID = "11111111-1111-4111-8111-111111111111";

/**
 * A packet with `spec` REMOVED at the type level, which is the only way to
 * express "a builder forgot it" in a language where the schema would otherwise
 * make the omission unrepresentable. The cast is confined to this one helper on
 * purpose: everything below is then ordinary typed code, so a future edit that
 * makes `spec` optional reddens the directives rather than being absorbed here.
 */
function packetWithoutSpec(): Omit<TaskPacket, "spec"> {
  const { spec: _spec, ...rest } = buildTaskPacket({ workUnitId: WORK_UNIT_ID });
  return rest;
}

/** Every dependency the entry point needs EXCEPT the packet, which each fixture supplies. */
function commonDeps() {
  return {
    adapter: new FakeEngineAdapter(
      buildFakeEngineScript({ structuredOutput: buildWorkerResult({ outcome: "succeeded" }) }),
    ),
    // A real store object, but no attempt is ever dispatched against it — see
    // the file-level note that nothing here executes.
    journal: createJournalStore({
      journalDir: mkdtempSync(join(tmpdir(), "eo-scheduler-spec-type-")),
    }),
    profile: buildMinimalCompiledProfile(),
    adjudicate: allowAllAdjudicate,
    /** A work unit that owns no requirement — legitimate per `AttemptCriteriaSeal`, and irrelevant to what this file asserts. */
    criteriaSeal: { requirements: [], approvalSeal: undefined },
  };
}

describe("a dispatched packet's acceptance criteria are required BY CONSTRUCTION (roadmap/25)", () => {
  it("rejects a DispatchAttemptOptions value whose packet has no spec", () => {
    const deps = commonDeps();

    const options: DispatchAttemptOptions = {
      adapter: deps.adapter,
      journal: deps.journal,
      // @ts-expect-error — roadmap/25: `spec` is a REQUIRED member of
      // `TaskPacket`, so a packet without one cannot reach dispatch. If this
      // directive ever reports as unused, the acceptance criteria became
      // optional at the dispatch boundary and `tsc -b` must fail.
      packet: packetWithoutSpec(),
      profile: deps.profile,
      adjudicate: deps.adjudicate,
      evidenceKind: "none",
      criteriaSeal: deps.criteriaSeal,
    };

    expect(options).toBeDefined();
  });

  it("rejects a dispatchAttempt CALL whose packet has no spec", () => {
    const deps = commonDeps();

    const neverCalled = () =>
      dispatchAttempt({
        adapter: deps.adapter,
        journal: deps.journal,
        // @ts-expect-error — roadmap/25: the public `dispatchAttempt` entry
        // point cannot be reached with a packet carrying no criteria to judge
        // the work against. If this directive reports as unused, `tsc -b` must fail.
        packet: packetWithoutSpec(),
        profile: deps.profile,
        adjudicate: deps.adjudicate,
        evidenceKind: "none",
        criteriaSeal: deps.criteriaSeal,
      });

    expect(neverCalled).toBeTypeOf("function");
  });

  /**
   * ⚠️ THE POSITIVE CONTROL, and this file is worthless without it. Every
   * assertion above passes if `DispatchAttemptOptions` rejects EVERYTHING —
   * a renamed member, a moved import, a type that stopped resolving. This one
   * fails in that case: the same call site, with a complete packet, must carry
   * no directive at all and still compile.
   */
  it("accepts the same options once the packet carries its spec", () => {
    const deps = commonDeps();

    const neverCalled = () =>
      dispatchAttempt({
        adapter: deps.adapter,
        journal: deps.journal,
        packet: buildTaskPacket({ workUnitId: WORK_UNIT_ID }),
        profile: deps.profile,
        adjudicate: deps.adjudicate,
        evidenceKind: "none",
        criteriaSeal: deps.criteriaSeal,
      });

    expect(neverCalled).toBeTypeOf("function");
  });

  /**
   * The runtime half, stated here rather than left implicit: the schema refuses
   * the same value the type system refuses. Two independent guards over one
   * property is the point — the type check is gone the moment someone writes
   * `as TaskPacket`, and this is what still bites then.
   */
  it("refuses the same packet at runtime, so a cast does not buy a way past", async () => {
    const { TaskPacketSchema } = await import("@crabgic/contracts");
    expect(TaskPacketSchema.safeParse(packetWithoutSpec()).success).toBe(false);
    expect(TaskPacketSchema.safeParse(buildTaskPacket({ workUnitId: WORK_UNIT_ID })).success).toBe(
      true,
    );
  });
});
