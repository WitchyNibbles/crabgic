import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createJournalStore, runKillHarness, type JournalStore } from "@eo/journal";
import { ConnectorError, CURRENT_SCHEMA_VERSION, type RemoteMutationPlan } from "@eo/contracts";
import { GatewayHttpClient } from "../transport/http-client.js";
import { sendHttpRequest, type HttpTransportResponse } from "../transport/http-transport.js";
import {
  executeMutationPlan,
  IdempotencyKeyLock,
  MutationVerificationFailedError,
  type MutationPipelineDeps,
  type MutationPipelineHandlers,
} from "./mutation-pipeline.js";
import { AmbiguousWriteBlockedError } from "./reconciliation.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const PUT_FIXTURE = join(HERE, "kill-harness-fixtures", "deterministic-put-and-crash.mjs");
const POST_FIXTURE = join(HERE, "kill-harness-fixtures", "nonidempotent-post-and-crash.mjs");

function buildPlan(overrides: Partial<RemoteMutationPlan> = {}): RemoteMutationPlan {
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    id: "33333333-3333-4333-8333-333333333333",
    externalConnectionId: "44444444-4444-4444-8444-444444444444",
    tenant: "tenant-a",
    canonicalTarget: "issue:EX-1",
    action: "transition",
    redactedDiff: "status: To Do -> In Progress",
    desiredStateHash: "sha256:desired-state-1",
    idempotencyKey: "op-1",
    impactClass: "reversible",
    rollbackClass: "version-checked-restore",
    envelopeId: "55555555-5555-4555-8555-555555555555",
    ...overrides,
  };
}

/** A minimal, always-successful handler set — `sendRequest` (the fake network) drives the actual behavior of each test. */
function buildHandlers(overrides: Partial<MutationPipelineHandlers> = {}): MutationPipelineHandlers {
  return {
    provider: "fake-provider",
    buildRequest: () => ({ url: new URL("https://fake-provider.invalid/apply"), method: "PUT", hasPrecondition: true }),
    parseResponse: (_plan, response) => JSON.parse(response.bodyText) as { appliedRevision: string },
    verify: async () => true,
    ...overrides,
  };
}

function buildDeps(journal: JournalStore, sendRequest: typeof sendHttpRequest): MutationPipelineDeps {
  const httpClient = new GatewayHttpClient({
    allowlist: { allowedSchemes: ["https:"], allowedOrigins: ["https://fake-provider.invalid"] },
    resolveHostAddresses: async () => ["203.0.113.7"],
    sendRequest,
    sleep: async () => undefined,
  });
  return { journal, httpClient, lock: new IdempotencyKeyLock() };
}

let journalDir: string;
let journal: JournalStore;

beforeEach(async () => {
  journalDir = await mkdtemp(join(tmpdir(), "eo-gateway-mutation-pipeline-"));
  journal = createJournalStore({ journalDir });
});

afterEach(async () => {
  await rm(journalDir, { recursive: true, force: true });
});

describe("executeMutationPlan — happy path", () => {
  it("records a brand-new plan and returns the confirmed applied revision", async () => {
    const applyCalls: string[] = [];
    const sendRequest = vi.fn().mockImplementation(async () => {
      applyCalls.push("apply");
      return { status: 200, headers: {}, bodyText: '{"appliedRevision":"rev-1"}' } satisfies HttpTransportResponse;
    });

    const outcome = await executeMutationPlan(buildPlan(), buildHandlers(), buildDeps(journal, sendRequest));
    expect(outcome).toEqual({ status: "recorded", appliedRevision: "rev-1" });
    expect(applyCalls).toHaveLength(1);
  });

  it("persists a pre-I/O pending record, then a terminal 'recorded' record — both under the SAME operationId (HIGH/MEDIUM #3)", async () => {
    const plan = buildPlan();
    const sendRequest = vi
      .fn()
      .mockResolvedValue({ status: 200, headers: {}, bodyText: '{"appliedRevision":"rev-1"}' } satisfies HttpTransportResponse);

    await executeMutationPlan(plan, buildHandlers(), buildDeps(journal, sendRequest));

    const entries: Array<{ payload: { operationId: string; status: string } }> = [];
    for await (const entry of journal.queryEntries({ type: "remote_operation_record" })) {
      entries.push(entry as { payload: { operationId: string; status: string } });
    }
    const forThisOp = entries.filter((e) => e.payload.operationId === plan.idempotencyKey);
    expect(forThisOp.map((e) => e.payload.status)).toEqual(["pending", "recorded"]);
  });
});

describe("executeMutationPlan — exactly-once semantics", () => {
  it("replays a byte-identical result for the same (operationId, contentHash) without re-invoking the network call", async () => {
    const sendRequest = vi
      .fn()
      .mockResolvedValue({ status: 200, headers: {}, bodyText: '{"appliedRevision":"rev-1"}' } satisfies HttpTransportResponse);
    const deps = buildDeps(journal, sendRequest);
    const plan = buildPlan();

    const first = await executeMutationPlan(plan, buildHandlers(), deps);
    const second = await executeMutationPlan(plan, buildHandlers(), deps);

    expect(first.status).toBe("recorded");
    expect(second).toEqual({ status: "replayed", appliedRevision: "rev-1" });
    expect(sendRequest).toHaveBeenCalledOnce(); // no duplicate network call on replay
  });

  it("rejects a changed-content plan for the same idempotencyKey as a typed conflict, never a silent overwrite", async () => {
    const sendRequest = vi
      .fn()
      .mockResolvedValue({ status: 200, headers: {}, bodyText: '{"appliedRevision":"rev-1"}' } satisfies HttpTransportResponse);
    const deps = buildDeps(journal, sendRequest);
    const plan = buildPlan();
    const changedPlan = buildPlan({ desiredStateHash: "sha256:desired-state-DIFFERENT" });

    await executeMutationPlan(plan, buildHandlers(), deps);
    const conflictOutcome = await executeMutationPlan(changedPlan, buildHandlers(), deps);

    expect(conflictOutcome.status).toBe("conflict");
    expect(conflictOutcome.errorKind).toBe("conflict");
    expect(sendRequest).toHaveBeenCalledOnce(); // the conflicting attempt never re-applied
  });
});

describe("executeMutationPlan — mutating network I/O goes through GatewayHttpClient (HIGH #2)", () => {
  it("a foreign-origin buildRequest target is refused by the SSRF guard before any network call, mapped to a failed outcome", async () => {
    const sendRequest = vi.fn();
    const handlers = buildHandlers({
      buildRequest: () => ({ url: new URL("https://evil.example.com/steal"), method: "PUT", hasPrecondition: true }),
    });
    const outcome = await executeMutationPlan(buildPlan(), handlers, buildDeps(journal, sendRequest));
    expect(outcome.status).toBe("blocked");
    expect(sendRequest).not.toHaveBeenCalled();
  });

  it("concurrent writes for the SAME tenant+resource through the mutation pipeline are write-serialized", async () => {
    const order: number[] = [];
    let n = 0;
    const sendRequest = vi.fn().mockImplementation(async () => {
      const mine = n;
      n += 1;
      await new Promise((resolve) => setTimeout(resolve, mine === 0 ? 20 : 1));
      order.push(mine);
      return { status: 200, headers: {}, bodyText: `{"appliedRevision":"rev-${mine}"}` } satisfies HttpTransportResponse;
    });
    const deps = buildDeps(journal, sendRequest);

    await Promise.all([
      executeMutationPlan(buildPlan({ idempotencyKey: "op-a" }), buildHandlers(), deps),
      executeMutationPlan(buildPlan({ idempotencyKey: "op-b", desiredStateHash: "sha256:desired-state-2" }), buildHandlers(), deps),
    ]);

    expect(order).toEqual([0, 1]); // same tenant+resource key -> submission order preserved
  });
});

describe("executeMutationPlan — MEDIUM #5: concurrent same-idempotencyKey serialization", () => {
  it("two concurrent calls for the SAME idempotencyKey never both apply — the second observes the first's recorded result", async () => {
    let networkCalls = 0;
    const sendRequest = vi.fn().mockImplementation(async () => {
      networkCalls += 1;
      await new Promise((resolve) => setTimeout(resolve, 15));
      return { status: 200, headers: {}, bodyText: '{"appliedRevision":"rev-concurrent"}' } satisfies HttpTransportResponse;
    });
    const deps = buildDeps(journal, sendRequest);
    const plan = buildPlan();

    const [first, second] = await Promise.all([
      executeMutationPlan(plan, buildHandlers(), deps),
      executeMutationPlan(plan, buildHandlers(), deps),
    ]);

    expect(networkCalls).toBe(1); // never two concurrent first-writers both applying
    const statuses = [first.status, second.status].sort();
    expect(statuses).toEqual(["recorded", "replayed"]);
  });
});

describe("executeMutationPlan — ambiguous write, verification failure, connector errors", () => {
  it("maps a network failure with no reconcileAmbiguous hook to a blocked/ambiguous_write outcome (fails closed)", async () => {
    const sendRequest = vi.fn().mockRejectedValue(new Error("ECONNRESET"));
    const outcome = await executeMutationPlan(buildPlan(), buildHandlers(), buildDeps(journal, sendRequest));
    expect(outcome.status).toBe("blocked");
    expect(outcome.errorKind).toBe("ambiguous_write");
  });

  it("a network failure WITH a reconcileAmbiguous hook that resolves it maps to recorded, no duplicate call", async () => {
    const sendRequest = vi.fn().mockRejectedValue(new Error("ECONNRESET"));
    const handlers = buildHandlers({
      reconcileAmbiguous: async () => ({ appliedRevision: "reconciled-rev" }),
    });
    const outcome = await executeMutationPlan(buildPlan(), handlers, buildDeps(journal, sendRequest));
    expect(outcome).toEqual({ status: "recorded", appliedRevision: "reconciled-rev" });
    expect(sendRequest).toHaveBeenCalledOnce();
  });

  it("a network failure WITH a reconcileAmbiguous hook that cannot resolve it still blocks", async () => {
    const sendRequest = vi.fn().mockRejectedValue(new Error("ECONNRESET"));
    const handlers = buildHandlers({ reconcileAmbiguous: async () => undefined });
    const outcome = await executeMutationPlan(buildPlan(), handlers, buildDeps(journal, sendRequest));
    expect(outcome.status).toBe("blocked");
    expect(outcome.errorKind).toBe("ambiguous_write");
  });

  it("maps a verify() false result to a failed outcome, never silently treated as success", async () => {
    const sendRequest = vi
      .fn()
      .mockResolvedValue({ status: 200, headers: {}, bodyText: '{"appliedRevision":"rev-1"}' } satisfies HttpTransportResponse);
    const handlers = buildHandlers({ verify: async () => false });
    const outcome = await executeMutationPlan(buildPlan(), handlers, buildDeps(journal, sendRequest));
    expect(outcome.status).toBe("failed");
  });

  it("MutationVerificationFailedError carries the plan id", () => {
    const err = new MutationVerificationFailedError("plan-1", "mismatch");
    expect(err.planId).toBe("plan-1");
    expect(err.message).toContain("plan-1");
  });

  it("maps a >=400 HTTP response to a failed outcome carrying the canonical ConnectorError kind", async () => {
    const sendRequest = vi.fn().mockResolvedValue({ status: 403, headers: {}, bodyText: "" } satisfies HttpTransportResponse);
    const outcome = await executeMutationPlan(buildPlan(), buildHandlers(), buildDeps(journal, sendRequest));
    expect(outcome.status).toBe("failed");
    expect(outcome.errorKind).toBe("permission");
  });

  it("propagates a genuinely unexpected programming error rather than swallowing it", async () => {
    const sendRequest = vi.fn();
    const handlers = buildHandlers({
      buildRequest: () => {
        throw new TypeError("unexpected bug");
      },
    });
    await expect(executeMutationPlan(buildPlan(), handlers, buildDeps(journal, sendRequest))).rejects.toThrow(
      TypeError,
    );
  });

  it("an AmbiguousWriteBlockedError thrown directly from parseResponse is mapped to blocked", async () => {
    const sendRequest = vi.fn().mockResolvedValue({ status: 200, headers: {}, bodyText: "{}" } satisfies HttpTransportResponse);
    const handlers = buildHandlers({
      parseResponse: () => {
        throw new AmbiguousWriteBlockedError("provider signaled an unresolvable ambiguous outcome");
      },
    });
    const outcome = await executeMutationPlan(buildPlan(), handlers, buildDeps(journal, sendRequest));
    expect(outcome.status).toBe("blocked");
    expect(outcome.errorKind).toBe("ambiguous_write");
  });
});

describe("executeMutationPlan — HIGH/MEDIUM #3: restart finds a pending (non-terminal) record", () => {
  it("never blindly re-applies — with no reconcileAmbiguous hook, blocks instead of retrying", async () => {
    const plan = buildPlan();
    // Simulate a crash between the pre-I/O pending write and any terminal
    // write: append ONLY a pending record directly, then call
    // executeMutationPlan as if this were the restart's own fresh attempt.
    await journal.appendEntry({
      type: "remote_operation_record",
      payload: {
        schemaVersion: CURRENT_SCHEMA_VERSION,
        id: "aaaaaaaa-1111-4111-8111-111111111111",
        remoteMutationPlanId: plan.id,
        operationId: plan.idempotencyKey,
        contentHash: plan.desiredStateHash,
        status: "pending",
        recordedAt: journal.config.clock(),
      },
    });

    const sendRequest = vi.fn().mockResolvedValue({ status: 200, headers: {}, bodyText: '{"appliedRevision":"rev-1"}' } satisfies HttpTransportResponse);
    const outcome = await executeMutationPlan(plan, buildHandlers(), buildDeps(journal, sendRequest));

    expect(outcome.status).toBe("blocked");
    expect(outcome.errorKind).toBe("ambiguous_write");
    expect(sendRequest).not.toHaveBeenCalled(); // never blindly retried
  });

  it("with a reconcileAmbiguous hook that resolves it, converges to recorded without a fresh network call", async () => {
    const plan = buildPlan();
    await journal.appendEntry({
      type: "remote_operation_record",
      payload: {
        schemaVersion: CURRENT_SCHEMA_VERSION,
        id: "aaaaaaaa-2222-4222-8222-222222222222",
        remoteMutationPlanId: plan.id,
        operationId: plan.idempotencyKey,
        contentHash: plan.desiredStateHash,
        status: "pending",
        recordedAt: journal.config.clock(),
      },
    });

    const sendRequest = vi.fn();
    const handlers = buildHandlers({ reconcileAmbiguous: async () => ({ appliedRevision: "found-via-marker" }) });
    const outcome = await executeMutationPlan(plan, handlers, buildDeps(journal, sendRequest));

    expect(outcome).toEqual({ status: "recorded", appliedRevision: "found-via-marker" });
    expect(sendRequest).not.toHaveBeenCalled();
  });

  it("with a reconcileAmbiguous hook that CANNOT resolve it, still blocks (never guesses)", async () => {
    const plan = buildPlan();
    await journal.appendEntry({
      type: "remote_operation_record",
      payload: {
        schemaVersion: CURRENT_SCHEMA_VERSION,
        id: "aaaaaaaa-3333-4333-8333-333333333333",
        remoteMutationPlanId: plan.id,
        operationId: plan.idempotencyKey,
        contentHash: plan.desiredStateHash,
        status: "pending",
        recordedAt: journal.config.clock(),
      },
    });

    const sendRequest = vi.fn();
    const handlers = buildHandlers({ reconcileAmbiguous: async () => undefined });
    const outcome = await executeMutationPlan(plan, handlers, buildDeps(journal, sendRequest));

    expect(outcome.status).toBe("blocked");
    expect(outcome.errorKind).toBe("ambiguous_write");
    expect(sendRequest).not.toHaveBeenCalled();
  });

  it("a reconcileAmbiguous hook that itself throws a ConnectorError maps to a failed outcome", async () => {
    const plan = buildPlan();
    await journal.appendEntry({
      type: "remote_operation_record",
      payload: {
        schemaVersion: CURRENT_SCHEMA_VERSION,
        id: "aaaaaaaa-4444-4444-8444-444444444444",
        remoteMutationPlanId: plan.id,
        operationId: plan.idempotencyKey,
        contentHash: plan.desiredStateHash,
        status: "pending",
        recordedAt: journal.config.clock(),
      },
    });

    const sendRequest = vi.fn();
    const handlers = buildHandlers({
      reconcileAmbiguous: async () => {
        throw ConnectorError.permission({ message: "forbidden", provider: "fake-provider", retryable: false });
      },
    });
    const outcome = await executeMutationPlan(plan, handlers, buildDeps(journal, sendRequest));

    expect(outcome.status).toBe("failed");
    expect(outcome.errorKind).toBe("permission");
  });
});

describe("executeMutationPlan — a prior TERMINAL (failed/conflict) record is never silently re-run", () => {
  it("a prior 'failed' record for the same operationId+contentHash is returned verbatim, never re-applied", async () => {
    const plan = buildPlan();
    await journal.appendEntry({
      type: "remote_operation_record",
      payload: {
        schemaVersion: CURRENT_SCHEMA_VERSION,
        id: "bbbbbbbb-1111-4111-8111-111111111111",
        remoteMutationPlanId: plan.id,
        operationId: plan.idempotencyKey,
        contentHash: plan.desiredStateHash,
        status: "failed",
        errorKind: "permission",
        recordedAt: journal.config.clock(),
      },
    });

    const sendRequest = vi.fn();
    const outcome = await executeMutationPlan(plan, buildHandlers(), buildDeps(journal, sendRequest));

    expect(outcome.status).toBe("failed");
    expect(outcome.errorKind).toBe("permission");
    expect(sendRequest).not.toHaveBeenCalled();
  });

  it("a prior 'conflict' record for the same operationId+contentHash is returned verbatim, never re-applied", async () => {
    const plan = buildPlan();
    await journal.appendEntry({
      type: "remote_operation_record",
      payload: {
        schemaVersion: CURRENT_SCHEMA_VERSION,
        id: "bbbbbbbb-2222-4222-8222-222222222222",
        remoteMutationPlanId: plan.id,
        operationId: plan.idempotencyKey,
        contentHash: plan.desiredStateHash,
        status: "conflict",
        errorKind: "conflict",
        recordedAt: journal.config.clock(),
      },
    });

    const sendRequest = vi.fn();
    const outcome = await executeMutationPlan(plan, buildHandlers(), buildDeps(journal, sendRequest));

    expect(outcome.status).toBe("conflict");
    expect(sendRequest).not.toHaveBeenCalled();
  });
});

describe("executeMutationPlan — a network call that itself throws AmbiguousWriteBlockedError directly", () => {
  it("is never double-wrapped, and maps straight through to blocked", async () => {
    const sendRequest = vi.fn().mockImplementation(async () => {
      throw new AmbiguousWriteBlockedError("the transport itself detected an unresolvable ambiguous outcome");
    });
    const outcome = await executeMutationPlan(buildPlan(), buildHandlers(), buildDeps(journal, sendRequest));
    expect(outcome.status).toBe("blocked");
    expect(outcome.errorKind).toBe("ambiguous_write");
    expect(outcome.detail).toContain("unresolvable ambiguous outcome");
  });
});

describe("executeMutationPlan — crash-recovery / exactly-once matrix (@eo/journal's runKillHarness)", () => {
  let sideEffectFile: string;

  beforeEach(async () => {
    sideEffectFile = join(journalDir, "side-effects.log");
    await writeFile(sideEffectFile, "");
  });

  function fixtureSpec(fixture: string, faultPoint: string, extraEnv: Readonly<Record<string, string>> = {}) {
    return {
      command: process.execPath,
      args: [fixture],
      env: {
        EO_FIXTURE_JOURNAL_DIR: journalDir,
        EO_FIXTURE_SIDE_EFFECT_FILE: sideEffectFile,
        EO_FIXTURE_FAULT_POINT: faultPoint,
        EO_FIXTURE_PLAN_JSON: JSON.stringify(buildPlan()),
        ...extraEnv,
      },
    };
  }

  async function countSideEffectLines(marker: string): Promise<number> {
    const content = await readFile(sideEffectFile, "utf8");
    return content.split("\n").filter((line) => line === marker).length;
  }

  async function readLastOutcome(): Promise<{ status: string } | undefined> {
    try {
      const content = await readFile(`${sideEffectFile}.outcomes.jsonl`, "utf8");
      const lines = content.trim().split("\n").filter((l) => l.length > 0);
      const last = lines.at(-1);
      return last === undefined ? undefined : (JSON.parse(last) as { status: string });
    } catch {
      return undefined;
    }
  }

  async function runRecoveryPass(fixture: string, extraEnv: Readonly<Record<string, string>> = {}): Promise<void> {
    const spec = fixtureSpec(fixture, "none", extraEnv);
    await new Promise<void>((resolve, reject) => {
      const child = spawn(spec.command, spec.args, {
        env: { ...process.env, ...spec.env },
        stdio: "ignore",
      });
      child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`recovery pass exited ${code}`))));
      child.on("error", reject);
    });
  }

  describe("deterministic PUT fixture (idempotent by construction, reconciles-by-retry)", () => {
    it("kill before the network call converges to exactly one real PUT after recovery", async () => {
      const report = await runKillHarness(
        fixtureSpec(PUT_FIXTURE, "before-network-call"),
        ["before-network-call"],
        {
          verify: async () => {
            await runRecoveryPass(PUT_FIXTURE);
            const count = await countSideEffectLines("put");
            return { recovered: count === 1, detail: `putCount=${count}` };
          },
        },
      );
      expect(report.allConverged).toBe(true);
    });

    it("kill after the network call (before this pipeline's own record write) converges to exactly one real PUT after recovery", async () => {
      const report = await runKillHarness(
        fixtureSpec(PUT_FIXTURE, "after-network-call"),
        ["after-network-call"],
        {
          verify: async () => {
            await runRecoveryPass(PUT_FIXTURE);
            const count = await countSideEffectLines("put");
            return { recovered: count === 1, detail: `putCount=${count}` };
          },
        },
      );
      expect(report.allConverged).toBe(true);
    });
  });

  describe("non-idempotent POST/create fixture (MEDIUM/HIGH #3's own required case)", () => {
    it("kill after the create network call, before this pipeline's own record write, NEVER produces a double-create", async () => {
      const report = await runKillHarness(
        fixtureSpec(POST_FIXTURE, "after-network-call"),
        ["after-network-call"],
        {
          verify: async () => {
            await runRecoveryPass(POST_FIXTURE);
            const count = await countSideEffectLines("post");
            // The fixture's own marker-reconciliation `reconcileAmbiguous`
            // hook (search-before-create) is what makes exactly ONE real
            // create possible even though the pipeline itself never
            // blindly retries a found-pending operation — see the
            // fixture's own doc comment.
            return { recovered: count === 1, detail: `postCount=${count}` };
          },
        },
      );
      expect(report.allConverged).toBe(true);
    });

    it("kill after the create network call, with reconciliation disabled, blocks (never guesses) and never double-creates", async () => {
      const noReconcile = { EO_FIXTURE_NO_RECONCILE: "1" };
      const report = await runKillHarness(
        fixtureSpec(POST_FIXTURE, "after-network-call", noReconcile),
        ["after-network-call"],
        {
          verify: async () => {
            await runRecoveryPass(POST_FIXTURE, noReconcile);
            const count = await countSideEffectLines("post");
            const outcome = await readLastOutcome();
            return {
              recovered: count === 1 && outcome?.status === "blocked",
              detail: `postCount=${count}, outcome=${JSON.stringify(outcome)}`,
            };
          },
        },
      );
      expect(report.allConverged).toBe(true);
    });
  });
});
