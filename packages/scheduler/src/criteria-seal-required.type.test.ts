/**
 * roadmap/24 exit criterion 8: "Verification is required by construction:
 * omitting the verifier at any public dispatch/resume entry point fails
 * compilation (type-level fixture in CI)."
 *
 * HOW THIS IS SCORED: every `@ts-expect-error` below asserts that the code
 * on the following line DOES NOT COMPILE. If `criteriaSeal` is ever made
 * optional on `DispatchAttemptOptions` or `ResumeAttemptOptions` — or if a
 * third public entry point appears that does not require it — the suppressed
 * error disappears, and TypeScript then reports `Unused '@ts-expect-error'
 * directive` (TS2578), failing `npm run typecheck` (`tsc -b`, the `typecheck`
 * job in `.github/workflows/ci.yml`, run cold and incremental). The fixture
 * fails LOUDLY on regression rather than silently stopping to protect
 * anything, which is the whole reason a type-level fixture exists here
 * instead of a comment.
 *
 * WHY IT WAS NEEDED: the property held only implicitly. `criteriaSeal` was
 * required on both options types, but nothing anywhere asserted it — and the
 * donor regression this criterion exists to prevent is precisely someone
 * relaxing a required integrity input to unblock a call site.
 *
 * Follows the repo's established type-level pattern (`@crabgic/contracts`'
 * `errors/connector-error.test.ts`, "type-level security" describe):
 * `@ts-expect-error` inside an ordinary `.test.ts`. Each package's own
 * `tsconfig.json` includes `src` wholesale, so `tsc -b` already typechecks
 * test files; no separate `.test-d.ts` toolchain is introduced for this.
 *
 * NOTHING HERE IS EXECUTED. The call fixtures live inside arrow functions
 * that are only ever inspected, never invoked — a compile-time assertion has
 * no business spawning a worker.
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createJournalStore } from "@crabgic/journal";
import { buildFakeEngineScript, buildTaskPacket, buildWorkerResult } from "@crabgic/testkit";
import { FakeEngineAdapter } from "@crabgic/testkit";
import {
  allowAllAdjudicate,
  buildMinimalCompiledProfile,
} from "./test-support/minimal-compiled-profile.js";
import {
  dispatchAttempt,
  resumeAttempt,
  type DispatchAttemptOptions,
  type ResumeAttemptOptions,
} from "./executor.js";

const WORK_UNIT_ID = "11111111-1111-4111-8111-111111111111";

/** Every dependency both entry points need EXCEPT `criteriaSeal` — the one thing each fixture below omits. */
function commonDeps() {
  const adapter = new FakeEngineAdapter(
    buildFakeEngineScript({ structuredOutput: buildWorkerResult({ outcome: "succeeded" }) }),
  );
  // A real store object, but no attempt is ever dispatched against it — see
  // the file-level note that nothing here executes.
  const journal = createJournalStore({
    journalDir: mkdtempSync(join(tmpdir(), "eo-scheduler-criteria-seal-type-")),
  });
  return {
    adapter,
    journal,
    packet: buildTaskPacket({ workUnitId: WORK_UNIT_ID }),
    profile: buildMinimalCompiledProfile(),
    adjudicate: allowAllAdjudicate,
    sessionRef: {
      sessionId: "99999999-9999-4999-8999-999999999999",
      projectDirectory: "/fake/project",
      worktreePath: "/fake/project/worktree",
      configDir: "/fake/project/.claude-config",
    },
  };
}

describe("the acceptance-criteria verifier is required BY CONSTRUCTION (roadmap/24 exit criterion 8)", () => {
  it("rejects a DispatchAttemptOptions value that omits criteriaSeal", () => {
    const deps = commonDeps();

    // @ts-expect-error — roadmap/24 exit criterion 8: `criteriaSeal` is a
    // REQUIRED member of `DispatchAttemptOptions`. If this directive ever
    // reports as unused, the verifier became optional and `tsc -b` must fail.
    const options: DispatchAttemptOptions = {
      adapter: deps.adapter,
      journal: deps.journal,
      packet: deps.packet,
      profile: deps.profile,
      adjudicate: deps.adjudicate,
      evidenceKind: "none",
    };

    expect(options).toBeDefined();
  });

  it("rejects a dispatchAttempt CALL that omits criteriaSeal", () => {
    const deps = commonDeps();

    const neverCalled = () =>
      // @ts-expect-error — roadmap/24 exit criterion 8: the public
      // `dispatchAttempt` entry point cannot be reached without a bar to judge
      // the attempt against. If this directive reports as unused, `tsc -b` must fail.
      dispatchAttempt({
        adapter: deps.adapter,
        journal: deps.journal,
        packet: deps.packet,
        profile: deps.profile,
        adjudicate: deps.adjudicate,
        evidenceKind: "none",
      });

    expect(neverCalled).toBeTypeOf("function");
  });

  it("rejects a ResumeAttemptOptions value that omits criteriaSeal", () => {
    const deps = commonDeps();

    // @ts-expect-error — roadmap/24 exit criterion 8: `criteriaSeal` is a
    // REQUIRED member of `ResumeAttemptOptions` too. Resume is the OTHER way
    // into the same acceptance funnel, and the donor's own regression was a
    // second entry point that skipped the check the first one made.
    const options: ResumeAttemptOptions = {
      adapter: deps.adapter,
      journal: deps.journal,
      sessionRef: deps.sessionRef,
      workUnitId: WORK_UNIT_ID,
      adjudicate: deps.adjudicate,
      trigger: { kind: "parkResume" },
    };

    expect(options).toBeDefined();
  });

  it("rejects a resumeAttempt CALL that omits criteriaSeal", () => {
    const deps = commonDeps();

    const neverCalled = () =>
      // @ts-expect-error — roadmap/24 exit criterion 8: the public
      // `resumeAttempt` entry point cannot be reached without a bar either.
      // If this directive reports as unused, `tsc -b` must fail.
      resumeAttempt({
        adapter: deps.adapter,
        journal: deps.journal,
        sessionRef: deps.sessionRef,
        workUnitId: WORK_UNIT_ID,
        adjudicate: deps.adjudicate,
        trigger: { kind: "parkResume" },
      });

    expect(neverCalled).toBeTypeOf("function");
  });

  it("still accepts both option shapes once criteriaSeal IS supplied — the fixtures above fail for the omission, not for an unrelated type error", () => {
    const deps = commonDeps();
    const criteriaSeal = { requirements: [], approvalSeal: undefined };

    const dispatchOptions: DispatchAttemptOptions = {
      adapter: deps.adapter,
      journal: deps.journal,
      packet: deps.packet,
      profile: deps.profile,
      adjudicate: deps.adjudicate,
      evidenceKind: "none",
      criteriaSeal,
    };
    const resumeOptions: ResumeAttemptOptions = {
      adapter: deps.adapter,
      journal: deps.journal,
      sessionRef: deps.sessionRef,
      workUnitId: WORK_UNIT_ID,
      adjudicate: deps.adjudicate,
      trigger: { kind: "parkResume" },
      criteriaSeal,
    };

    expect(dispatchOptions.criteriaSeal).toBe(criteriaSeal);
    expect(resumeOptions.criteriaSeal).toBe(criteriaSeal);
  });
});
