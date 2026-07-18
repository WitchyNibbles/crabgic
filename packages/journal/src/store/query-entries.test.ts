import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { JOURNAL_ENTRY_TYPES, type JournalEntryType } from "@eo/contracts";
import { afterEach, describe, expect, it } from "vitest";
import type { JournalEntryInput } from "../codec/journal-entry.js";
import { appendEntry } from "./append-entry.js";
import { createNodeFsPort } from "./fs-port.js";
import { queryEntries } from "./query-entries.js";
import { segmentPath } from "./segment-layout.js";
import { resolveStoreConfig, type JournalStoreConfig } from "./store-config.js";

const RUN_A = "11111111-1111-4111-8111-111111111111";
const RUN_B = "22222222-2222-4222-8222-222222222222";
const CHANGE_SET_A = "33333333-3333-4333-8333-333333333333";
const WORK_UNIT_A = "44444444-4444-4444-8444-444444444444";

let journalDir: string | undefined;

function freshConfig(): JournalStoreConfig {
  journalDir = mkdtempSync(join(tmpdir(), "eo-journal-query-"));
  return resolveStoreConfig({ journalDir });
}

afterEach(() => {
  if (journalDir !== undefined) rmSync(journalDir, { recursive: true, force: true });
  journalDir = undefined;
});

/** One representative, schema-valid input per JournalEntryType — mirrors codec/journal-entry.test.ts's fixture table, scoped to what appendEntry needs (no envelope fields). */
const SAMPLE_INPUTS: Record<JournalEntryType, JournalEntryInput> = {
  run_transition: { type: "run_transition", payload: { from: "draft", to: "awaiting_approval" } },
  work_unit_transition: { type: "work_unit_transition", payload: { status: "pending" } },
  adjudication_decision: {
    type: "adjudication_decision",
    payload: { decision: "approved", rationale: "ok" },
  },
  remote_operation_record: {
    type: "remote_operation_record",
    payload: {
      schemaVersion: 1,
      id: "55555555-5555-4555-8555-555555555555",
      remoteMutationPlanId: "66666666-6666-4666-8666-666666666666",
      operationId: "op-1",
      contentHash: "sha256:x",
      status: "pending",
      recordedAt: "2026-01-01T00:00:00.000Z",
    },
  },
  evidence_pointer: {
    type: "evidence_pointer",
    payload: {
      schemaVersion: 1,
      id: "77777777-7777-4777-8777-777777777777",
      changeSetId: CHANGE_SET_A,
      command: "npm test",
      exitStatus: 0,
      toolchainFingerprint: "node@24.18.0",
      capturedAt: "2026-01-01T00:00:00.000Z",
      artifactDigests: ["sha256:artifact"],
      objectId: "0000000000000000000000000000000000000a",
    },
  },
  session_assignment: {
    type: "session_assignment",
    payload: { sessionId: "88888888-8888-4888-8888-888888888888" },
  },
  git_freeze: { type: "git_freeze", payload: { scopePath: "/repo", reason: "merge" } },
  worktree_quarantine: {
    type: "worktree_quarantine",
    payload: { worktreePath: "/repo/.wt", reason: "dirty" },
  },
  cas_ref_update: { type: "cas_ref_update", payload: { ref: "refs/cas/a", objectId: "deadbeef" } },
  approval_token_mint: {
    type: "approval_token_mint",
    payload: { tokenId: "99999999-9999-4999-8999-999999999999", scope: "contract.approve" },
  },
  fanout_rationale: { type: "fanout_rationale", payload: { rationale: "balanced" } },
  milestone_sync: { type: "milestone_sync", payload: { provider: "jira", externalId: "PROJ-1" } },
  learning_transition: {
    type: "learning_transition",
    payload: { from: "observation", to: "reproducer" },
  },
};

async function collect<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const item of iterable) out.push(item);
  return out;
}

describe("queryEntries — fixture journal spanning all 13 JournalEntryType members", () => {
  it("yields every entry, unfiltered, in append order", async () => {
    const config = freshConfig();
    for (const type of JOURNAL_ENTRY_TYPES) {
      await appendEntry(config, SAMPLE_INPUTS[type]);
    }
    const all = await collect(queryEntries(config));
    expect(all).toHaveLength(13);
    expect(all.map((e) => e.type)).toEqual([...JOURNAL_ENTRY_TYPES]);
  });

  it("filters by type", async () => {
    const config = freshConfig();
    for (const type of JOURNAL_ENTRY_TYPES) {
      await appendEntry(config, SAMPLE_INPUTS[type]);
    }
    const onlyEvidence = await collect(queryEntries(config, { type: "evidence_pointer" }));
    expect(onlyEvidence).toHaveLength(1);
    expect(onlyEvidence[0]!.type).toBe("evidence_pointer");
  });

  it("filters by runId, excluding entries correlated to a different run", async () => {
    const config = freshConfig();
    await appendEntry(config, { ...SAMPLE_INPUTS.fanout_rationale, runId: RUN_A });
    await appendEntry(config, { ...SAMPLE_INPUTS.fanout_rationale, runId: RUN_B });
    await appendEntry(config, { ...SAMPLE_INPUTS.fanout_rationale }); // no runId at all

    const runAOnly = await collect(queryEntries(config, { runId: RUN_A }));
    expect(runAOnly).toHaveLength(1);
    expect(runAOnly[0]!.runId).toBe(RUN_A);
  });

  it("filters by changeSetId", async () => {
    const config = freshConfig();
    await appendEntry(config, { ...SAMPLE_INPUTS.evidence_pointer, changeSetId: CHANGE_SET_A });
    await appendEntry(config, {
      ...SAMPLE_INPUTS.fanout_rationale,
      changeSetId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    });

    const filtered = await collect(queryEntries(config, { changeSetId: CHANGE_SET_A }));
    expect(filtered).toHaveLength(1);
    expect(filtered[0]!.type).toBe("evidence_pointer");
  });

  it("filters by workUnitId", async () => {
    const config = freshConfig();
    await appendEntry(config, { ...SAMPLE_INPUTS.work_unit_transition, workUnitId: WORK_UNIT_A });
    await appendEntry(config, { ...SAMPLE_INPUTS.fanout_rationale });

    const filtered = await collect(queryEntries(config, { workUnitId: WORK_UNIT_A }));
    expect(filtered).toHaveLength(1);
    expect(filtered[0]!.type).toBe("work_unit_transition");
  });

  it("combines multiple filter fields (AND semantics)", async () => {
    const config = freshConfig();
    await appendEntry(config, {
      ...SAMPLE_INPUTS.fanout_rationale,
      runId: RUN_A,
      changeSetId: CHANGE_SET_A,
    });
    await appendEntry(config, {
      ...SAMPLE_INPUTS.fanout_rationale,
      runId: RUN_A,
      changeSetId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    });

    const filtered = await collect(
      queryEntries(config, { runId: RUN_A, changeSetId: CHANGE_SET_A }),
    );
    expect(filtered).toHaveLength(1);
  });

  it("evidence_pointer results deserialize as a full EvidenceRecord shape", async () => {
    const config = freshConfig();
    await appendEntry(config, SAMPLE_INPUTS.evidence_pointer);
    const [entry] = await collect(queryEntries(config, { type: "evidence_pointer" }));
    if (entry === undefined || entry.type !== "evidence_pointer") throw new Error("unreachable");
    expect(entry.payload.command).toBe("npm test");
    expect(entry.payload.artifactDigests).toEqual(["sha256:artifact"]);
  });

  it("skips a segment that fails to read (e.g. removed mid-scan) rather than throwing", async () => {
    const config = freshConfig();
    await appendEntry(config, { type: "fanout_rationale", payload: { rationale: "readable" } });
    const unreadablePath = segmentPath(config.segmentsDir, 999);
    const real = createNodeFsPort();
    const flaky = {
      ...real,
      async readFile(path: string): Promise<string> {
        if (path === unreadablePath) throw new Error("simulated read failure");
        return real.readFile(path);
      },
      async readdir(): Promise<readonly string[]> {
        // Report an extra segment index that doesn't actually exist as a readable file.
        const names = await real.readdir(config.segmentsDir);
        return [...names, "segment-00000999.ndjson"];
      },
    };
    const flakyConfig: JournalStoreConfig = { ...config, fs: flaky };

    const all = await collect(queryEntries(flakyConfig));
    expect(all).toHaveLength(1);
    expect(all[0]!.payload).toEqual({ rationale: "readable" });
  });

  it("scans across multiple segments (rotation doesn't break query results)", async () => {
    const config = freshConfig();
    const smallSegmentConfig = resolveStoreConfig({ journalDir: journalDir!, segmentMaxBytes: 1 });
    for (const type of JOURNAL_ENTRY_TYPES) {
      await appendEntry(smallSegmentConfig, SAMPLE_INPUTS[type]);
    }
    const all = await collect(queryEntries(config));
    expect(all).toHaveLength(13);
  });
});
