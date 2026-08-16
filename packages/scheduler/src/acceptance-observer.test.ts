import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createJournalStore,
  findAcceptanceEvaluations,
  type JournalStore,
} from "@crabgic/journal";
import {
  buildFakeEngineScript,
  buildRequirement,
  buildTaskPacket,
  buildWorkerResult,
  FakeEngineAdapter,
  RATE_LIMIT_REJECTED,
} from "@crabgic/testkit";
import type { CriteriaApprovalSeal, Requirement } from "@crabgic/contracts";
import {
  allowAllAdjudicate,
  buildMinimalCompiledProfile,
} from "./test-support/minimal-compiled-profile.js";
import type { CompiledWorkerProfile, EngineEvent } from "@crabgic/engine-core";
import { dispatchAttempt } from "./executor.js";
import { buildAcceptanceEvaluation, createAcceptanceObserver } from "./acceptance-observer.js";

const WORK_UNIT_ID = "11111111-1111-4111-8111-111111111111";
const CHANGE_SET_ID = "22222222-2222-4222-8222-222222222222";

let journalDir: string;
let store: JournalStore;

beforeEach(async () => {
  journalDir = await mkdtemp(join(tmpdir(), "eo-scheduler-acceptance-"));
  store = createJournalStore({ journalDir });
});

afterEach(async () => {
  await rm(journalDir, { recursive: true, force: true });
});

/**
 * A profile that actually GRANTS the four command prefixes.
 *
 * `buildMinimalCompiledProfile` allows nothing, so the fake engine's permission
 * layer denies every `Bash` call and emits no `toolUse` event at all — which
 * would make every assertion below pass against an observer that does nothing.
 * The rules here are the exact strings `MANDATORY_BASH_ALLOWLIST` compiles each
 * grantable prefix into, so what these tests observe is what a real granted
 * worker produces.
 */
function buildGrantingProfile(): CompiledWorkerProfile {
  const base = buildMinimalCompiledProfile();
  const allow = [
    "Bash(npm run test:*)",
    "Bash(npm run build:*)",
    "Bash(git status:*)",
    "Bash(git diff:*)",
  ];
  return {
    ...base,
    permissions: { ...base.permissions, allow },
    settingsJson: {
      ...base.settingsJson,
      permissions: { ...base.settingsJson.permissions, allow },
    },
  };
}

function toolUse(command: string, result?: string, isError?: boolean): EngineEvent {
  return {
    type: "toolUse",
    sessionId: "33333333-3333-4333-8333-333333333333",
    toolUseId: `use-${command}`,
    toolName: "Bash",
    toolInput: { command },
    ...(result !== undefined ? { toolResult: result } : {}),
    ...(isError !== undefined ? { toolResultIsError: isError } : {}),
  };
}

describe("createAcceptanceObserver", () => {
  it("tallies a granted command that ran clean", () => {
    const observer = createAcceptanceObserver();
    observer.observe(toolUse("npm run test", "ok", false));
    expect(observer.snapshot()).toStrictEqual([
      { prefix: "npm run test", invocations: 1, cleanExits: 1 },
    ]);
  });

  /**
   * Run `04a0bf70`, reduced: twelve `Bash` calls, every one of them failing to
   * start. The counts must show BOTH numbers — an operator reading "12 invoked,
   * 0 clean" knows the command path is broken, which is a different repair from
   * "0 invoked".
   */
  it("counts an invocation that errored as attempted and not clean", () => {
    const observer = createAcceptanceObserver();
    for (let i = 0; i < 12; i += 1) {
      observer.observe(toolUse("npm run test", "Failed to create bridge sockets", true));
    }
    expect(observer.snapshot()).toStrictEqual([
      { prefix: "npm run test", invocations: 12, cleanExits: 0 },
    ]);
  });

  /**
   * ⚠️ The fail-closed direction, and the one worth breaking a build over. An
   * engine that stops reporting `is_error` must make this gate refuse, never
   * pass. A `!== true` test here instead of `=== false` would silently convert
   * every unreported call into evidence of a clean run.
   */
  it("does NOT count a result with no is_error flag as clean", () => {
    const observer = createAcceptanceObserver();
    observer.observe(toolUse("npm run test", "some output"));
    expect(observer.snapshot()).toStrictEqual([
      { prefix: "npm run test", invocations: 1, cleanExits: 0 },
    ]);
  });

  /**
   * The normalizer emits `toolUse` twice per call — request, then result. The
   * request half has no `toolResult`. Counting it would double every tally and,
   * worse, would count calls that never ran at all.
   */
  it("ignores the request half of a tool_use/tool_result pair", () => {
    const observer = createAcceptanceObserver();
    observer.observe(toolUse("npm run test"));
    expect(observer.snapshot()).toStrictEqual([]);
  });

  it("ignores a non-Bash tool, an ungranted command, and a non-string command input", () => {
    const observer = createAcceptanceObserver();
    observer.observe({
      type: "toolUse",
      sessionId: "s",
      toolUseId: "u",
      toolName: "Read",
      toolInput: { command: "npm run test" },
      toolResult: "ok",
      toolResultIsError: false,
    });
    observer.observe(toolUse("npm run lint", "ok", false));
    observer.observe({
      type: "toolUse",
      sessionId: "s",
      toolUseId: "u",
      toolName: "Bash",
      toolInput: { command: 42 },
      toolResult: "ok",
      toolResultIsError: false,
    });
    observer.observe({ type: "assistant", sessionId: "s", text: "npm run test" });
    expect(observer.snapshot()).toStrictEqual([]);
  });

  it("keeps distinct grants apart and orders them stably", () => {
    const observer = createAcceptanceObserver();
    observer.observe(toolUse("npm run test -- packages/gates", "ok", false));
    observer.observe(toolUse("git status --short", "ok", false));
    observer.observe(toolUse("npm run build", "ok", true));
    expect(observer.snapshot()).toStrictEqual([
      { prefix: "git status", invocations: 1, cleanExits: 1 },
      { prefix: "npm run build", invocations: 1, cleanExits: 0 },
      { prefix: "npm run test", invocations: 1, cleanExits: 1 },
    ]);
  });
});

describe("buildAcceptanceEvaluation", () => {
  /**
   * An attempt with no approval seal has no change set to attribute an
   * observation to. Writing nothing is the fail-closed answer: a gate that sees
   * no record refuses to publish.
   */
  it("produces no record when the attempt carries no approval seal", () => {
    expect(
      buildAcceptanceEvaluation({
        changeSetId: undefined,
        workUnitId: WORK_UNIT_ID,
        sessionId: "s",
        requirementIds: [],
        invocations: [],
        observedAt: "2026-08-16T00:00:00.000Z",
      }),
    ).toBeUndefined();
  });
});

function seal(requirements: readonly Requirement[]): {
  readonly requirements: readonly Requirement[];
  readonly approvalSeal: CriteriaApprovalSeal;
} {
  return {
    requirements,
    approvalSeal: {
      schemaVersion: 1,
      changeSetId: CHANGE_SET_ID,
      sealedAt: "2026-08-16T00:00:00.000Z",
      criteriaHashes: Object.fromEntries(
        requirements.map((requirement) => [requirement.id, requirement.criteriaHash]),
      ),
    } as CriteriaApprovalSeal,
  };
}

describe("the executor journals what an attempt actually ran (owner ruling R5)", () => {
  it("records a clean acceptance-class invocation against the sealed change set", async () => {
    const requirement = buildRequirement();
    const adapter = new FakeEngineAdapter(
      buildFakeEngineScript({
        toolCalls: [
          { toolName: "Bash", toolInput: { command: "npm run test" }, toolResult: "ok", toolResultIsError: false },
        ],
        structuredOutput: buildWorkerResult({ outcome: "succeeded" }),
      }),
    );

    const outcome = await dispatchAttempt({
      adapter,
      criteriaSeal: seal([requirement]),
      journal: store,
      packet: buildTaskPacket({ workUnitId: WORK_UNIT_ID }),
      profile: buildGrantingProfile(),
      adjudicate: allowAllAdjudicate,
      evidenceKind: "none",
    });
    expect(outcome.kind).toBe("succeeded");

    const records = await findAcceptanceEvaluations(store, CHANGE_SET_ID);
    expect(records).toHaveLength(1);
    expect(records[0]?.workUnitId).toBe(WORK_UNIT_ID);
    // Scope comes from the SEAL, not from a caller-supplied field.
    expect(records[0]?.requirementIds).toStrictEqual([requirement.id]);
    expect(records[0]?.invocations).toStrictEqual([
      { prefix: "npm run test", invocations: 1, cleanExits: 1 },
    ]);
  });

  /**
   * ⚠️ The property that makes this observer worth anything: it records what
   * the ENGINE showed, not what the worker said. This attempt self-reports
   * `succeeded` — the run `04a0bf70` shape — while its granted command never
   * ran clean, and the record says so.
   */
  it("records zero clean exits even when the worker self-reports success", async () => {
    const adapter = new FakeEngineAdapter(
      buildFakeEngineScript({
        toolCalls: [
          { toolName: "Bash", toolInput: { command: "npm run test" }, toolResult: "boom", toolResultIsError: true },
        ],
        structuredOutput: buildWorkerResult({ outcome: "succeeded", summary: "test" }),
      }),
    );

    await dispatchAttempt({
      adapter,
      criteriaSeal: seal([]),
      journal: store,
      packet: buildTaskPacket({ workUnitId: WORK_UNIT_ID }),
      profile: buildGrantingProfile(),
      adjudicate: allowAllAdjudicate,
      evidenceKind: "none",
    });

    const records = await findAcceptanceEvaluations(store, CHANGE_SET_ID);
    expect(records[0]?.invocations).toStrictEqual([
      { prefix: "npm run test", invocations: 1, cleanExits: 0 },
    ]);
  });

  /**
   * Every terminal exit writes one. `consumeEvents` has seven of them, and the
   * record is written outside the loop precisely so an eighth cannot forget —
   * these three cover the branch families (worker-reported failure, crash with
   * no result at all, and a rate-limit park).
   */
  it("records the observation on a FAILED attempt", async () => {
    const adapter = new FakeEngineAdapter(
      buildFakeEngineScript({
        toolCalls: [
          { toolName: "Bash", toolInput: { command: "npm run build" }, toolResult: "ok", toolResultIsError: false },
        ],
        structuredOutput: buildWorkerResult({ outcome: "failed" }),
      }),
    );
    await dispatchAttempt({
      adapter,
      criteriaSeal: seal([]),
      journal: store,
      packet: buildTaskPacket({ workUnitId: WORK_UNIT_ID }),
      profile: buildGrantingProfile(),
      adjudicate: allowAllAdjudicate,
      evidenceKind: "none",
    });
    const records = await findAcceptanceEvaluations(store, CHANGE_SET_ID);
    expect(records).toHaveLength(1);
    expect(records[0]?.invocations).toStrictEqual([
      { prefix: "npm run build", invocations: 1, cleanExits: 1 },
    ]);
  });

  it("records the observation on a CRASHED attempt, carrying what ran before the stream ended", async () => {
    const adapter = new FakeEngineAdapter(
      buildFakeEngineScript({
        toolCalls: [
          { toolName: "Bash", toolInput: { command: "npm run test" }, toolResult: "ok", toolResultIsError: false },
        ],
        failure: { kind: "crash", atStepIndex: 1 },
      }),
    );
    const outcome = await dispatchAttempt({
      adapter,
      criteriaSeal: seal([]),
      journal: store,
      packet: buildTaskPacket({ workUnitId: WORK_UNIT_ID }),
      profile: buildGrantingProfile(),
      adjudicate: allowAllAdjudicate,
      evidenceKind: "none",
    });
    expect(outcome.kind).toBe("crashed");
    const records = await findAcceptanceEvaluations(store, CHANGE_SET_ID);
    expect(records[0]?.invocations).toStrictEqual([
      { prefix: "npm run test", invocations: 1, cleanExits: 1 },
    ]);
  });

  it("records the observation on a PARKED attempt", async () => {
    const adapter = new FakeEngineAdapter(
      buildFakeEngineScript({
        toolCalls: [
          { toolName: "Bash", toolInput: { command: "npm run test" }, toolResult: "ok", toolResultIsError: false },
        ],
        failure: { kind: "limitSignal", payload: RATE_LIMIT_REJECTED },
      }),
    );
    const outcome = await dispatchAttempt({
      adapter,
      criteriaSeal: seal([]),
      journal: store,
      packet: buildTaskPacket({ workUnitId: WORK_UNIT_ID }),
      profile: buildGrantingProfile(),
      adjudicate: allowAllAdjudicate,
      evidenceKind: "none",
    });
    expect(outcome.kind).toBe("parked");
    expect(await findAcceptanceEvaluations(store, CHANGE_SET_ID)).toHaveLength(1);
  });

  it("writes no record when the attempt has no approval seal to attribute it to", async () => {
    const adapter = new FakeEngineAdapter(
      buildFakeEngineScript({ structuredOutput: buildWorkerResult({ outcome: "succeeded" }) }),
    );
    await dispatchAttempt({
      adapter,
      criteriaSeal: { requirements: [], approvalSeal: undefined },
      journal: store,
      packet: buildTaskPacket({ workUnitId: WORK_UNIT_ID }),
      profile: buildGrantingProfile(),
      adjudicate: allowAllAdjudicate,
      evidenceKind: "none",
    });
    expect(await findAcceptanceEvaluations(store, CHANGE_SET_ID)).toStrictEqual([]);
  });
});
