import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createJournalStore, runKillHarness, type JournalStore } from "@crabgic/journal";
import {
  ConnectorError,
  CURRENT_SCHEMA_VERSION,
  type RemoteMutationPlan,
} from "@crabgic/contracts";
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
function buildHandlers(
  overrides: Partial<MutationPipelineHandlers> = {},
): MutationPipelineHandlers {
  return {
    provider: "fake-provider",
    buildRequest: () => ({
      url: new URL("https://fake-provider.invalid/apply"),
      method: "PUT",
      hasPrecondition: true,
    }),
    parseResponse: (_plan, response) =>
      JSON.parse(response.bodyText) as { appliedRevision: string },
    verify: async () => true,
    ...overrides,
  };
}

/**
 * `tenantAllowlist` defaults to `undefined` — a tenant-UNSCOPED connection,
 * which is the pre-defect-21 behaviour and the right default for every case
 * in this file whose subject is not tenancy. The tenancy cases pass it
 * explicitly.
 */
function buildDeps(
  journal: JournalStore,
  sendRequest: typeof sendHttpRequest,
  tenantAllowlist: readonly string[] | undefined = undefined,
  folderAllowlist: readonly string[] | undefined = undefined,
): MutationPipelineDeps {
  const httpClient = new GatewayHttpClient({
    allowlist: { allowedSchemes: ["https:"], allowedOrigins: ["https://fake-provider.invalid"] },
    resolveHostAddresses: async () => ["203.0.113.7"],
    sendRequest,
    sleep: async () => undefined,
  });
  return {
    journal,
    httpClient,
    lock: new IdempotencyKeyLock(),
    tenantAllowlist,
    folderAllowlist,
  };
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
      return {
        status: 200,
        headers: {},
        bodyText: '{"appliedRevision":"rev-1"}',
      } satisfies HttpTransportResponse;
    });

    const outcome = await executeMutationPlan(
      buildPlan(),
      buildHandlers(),
      buildDeps(journal, sendRequest),
    );
    expect(outcome).toEqual({ status: "recorded", appliedRevision: "rev-1" });
    expect(applyCalls).toHaveLength(1);
  });

  it("persists a pre-I/O pending record, then a terminal 'recorded' record — both under the SAME operationId (HIGH/MEDIUM #3)", async () => {
    const plan = buildPlan();
    const sendRequest = vi.fn().mockResolvedValue({
      status: 200,
      headers: {},
      bodyText: '{"appliedRevision":"rev-1"}',
    } satisfies HttpTransportResponse);

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
    const sendRequest = vi.fn().mockResolvedValue({
      status: 200,
      headers: {},
      bodyText: '{"appliedRevision":"rev-1"}',
    } satisfies HttpTransportResponse);
    const deps = buildDeps(journal, sendRequest);
    const plan = buildPlan();

    const first = await executeMutationPlan(plan, buildHandlers(), deps);
    const second = await executeMutationPlan(plan, buildHandlers(), deps);

    expect(first.status).toBe("recorded");
    expect(second).toEqual({ status: "replayed", appliedRevision: "rev-1" });
    expect(sendRequest).toHaveBeenCalledOnce(); // no duplicate network call on replay
  });

  it("rejects a changed-content plan for the same idempotencyKey as a typed conflict, never a silent overwrite", async () => {
    const sendRequest = vi.fn().mockResolvedValue({
      status: 200,
      headers: {},
      bodyText: '{"appliedRevision":"rev-1"}',
    } satisfies HttpTransportResponse);
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
      buildRequest: () => ({
        url: new URL("https://evil.example.com/steal"),
        method: "PUT",
        hasPrecondition: true,
      }),
    });
    const outcome = await executeMutationPlan(
      buildPlan(),
      handlers,
      buildDeps(journal, sendRequest),
    );
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
      return {
        status: 200,
        headers: {},
        bodyText: `{"appliedRevision":"rev-${mine}"}`,
      } satisfies HttpTransportResponse;
    });
    const deps = buildDeps(journal, sendRequest);

    await Promise.all([
      executeMutationPlan(buildPlan({ idempotencyKey: "op-a" }), buildHandlers(), deps),
      executeMutationPlan(
        buildPlan({ idempotencyKey: "op-b", desiredStateHash: "sha256:desired-state-2" }),
        buildHandlers(),
        deps,
      ),
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
      return {
        status: 200,
        headers: {},
        bodyText: '{"appliedRevision":"rev-concurrent"}',
      } satisfies HttpTransportResponse;
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
    const outcome = await executeMutationPlan(
      buildPlan(),
      buildHandlers(),
      buildDeps(journal, sendRequest),
    );
    expect(outcome.status).toBe("blocked");
    expect(outcome.errorKind).toBe("ambiguous_write");
  });

  it("a network failure WITH a reconcileAmbiguous hook that resolves it maps to recorded, no duplicate call", async () => {
    const sendRequest = vi.fn().mockRejectedValue(new Error("ECONNRESET"));
    const handlers = buildHandlers({
      reconcileAmbiguous: async () => ({ appliedRevision: "reconciled-rev" }),
    });
    const outcome = await executeMutationPlan(
      buildPlan(),
      handlers,
      buildDeps(journal, sendRequest),
    );
    expect(outcome).toEqual({ status: "recorded", appliedRevision: "reconciled-rev" });
    expect(sendRequest).toHaveBeenCalledOnce();
  });

  it("a network failure WITH a reconcileAmbiguous hook that cannot resolve it still blocks", async () => {
    const sendRequest = vi.fn().mockRejectedValue(new Error("ECONNRESET"));
    const handlers = buildHandlers({ reconcileAmbiguous: async () => undefined });
    const outcome = await executeMutationPlan(
      buildPlan(),
      handlers,
      buildDeps(journal, sendRequest),
    );
    expect(outcome.status).toBe("blocked");
    expect(outcome.errorKind).toBe("ambiguous_write");
  });

  it("maps a verify() false result to a failed outcome, never silently treated as success", async () => {
    const sendRequest = vi.fn().mockResolvedValue({
      status: 200,
      headers: {},
      bodyText: '{"appliedRevision":"rev-1"}',
    } satisfies HttpTransportResponse);
    const handlers = buildHandlers({ verify: async () => false });
    const outcome = await executeMutationPlan(
      buildPlan(),
      handlers,
      buildDeps(journal, sendRequest),
    );
    expect(outcome.status).toBe("failed");
  });

  it("MutationVerificationFailedError carries the plan id", () => {
    const err = new MutationVerificationFailedError("plan-1", "mismatch");
    expect(err.planId).toBe("plan-1");
    expect(err.message).toContain("plan-1");
  });

  it("maps a >=400 HTTP response to a failed outcome carrying the canonical ConnectorError kind", async () => {
    const sendRequest = vi.fn().mockResolvedValue({
      status: 403,
      headers: {},
      bodyText: "",
    } satisfies HttpTransportResponse);
    const outcome = await executeMutationPlan(
      buildPlan(),
      buildHandlers(),
      buildDeps(journal, sendRequest),
    );
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
    await expect(
      executeMutationPlan(buildPlan(), handlers, buildDeps(journal, sendRequest)),
    ).rejects.toThrow(TypeError);
  });

  it("an AmbiguousWriteBlockedError thrown directly from parseResponse is mapped to blocked", async () => {
    const sendRequest = vi.fn().mockResolvedValue({
      status: 200,
      headers: {},
      bodyText: "{}",
    } satisfies HttpTransportResponse);
    const handlers = buildHandlers({
      parseResponse: () => {
        throw new AmbiguousWriteBlockedError("provider signaled an unresolvable ambiguous outcome");
      },
    });
    const outcome = await executeMutationPlan(
      buildPlan(),
      handlers,
      buildDeps(journal, sendRequest),
    );
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

    const sendRequest = vi.fn().mockResolvedValue({
      status: 200,
      headers: {},
      bodyText: '{"appliedRevision":"rev-1"}',
    } satisfies HttpTransportResponse);
    const outcome = await executeMutationPlan(
      plan,
      buildHandlers(),
      buildDeps(journal, sendRequest),
    );

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
    const handlers = buildHandlers({
      reconcileAmbiguous: async () => ({ appliedRevision: "found-via-marker" }),
    });
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
        throw ConnectorError.permission({
          message: "forbidden",
          provider: "fake-provider",
          retryable: false,
        });
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
    const outcome = await executeMutationPlan(
      plan,
      buildHandlers(),
      buildDeps(journal, sendRequest),
    );

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
    const outcome = await executeMutationPlan(
      plan,
      buildHandlers(),
      buildDeps(journal, sendRequest),
    );

    expect(outcome.status).toBe("conflict");
    expect(sendRequest).not.toHaveBeenCalled();
  });
});

describe("executeMutationPlan — a network call that itself throws AmbiguousWriteBlockedError directly", () => {
  it("is never double-wrapped, and maps straight through to blocked", async () => {
    const sendRequest = vi.fn().mockImplementation(async () => {
      throw new AmbiguousWriteBlockedError(
        "the transport itself detected an unresolvable ambiguous outcome",
      );
    });
    const outcome = await executeMutationPlan(
      buildPlan(),
      buildHandlers(),
      buildDeps(journal, sendRequest),
    );
    expect(outcome.status).toBe("blocked");
    expect(outcome.errorKind).toBe("ambiguous_write");
    expect(outcome.detail).toContain("unresolvable ambiguous outcome");
  });
});

describe("executeMutationPlan — crash-recovery / exactly-once matrix (@crabgic/journal's runKillHarness)", () => {
  let sideEffectFile: string;

  beforeEach(async () => {
    sideEffectFile = join(journalDir, "side-effects.log");
    await writeFile(sideEffectFile, "");
  });

  function fixtureSpec(
    fixture: string,
    faultPoint: string,
    extraEnv: Readonly<Record<string, string>> = {},
  ) {
    return {
      command: process.execPath,
      args: [fixture],
      env: {
        CRABGIC_FIXTURE_JOURNAL_DIR: journalDir,
        CRABGIC_FIXTURE_SIDE_EFFECT_FILE: sideEffectFile,
        CRABGIC_FIXTURE_FAULT_POINT: faultPoint,
        CRABGIC_FIXTURE_PLAN_JSON: JSON.stringify(buildPlan()),
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
      const lines = content
        .trim()
        .split("\n")
        .filter((l) => l.length > 0);
      const last = lines.at(-1);
      return last === undefined ? undefined : (JSON.parse(last) as { status: string });
    } catch {
      return undefined;
    }
  }

  async function runRecoveryPass(
    fixture: string,
    extraEnv: Readonly<Record<string, string>> = {},
  ): Promise<void> {
    const spec = fixtureSpec(fixture, "none", extraEnv);
    await new Promise<void>((resolve, reject) => {
      const child = spawn(spec.command, spec.args, {
        env: { ...process.env, ...spec.env },
        stdio: "ignore",
      });
      child.on("exit", (code) =>
        code === 0 ? resolve() : reject(new Error(`recovery pass exited ${code}`)),
      );
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
      const noReconcile = { CRABGIC_FIXTURE_NO_RECONCILE: "1" };
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

/**
 * `serializationTarget` — the OPTIONAL provider hook that decouples the
 * write-mutex key from the plan's identity key. roadmap/18 exit criterion
 * 10's second clause ("per-issue write order preserved") needs Jira's
 * four issue-scoped `canonicalTarget` shapes (`issue:K`, `issue:K:comment`,
 * `issue:K:worklog`, `issue:K:attachment`) to take ONE mutex, while
 * `canonicalTarget` itself must stay distinct — the Jira apply clients
 * parse a `commentId` back out of it. Absent the hook, behavior must be
 * byte-identical to before it existed (the Grafana/default path).
 */
/** Overlap detection via a deferred-promise barrier — the fallback timer is only reachable when the requests provably CANNOT overlap (i.e. they are serialized), so a loaded machine lengthens the hold rather than shortening it. */
function createOverlapRecorder(): {
  readonly maxInFlight: () => number;
  readonly sendRequest: typeof sendHttpRequest;
} {
  let inFlight = 0;
  let maxInFlight = 0;
  let completed = 0;
  let releaseBarrier: () => void = () => undefined;
  const barrier = new Promise<void>((resolve) => {
    releaseBarrier = resolve;
  });
  return {
    maxInFlight: () => maxInFlight,
    sendRequest: async (): Promise<HttpTransportResponse> => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      if (inFlight >= 2) releaseBarrier();
      if (completed === 0) {
        let timer: ReturnType<typeof setTimeout> | undefined;
        await Promise.race([
          barrier,
          new Promise<void>((resolve) => {
            timer = setTimeout(resolve, 300);
          }),
        ]);
        if (timer !== undefined) clearTimeout(timer);
      }
      inFlight -= 1;
      completed += 1;
      return { status: 200, headers: {}, bodyText: JSON.stringify({ appliedRevision: "rev-1" }) };
    },
  };
}

function sharedTargetPlan(suffix: string, canonicalTarget: string): RemoteMutationPlan {
  return buildPlan({
    id: `33333333-3333-4333-8333-3333333333${suffix.charCodeAt(0).toString(16)}`,
    canonicalTarget,
    idempotencyKey: `op-serialize-${suffix}`,
  });
}

describe("executeMutationPlan — serializationTarget", () => {
  it("passes the hook's key to the transport as `resource`, leaving canonicalTarget alone", async () => {
    const deps = buildDeps(journal, async () => ({
      status: 200,
      headers: {},
      bodyText: JSON.stringify({ appliedRevision: "rev-1" }),
    }));
    const requestSpy = vi.spyOn(deps.httpClient, "request");
    const plan = buildPlan({ canonicalTarget: "issue:EX-1:comment" });

    const outcome = await executeMutationPlan(
      plan,
      buildHandlers({
        serializationTarget: (p) => p.canonicalTarget.split(":").slice(0, 2).join(":"),
      }),
      deps,
    );

    expect(outcome.status).toBe("recorded");
    expect(requestSpy).toHaveBeenCalledTimes(1);
    const req = requestSpy.mock.calls[0]?.[0];
    expect(req?.resource).toBe("issue:EX-1");
    expect(req?.isWrite).toBe(true);
    // Identity is untouched — only the mutex key was redirected.
    expect(plan.canonicalTarget).toBe("issue:EX-1:comment");
  });

  it("DEFAULT PATH: with no hook, `resource` is exactly plan.canonicalTarget", async () => {
    const deps = buildDeps(journal, async () => ({
      status: 200,
      headers: {},
      bodyText: JSON.stringify({ appliedRevision: "rev-1" }),
    }));
    const requestSpy = vi.spyOn(deps.httpClient, "request");
    const plan = buildPlan({ canonicalTarget: "dashboard:abc123" });
    const handlers = buildHandlers();
    expect(handlers.serializationTarget).toBeUndefined();

    await executeMutationPlan(plan, handlers, deps);

    expect(requestSpy.mock.calls[0]?.[0]?.resource).toBe("dashboard:abc123");
  });

  it("serializes two plans with DIFFERENT canonicalTargets that share one serializationTarget", async () => {
    const recorder = createOverlapRecorder();
    const deps = buildDeps(journal, recorder.sendRequest);
    const handlers = buildHandlers({
      serializationTarget: (p) => p.canonicalTarget.split(":").slice(0, 2).join(":"),
    });

    await Promise.all([
      executeMutationPlan(sharedTargetPlan("a", "issue:EX-1"), handlers, deps),
      executeMutationPlan(sharedTargetPlan("b", "issue:EX-1:comment"), handlers, deps),
    ]);

    expect(recorder.maxInFlight()).toBe(1);
  });

  it("CONTROL: without the hook, those same two plans overlap (the instrumentation CAN see overlap)", async () => {
    const recorder = createOverlapRecorder();
    const deps = buildDeps(journal, recorder.sendRequest);
    const handlers = buildHandlers();

    await Promise.all([
      executeMutationPlan(sharedTargetPlan("c", "issue:EX-1"), handlers, deps),
      executeMutationPlan(sharedTargetPlan("d", "issue:EX-1:comment"), handlers, deps),
    ]);

    expect(recorder.maxInFlight()).toBe(2);
  });

  /**
   * PLURAL form — `serializationTarget` returning an ARRAY, the shape
   * 18/19's `bulk:<keys>` writes need (roadmap/18 §Exit criteria 10).
   * Same barrier discipline as the cases above: no duration is asserted,
   * and every `=== 1` claim is paired with a disjoint-set `=== 2` control.
   */
  it("PLURAL: two plans whose serializationTarget ARRAYS share ONE member key are serialized", async () => {
    const recorder = createOverlapRecorder();
    const deps = buildDeps(journal, recorder.sendRequest);
    const handlers = buildHandlers({
      serializationTarget: (p) =>
        p.canonicalTarget === "bulk:A,B" ? ["issue:A", "issue:B"] : ["issue:B", "issue:C"],
    });

    await Promise.all([
      executeMutationPlan(sharedTargetPlan("e", "bulk:A,B"), handlers, deps),
      executeMutationPlan(sharedTargetPlan("f", "bulk:B,C"), handlers, deps),
    ]);

    expect(recorder.maxInFlight()).toBe(1);
  });

  it("PLURAL CONTROL: two plans whose serializationTarget arrays are DISJOINT overlap", async () => {
    const recorder = createOverlapRecorder();
    const deps = buildDeps(journal, recorder.sendRequest);
    const handlers = buildHandlers({
      serializationTarget: (p) =>
        p.canonicalTarget === "bulk:A,B" ? ["issue:A", "issue:B"] : ["issue:C", "issue:D"],
    });

    await Promise.all([
      executeMutationPlan(sharedTargetPlan("g", "bulk:A,B"), handlers, deps),
      executeMutationPlan(sharedTargetPlan("h", "bulk:C,D"), handlers, deps),
    ]);

    expect(recorder.maxInFlight()).toBe(2);
  });

  it("PLURAL: an array target sends serializationResources and keeps canonicalTarget as `resource`", async () => {
    const deps = buildDeps(journal, async () => ({
      status: 200,
      headers: {},
      bodyText: JSON.stringify({ appliedRevision: "rev-1" }),
    }));
    const requestSpy = vi.spyOn(deps.httpClient, "request");
    const plan = buildPlan({ canonicalTarget: "bulk:A,B" });

    await executeMutationPlan(
      plan,
      buildHandlers({ serializationTarget: () => ["issue:A", "issue:B"] }),
      deps,
    );

    const req = requestSpy.mock.calls[0]?.[0];
    expect(req?.serializationResources).toEqual(["issue:A", "issue:B"]);
    // `resource` stays the plan's identity — audit/attribution only when
    // the mutex is taken over the plural set.
    expect(req?.resource).toBe("bulk:A,B");
  });

  it("SINGLE-ELEMENT ARRAY is byte-identical to the string form: `resource` set, no serializationResources", async () => {
    // This is the assertion that keeps the pre-existing contract from
    // silently changing shape now that the hook is plural-capable. Every
    // single-issue Jira write takes this path.
    const deps = buildDeps(journal, async () => ({
      status: 200,
      headers: {},
      bodyText: JSON.stringify({ appliedRevision: "rev-1" }),
    }));
    const requestSpy = vi.spyOn(deps.httpClient, "request");
    const plan = buildPlan({ canonicalTarget: "issue:A:comment" });

    await executeMutationPlan(
      plan,
      buildHandlers({ serializationTarget: () => ["issue:A"] }),
      deps,
    );

    const req = requestSpy.mock.calls[0]?.[0];
    expect(req?.resource).toBe("issue:A");
    expect(req?.serializationResources).toBeUndefined();
  });

  it("an EMPTY array target falls back to canonicalTarget — a write is never left unkeyed", async () => {
    const deps = buildDeps(journal, async () => ({
      status: 200,
      headers: {},
      bodyText: JSON.stringify({ appliedRevision: "rev-1" }),
    }));
    const requestSpy = vi.spyOn(deps.httpClient, "request");
    const plan = buildPlan({ canonicalTarget: "issue:EX-9" });

    await executeMutationPlan(plan, buildHandlers({ serializationTarget: () => [] }), deps);

    const req = requestSpy.mock.calls[0]?.[0];
    expect(req?.resource).toBe("issue:EX-9");
    expect(req?.serializationResources).toBeUndefined();
  });
});

/**
 * DEFECT 21 — the tenant-allowlist admission check.
 *
 * SCOPE, restated here because a reader arriving at these tests must not
 * over-read them: this binds the tenant a plan DECLARES, on the mutation
 * path only. Reads are not tenant-checked and the remote's actual tenant
 * identity is never verified. See `refuseOutOfAllowlistTenant` in
 * `./mutation-pipeline.ts` and the field's doc comment in
 * `@crabgic/contracts`.
 *
 * The production wiring — the tool handler reading the real
 * `ExternalConnection` and handing this field over — is pinned separately in
 * `../mcp/native-tools/mutation-apply-tool.test.ts`. These cases pin the
 * pipeline's own semantics, which no tool-level test can reach.
 */
describe("executeMutationPlan — tenant-allowlist admission check (defect 21)", () => {
  const okResponse = {
    status: 200,
    headers: {},
    bodyText: '{"appliedRevision":"rev-1"}',
  } satisfies HttpTransportResponse;

  it("FAIL-CLOSED: an EMPTY allowlist refuses every mutation, with no network call", async () => {
    const sendRequest = vi.fn().mockResolvedValue(okResponse);
    const outcome = await executeMutationPlan(
      buildPlan(),
      buildHandlers(),
      buildDeps(journal, sendRequest, []),
    );
    expect(outcome.status).toBe("failed");
    expect(outcome.errorKind).toBe("policy_blocked");
    expect(sendRequest).not.toHaveBeenCalled();
  });

  it("CONTROL: an ABSENT allowlist (undefined) is tenant-unscoped — the mutation proceeds", async () => {
    const sendRequest = vi.fn().mockResolvedValue(okResponse);
    const outcome = await executeMutationPlan(
      buildPlan(),
      buildHandlers(),
      buildDeps(journal, sendRequest, undefined),
    );
    expect(outcome).toEqual({ status: "recorded", appliedRevision: "rev-1" });
    expect(sendRequest).toHaveBeenCalledTimes(1);
  });

  it("CONTROL: an IN-allowlist declared tenant proceeds — rules out a refuse-everything implementation", async () => {
    const sendRequest = vi.fn().mockResolvedValue(okResponse);
    const outcome = await executeMutationPlan(
      buildPlan({ tenant: "tenant-a" }),
      buildHandlers(),
      buildDeps(journal, sendRequest, ["tenant-a"]),
    );
    expect(outcome).toEqual({ status: "recorded", appliedRevision: "rev-1" });
    expect(sendRequest).toHaveBeenCalledTimes(1);
  });

  /**
   * The subtle one. Asserting only the OUTCOME would let a
   * persist-then-refuse implementation pass, and a persisted `failed` record
   * is terminal in this pipeline — it would poison the idempotencyKey
   * forever. Both halves are asserted: nothing was appended AT ALL, and no
   * `remote_operation_record` exists for the key.
   */
  it("writes NOTHING to the journal for a refusal — zero appendEntry calls, zero records for the key", async () => {
    const appendSpy = vi.spyOn(journal, "appendEntry");
    const sendRequest = vi.fn().mockResolvedValue(okResponse);
    const plan = buildPlan({ tenant: "tenant-b" });

    const outcome = await executeMutationPlan(
      plan,
      buildHandlers(),
      buildDeps(journal, sendRequest, ["tenant-a"]),
    );

    expect(outcome.status).toBe("failed");
    expect(outcome.errorKind).toBe("policy_blocked");
    expect(appendSpy).toHaveBeenCalledTimes(0);

    const records: string[] = [];
    for await (const entry of journal.queryEntries({ type: "remote_operation_record" })) {
      if (entry.type === "remote_operation_record") records.push(entry.payload.operationId);
    }
    expect(records.filter((id) => id === plan.idempotencyKey)).toEqual([]);
  });

  /**
   * PINS THE NO-JOURNAL RULING as a decision rather than an accident. If the
   * refusal were journalled as `failed`, `executeMutationPlanLocked` would
   * answer every later attempt on this key with "previously recorded as
   * failed, never re-run" — so an operator who FIXED the allowlist could
   * never retry. This test is what a future reader tempted to "add the
   * missing journal write" will break.
   */
  it("does not poison the idempotencyKey: the SAME key succeeds after the allowlist is corrected", async () => {
    const plan = buildPlan({ tenant: "tenant-b", idempotencyKey: "op-tenant-retry" });

    const refused = await executeMutationPlan(
      plan,
      buildHandlers(),
      buildDeps(journal, vi.fn().mockResolvedValue(okResponse), ["tenant-a"]),
    );
    expect(refused.status).toBe("failed");
    expect(refused.errorKind).toBe("policy_blocked");

    // Operator fixes the connection's allowlist; same plan, same key.
    const sendRequest = vi.fn().mockResolvedValue(okResponse);
    const retried = await executeMutationPlan(
      plan,
      buildHandlers(),
      buildDeps(journal, sendRequest, ["tenant-a", "tenant-b"]),
    );
    expect(retried).toEqual({ status: "recorded", appliedRevision: "rev-1" });
    expect(sendRequest).toHaveBeenCalledTimes(1);
    expect(retried.detail).toBeUndefined(); // never "previously recorded as failed, never re-run"
  });

  /**
   * FAIL-CLOSED AHEAD OF REPLAY. The check sits before the journal lookup, so
   * tightening an allowlist also refuses a REPLAY of an already-recorded
   * operation. Without this the guard would be bypassable by any caller who
   * had once succeeded.
   */
  it("refuses even a replay of an already-recorded operation once the allowlist no longer admits its tenant", async () => {
    const plan = buildPlan({ tenant: "tenant-b", idempotencyKey: "op-tenant-tighten" });
    const first = await executeMutationPlan(
      plan,
      buildHandlers(),
      buildDeps(journal, vi.fn().mockResolvedValue(okResponse), ["tenant-b"]),
    );
    expect(first.status).toBe("recorded");

    const sendRequest = vi.fn().mockResolvedValue(okResponse);
    const afterTightening = await executeMutationPlan(
      plan,
      buildHandlers(),
      buildDeps(journal, sendRequest, ["tenant-a"]),
    );
    expect(afterTightening.status).toBe("failed");
    expect(afterTightening.errorKind).toBe("policy_blocked");
    expect(sendRequest).not.toHaveBeenCalled();
  });
});

/**
 * DEFECT 16 — the folder-allowlist admission check.
 *
 * `ExternalConnection.folderAllowlist` was the third declared-and-inert
 * sibling of `tenantAllowlist` (defect 21, closed by PR #100): published in
 * the JSON Schema, settable by an operator, read by no code anywhere.
 *
 * The shape it needs is NOT the tenant one, and the difference is the whole
 * design. `plan.tenant` is a required field on every `RemoteMutationPlan`,
 * so tenancy has exactly two answers. A folder is not on the plan at all
 * (`RemoteMutationPlanSchema` is `.strict()` and names no folder), so the
 * pipeline has to ASK the provider — and a provider has THREE honest
 * answers: "in these folders", "not inside any folder" (an org-level or
 * root-level resource), and "I cannot tell". Only the first can ever be
 * admitted against an allowlist; the other two are refused, with their own
 * detail sentences so the two are distinguishable in an outcome.
 *
 * SCOPE, so a reader does not over-read these tests: this binds the folder
 * a provider attributes FROM THE PLAN, on the mutation path only. It does
 * not verify where the resource actually lives on the remote, and it does
 * not check reads.
 */
describe("executeMutationPlan — folder-allowlist admission check (defect 16)", () => {
  const okResponse = {
    status: 200,
    headers: {},
    bodyText: '{"appliedRevision":"rev-1"}',
  } satisfies HttpTransportResponse;

  const inFolder = (folders: readonly string[]): Partial<MutationPipelineHandlers> => ({
    folderAttribution: () => ({ scope: "folders", folders }),
  });

  it("CONTROL: an ABSENT folderAllowlist (undefined) is folder-unscoped — the mutation proceeds", async () => {
    const sendRequest = vi.fn().mockResolvedValue(okResponse);
    const outcome = await executeMutationPlan(
      buildPlan(),
      // No `folderAttribution` at all — the pre-defect-16 world, which must
      // stay byte-for-byte unchanged for every connection that sets no
      // folderAllowlist. This is the case that would break if the check
      // were wired fail-closed by default.
      buildHandlers(),
      buildDeps(journal, sendRequest, undefined, undefined),
    );
    expect(outcome).toEqual({ status: "recorded", appliedRevision: "rev-1" });
    expect(sendRequest).toHaveBeenCalledTimes(1);
  });

  it("CONTROL: an IN-allowlist folder proceeds — rules out a refuse-everything implementation", async () => {
    const sendRequest = vi.fn().mockResolvedValue(okResponse);
    const outcome = await executeMutationPlan(
      buildPlan(),
      buildHandlers(inFolder(["team-a"])),
      buildDeps(journal, sendRequest, undefined, ["team-a", "team-b"]),
    );
    expect(outcome).toEqual({ status: "recorded", appliedRevision: "rev-1" });
    expect(outcome.detail).toBeUndefined();
    expect(sendRequest).toHaveBeenCalledTimes(1);
  });

  it("refuses a plan attributed to an OUT-of-allowlist folder — typed policy_blocked, zero network calls", async () => {
    const sendRequest = vi.fn().mockResolvedValue(okResponse);
    const outcome = await executeMutationPlan(
      buildPlan(),
      buildHandlers(inFolder(["team-z"])),
      buildDeps(journal, sendRequest, undefined, ["team-a"]),
    );
    expect(outcome.status).toBe("failed");
    expect(outcome.errorKind).toBe("policy_blocked");
    expect(outcome.detail).toContain("outside this connection's folderAllowlist");
    expect(sendRequest).not.toHaveBeenCalled();
  });

  it("refuses when ANY attributed folder is out of the allowlist, not only when all are", async () => {
    const sendRequest = vi.fn().mockResolvedValue(okResponse);
    const outcome = await executeMutationPlan(
      buildPlan(),
      buildHandlers(inFolder(["team-a", "team-z"])),
      buildDeps(journal, sendRequest, undefined, ["team-a"]),
    );
    expect(outcome.status).toBe("failed");
    expect(outcome.errorKind).toBe("policy_blocked");
    expect(sendRequest).not.toHaveBeenCalled();
  });

  it("FAIL-CLOSED: an EMPTY folderAllowlist refuses every mutation, with no network call", async () => {
    const sendRequest = vi.fn().mockResolvedValue(okResponse);
    const outcome = await executeMutationPlan(
      buildPlan(),
      // Even a perfectly-attributed, otherwise-admissible plan.
      buildHandlers(inFolder(["team-a"])),
      buildDeps(journal, sendRequest, undefined, []),
    );
    expect(outcome.status).toBe("failed");
    expect(outcome.errorKind).toBe("policy_blocked");
    expect(outcome.detail).toContain("folderAllowlist is empty");
    expect(sendRequest).not.toHaveBeenCalled();
  });

  /**
   * THE STATE THAT MAKES THE CONTROL NON-INERT. A provider that supplies no
   * `folderAttribution` (18/19's Jira apply clients — Jira has no folder in
   * its model at all) cannot place a write in a folder, so under a declared
   * folderAllowlist it is refused rather than waved through. The opposite
   * choice — allow when unattributable — would make the field enforced only
   * for providers that happened to opt in, with nothing telling an operator
   * which, i.e. exactly the inert-control shape defect 16 is about.
   */
  it("refuses when the provider supplies NO folderAttribution hook at all — unattributable is not admissible", async () => {
    const sendRequest = vi.fn().mockResolvedValue(okResponse);
    const outcome = await executeMutationPlan(
      buildPlan(),
      buildHandlers(),
      buildDeps(journal, sendRequest, undefined, ["team-a"]),
    );
    expect(outcome.status).toBe("failed");
    expect(outcome.errorKind).toBe("policy_blocked");
    expect(outcome.detail).toContain("cannot attribute");
    expect(sendRequest).not.toHaveBeenCalled();
  });

  it("refuses an explicit 'unknown' attribution, and says so distinctly from the out-of-allowlist case", async () => {
    const sendRequest = vi.fn().mockResolvedValue(okResponse);
    const unknown = await executeMutationPlan(
      buildPlan(),
      buildHandlers({ folderAttribution: () => ({ scope: "unknown" }) }),
      buildDeps(journal, sendRequest, undefined, ["team-a"]),
    );
    const outOfList = await executeMutationPlan(
      buildPlan({ idempotencyKey: "op-folder-out" }),
      buildHandlers(inFolder(["team-z"])),
      buildDeps(journal, sendRequest, undefined, ["team-a"]),
    );
    expect(unknown.errorKind).toBe("policy_blocked");
    expect(outOfList.errorKind).toBe("policy_blocked");
    // The two refusals are distinguishable — neither detail matches the
    // other's assertion, so a test for one cannot pass on the other.
    expect(unknown.detail).toContain("cannot attribute");
    expect(unknown.detail).not.toContain("outside this connection's folderAllowlist");
    expect(outOfList.detail).not.toContain("cannot attribute");
    expect(sendRequest).not.toHaveBeenCalled();
  });

  it("refuses an 'outside-folders' attribution, and says so distinctly from the unattributable case", async () => {
    const sendRequest = vi.fn().mockResolvedValue(okResponse);
    const outcome = await executeMutationPlan(
      buildPlan(),
      buildHandlers({ folderAttribution: () => ({ scope: "outside-folders" }) }),
      buildDeps(journal, sendRequest, undefined, ["team-a"]),
    );
    expect(outcome.status).toBe("failed");
    expect(outcome.errorKind).toBe("policy_blocked");
    expect(outcome.detail).toContain("does not target a folder");
    expect(outcome.detail).not.toContain("cannot attribute");
    expect(sendRequest).not.toHaveBeenCalled();
  });

  it("treats an EMPTY attributed folder list as unattributable rather than vacuously admissible", async () => {
    // `folders: []` would satisfy "every attributed folder is a member"
    // vacuously — the classic empty-quantifier hole. It is refused.
    const sendRequest = vi.fn().mockResolvedValue(okResponse);
    const outcome = await executeMutationPlan(
      buildPlan(),
      buildHandlers(inFolder([])),
      buildDeps(journal, sendRequest, undefined, ["team-a"]),
    );
    expect(outcome.status).toBe("failed");
    expect(outcome.errorKind).toBe("policy_blocked");
    expect(outcome.detail).toContain("cannot attribute");
    expect(sendRequest).not.toHaveBeenCalled();
  });

  /**
   * Same ruling as the tenant check, pinned separately because it is a
   * different code path: the refusal is NOT journalled, so an operator who
   * fixes the allowlist can retry the same idempotencyKey. Both halves are
   * asserted — zero appends, and the retry actually succeeds.
   */
  it("writes NOTHING to the journal for a refusal, and does not poison the idempotencyKey", async () => {
    const appendSpy = vi.spyOn(journal, "appendEntry");
    const plan = buildPlan({ idempotencyKey: "op-folder-retry" });

    const refused = await executeMutationPlan(
      plan,
      buildHandlers(inFolder(["team-z"])),
      buildDeps(journal, vi.fn().mockResolvedValue(okResponse), undefined, ["team-a"]),
    );
    expect(refused.errorKind).toBe("policy_blocked");
    expect(appendSpy).toHaveBeenCalledTimes(0);

    const sendRequest = vi.fn().mockResolvedValue(okResponse);
    const retried = await executeMutationPlan(
      plan,
      buildHandlers(inFolder(["team-z"])),
      buildDeps(journal, sendRequest, undefined, ["team-a", "team-z"]),
    );
    expect(retried).toEqual({ status: "recorded", appliedRevision: "rev-1" });
    expect(sendRequest).toHaveBeenCalledTimes(1);
  });

  it("refuses even a replay of an already-recorded operation once the allowlist no longer admits its folder", async () => {
    const plan = buildPlan({ idempotencyKey: "op-folder-tighten" });
    const first = await executeMutationPlan(
      plan,
      buildHandlers(inFolder(["team-a"])),
      buildDeps(journal, vi.fn().mockResolvedValue(okResponse), undefined, ["team-a"]),
    );
    expect(first.status).toBe("recorded");

    const sendRequest = vi.fn().mockResolvedValue(okResponse);
    const afterTightening = await executeMutationPlan(
      plan,
      buildHandlers(inFolder(["team-a"])),
      buildDeps(journal, sendRequest, undefined, ["team-b"]),
    );
    expect(afterTightening.status).toBe("failed");
    expect(afterTightening.errorKind).toBe("policy_blocked");
    expect(sendRequest).not.toHaveBeenCalled();
  });

  /**
   * ORDERING. The tenant check runs first, so a plan that fails BOTH is
   * reported as a tenant refusal. Pinned because the alternative order would
   * change what an operator sees for the commonest misconfiguration, and
   * because it proves neither check absorbed the other.
   */
  it("reports the TENANT refusal when a plan is outside both allowlists", async () => {
    const sendRequest = vi.fn().mockResolvedValue(okResponse);
    const outcome = await executeMutationPlan(
      buildPlan({ tenant: "tenant-b" }),
      buildHandlers(inFolder(["team-z"])),
      buildDeps(journal, sendRequest, ["tenant-a"], ["team-a"]),
    );
    expect(outcome.errorKind).toBe("policy_blocked");
    expect(outcome.detail).toContain("tenantAllowlist");
    expect(outcome.detail).not.toContain("folderAllowlist");
    expect(sendRequest).not.toHaveBeenCalled();
  });
});
