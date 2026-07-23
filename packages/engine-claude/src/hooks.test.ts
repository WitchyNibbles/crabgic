/**
 * roadmap/06-claude-engine-adapter.md work item 3: PostToolUse audit hook
 * (executed-vs-adjudicated verification) and SessionEnd evidence-capture
 * hook. Both are fail-SAFE (never throw out of the callback) — see
 * `hooks.ts`'s own top-of-file doc comment.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { createJournalStore, type JournalStore } from "@eo/journal";
import type { PostToolUseHookInput, SessionEndHookInput } from "@anthropic-ai/claude-agent-sdk";
import {
  createInMemoryAdjudicationAuditLog,
  createPostToolUseAuditHook,
  createSessionEndEvidenceHook,
  mungeProjectDirectory,
} from "./hooks.js";

const NO_OP_HOOK_OPTIONS = { signal: new AbortController().signal };

function baseHookFields(overrides: { readonly sessionId?: string } = {}) {
  return {
    session_id: overrides.sessionId ?? "session-1",
    transcript_path: "/tmp/does-not-matter.jsonl",
    cwd: "/tmp/does-not-matter",
  };
}

function postToolUseInput(overrides: Partial<PostToolUseHookInput> = {}): PostToolUseHookInput {
  return {
    ...baseHookFields(),
    hook_event_name: "PostToolUse",
    tool_name: "Bash",
    tool_input: { command: "echo hi" },
    tool_response: "hi",
    tool_use_id: "tool-use-1",
    ...overrides,
  };
}

function sessionEndInput(overrides: Partial<SessionEndHookInput> = {}): SessionEndHookInput {
  return {
    ...baseHookFields(),
    hook_event_name: "SessionEnd",
    reason: "other",
    ...overrides,
  };
}

describe("mungeProjectDirectory (docs/engine-baseline.md §7)", () => {
  it("maps '/a/b/c' to '-a-b-c' verbatim, per the baseline's confirmed pattern", () => {
    expect(mungeProjectDirectory("/a/b/c")).toBe("-a-b-c");
  });

  it("maps a deeper absolute path the same way", () => {
    expect(mungeProjectDirectory("/home/eimi/projects/crabgic")).toBe(
      "-home-eimi-projects-crabgic",
    );
  });
});

describe("createInMemoryAdjudicationAuditLog", () => {
  it("hasMatchingAllowedDecision is false before anything is recorded", () => {
    const audit = createInMemoryAdjudicationAuditLog();
    expect(audit.hasMatchingAllowedDecision("Read", { file_path: "x" })).toBe(false);
  });

  it("hasMatchingAllowedDecision is true for a deep-equal recorded allow, keyed by tool name", () => {
    const audit = createInMemoryAdjudicationAuditLog();
    audit.recordAllowedDecision("Read", { file_path: "x.ts" });
    expect(audit.hasMatchingAllowedDecision("Read", { file_path: "x.ts" })).toBe(true);
    expect(audit.hasMatchingAllowedDecision("Read", { file_path: "y.ts" })).toBe(false);
    expect(audit.hasMatchingAllowedDecision("Write", { file_path: "x.ts" })).toBe(false);
  });

  it("recordViolation accumulates into the readonly violations array", () => {
    const audit = createInMemoryAdjudicationAuditLog();
    expect(audit.violations).toHaveLength(0);
    audit.recordViolation({
      toolName: "Bash",
      toolUseId: "id-1",
      executedInput: { command: "rm -rf /" },
      detectedAt: new Date().toISOString(),
    });
    expect(audit.violations).toHaveLength(1);
    expect(audit.violations[0]?.toolName).toBe("Bash");
  });

  it("documents the keying limitation: a structurally-identical second call is indistinguishable from the first", () => {
    const audit = createInMemoryAdjudicationAuditLog();
    audit.recordAllowedDecision("Read", { file_path: "x.ts" });
    // A second, never-independently-adjudicated call with the identical
    // input still reads as "matched" — the documented v1 simplification.
    expect(audit.hasMatchingAllowedDecision("Read", { file_path: "x.ts" })).toBe(true);
  });

  describe("deep-equality edge cases (exercised only via the public recordAllowedDecision/hasMatchingAllowedDecision surface)", () => {
    it("matches nested arrays and objects of identical shape", () => {
      const audit = createInMemoryAdjudicationAuditLog();
      audit.recordAllowedDecision("Edit", {
        paths: ["a.ts", "b.ts"],
        meta: { nested: true, count: 2 },
      });
      expect(
        audit.hasMatchingAllowedDecision("Edit", {
          paths: ["a.ts", "b.ts"],
          meta: { nested: true, count: 2 },
        }),
      ).toBe(true);
    });

    it("does not match arrays of different length", () => {
      const audit = createInMemoryAdjudicationAuditLog();
      audit.recordAllowedDecision("Edit", { paths: ["a.ts", "b.ts"] });
      expect(audit.hasMatchingAllowedDecision("Edit", { paths: ["a.ts"] })).toBe(false);
    });

    it("does not match an array recorded input against a plain-object executed input carrying the same key", () => {
      const audit = createInMemoryAdjudicationAuditLog();
      audit.recordAllowedDecision("Edit", { paths: ["a.ts", "b.ts"] });
      expect(audit.hasMatchingAllowedDecision("Edit", { paths: { 0: "a.ts", 1: "b.ts" } })).toBe(
        false,
      );
    });

    it("does not match objects with a different number of keys", () => {
      const audit = createInMemoryAdjudicationAuditLog();
      audit.recordAllowedDecision("Bash", { command: "echo hi", extra: true });
      expect(audit.hasMatchingAllowedDecision("Bash", { command: "echo hi" })).toBe(false);
    });

    it("does not match objects with the same key COUNT but different key NAMES", () => {
      const audit = createInMemoryAdjudicationAuditLog();
      audit.recordAllowedDecision("Bash", { command: "echo hi" });
      expect(audit.hasMatchingAllowedDecision("Bash", { cmd: "echo hi" })).toBe(false);
    });

    it("does not match primitives of a different type", () => {
      const audit = createInMemoryAdjudicationAuditLog();
      audit.recordAllowedDecision("Bash", { count: 1 });
      expect(audit.hasMatchingAllowedDecision("Bash", { count: "1" })).toBe(false);
    });

    it("does not match null against a non-null object", () => {
      const audit = createInMemoryAdjudicationAuditLog();
      audit.recordAllowedDecision("Bash", { value: null });
      expect(audit.hasMatchingAllowedDecision("Bash", { value: {} })).toBe(false);
    });
  });
});

describe("createPostToolUseAuditHook", () => {
  it("records no violation when the executed input matches a recorded allowed decision", async () => {
    const audit = createInMemoryAdjudicationAuditLog();
    audit.recordAllowedDecision("Bash", { command: "echo hi" });
    const hook = createPostToolUseAuditHook({ audit });

    const result = await hook(postToolUseInput(), "tool-use-1", NO_OP_HOOK_OPTIONS);

    expect(audit.violations).toHaveLength(0);
    expect(result).toEqual({});
  });

  it("does NOT record a violation for a tool with ZERO adjudicated records (static dontAsk authorization is out of audit scope — Finding 2)", async () => {
    const audit = createInMemoryAdjudicationAuditLog();
    // Nothing recorded as allowed for this tool at all — a tool executed
    // under STATIC dontAsk allow-list authorization whose canUseTool bridge
    // never fired is OUT OF the audit's scope, NOT a violation.
    const hook = createPostToolUseAuditHook({ audit });

    await hook(
      postToolUseInput({ tool_input: { command: "rm -rf /" } }),
      "tool-use-1",
      NO_OP_HOOK_OPTIONS,
    );

    expect(audit.violations).toHaveLength(0);
  });

  it("hasAnyAllowedDecision is false before anything is recorded, true once a decision is recorded for that tool", () => {
    const audit = createInMemoryAdjudicationAuditLog();
    expect(audit.hasAnyAllowedDecision("Read")).toBe(false);
    audit.recordAllowedDecision("Read", { file_path: "x.ts" });
    expect(audit.hasAnyAllowedDecision("Read")).toBe(true);
    expect(audit.hasAnyAllowedDecision("Write")).toBe(false);
  });

  it("records an internal audit FAILURE (not a violation) when the audit machinery throws — visible, but does not feed the abort path", async () => {
    let calls = 0;
    const flakyAudit = {
      recordAllowedDecision: () => undefined,
      hasAnyAllowedDecision: () => {
        calls += 1;
        throw new Error("boom");
      },
      hasMatchingAllowedDecision: () => false,
      recordViolation: () => undefined,
      recordAuditFailure: undefined as unknown,
      auditFailures: [] as unknown[],
      violations: [] as unknown[],
    };
    const recorded: unknown[] = [];
    flakyAudit.recordAuditFailure = (failure: unknown) => {
      recorded.push(failure);
    };
    const hook = createPostToolUseAuditHook({ audit: flakyAudit as never });

    await hook(postToolUseInput(), "tool-use-1", NO_OP_HOOK_OPTIONS);

    expect(calls).toBe(1);
    // The internal error is recorded as a FAILURE for visibility, NOT as a
    // violation (which would abort the worker).
    expect(flakyAudit.violations).toHaveLength(0);
    expect(recorded).toHaveLength(1);
  });

  it("records a violation when the tool executed with different input than what was adjudicated", async () => {
    const audit = createInMemoryAdjudicationAuditLog();
    audit.recordAllowedDecision("Bash", { command: "echo safe" });
    const hook = createPostToolUseAuditHook({ audit });

    await hook(
      postToolUseInput({ tool_input: { command: "echo DIFFERENT" } }),
      "tool-use-1",
      NO_OP_HOOK_OPTIONS,
    );

    expect(audit.violations).toHaveLength(1);
  });

  it("ignores non-PostToolUse hook events (no-op, no violation)", async () => {
    const audit = createInMemoryAdjudicationAuditLog();
    const hook = createPostToolUseAuditHook({ audit });

    const result = await hook(sessionEndInput(), undefined, NO_OP_HOOK_OPTIONS);

    expect(audit.violations).toHaveLength(0);
    expect(result).toEqual({});
  });

  it("fail-safe: never throws, even when the audit log itself throws on every call", async () => {
    const hostileAudit = {
      recordAllowedDecision: () => {
        throw new Error("boom");
      },
      hasAnyAllowedDecision: () => {
        throw new Error("boom");
      },
      hasMatchingAllowedDecision: () => {
        throw new Error("boom");
      },
      recordViolation: () => {
        throw new Error("boom");
      },
      recordAuditFailure: () => {
        throw new Error("boom");
      },
      auditFailures: [],
      violations: [],
    };
    const hook = createPostToolUseAuditHook({ audit: hostileAudit });

    await expect(hook(postToolUseInput(), "tool-use-1", NO_OP_HOOK_OPTIONS)).resolves.toEqual({});
  });
});

describe("createSessionEndEvidenceHook", () => {
  let journalDir: string;
  let store: JournalStore;

  beforeEach(async () => {
    journalDir = await mkdtemp(join(tmpdir(), "eo-engine-claude-session-end-"));
    store = createJournalStore({ journalDir });
  });

  afterEach(async () => {
    await rm(journalDir, { recursive: true, force: true });
  });

  it("journals one evidence_pointer entry pointing at the transcript path on SessionEnd", async () => {
    const handle = createSessionEndEvidenceHook({
      journal: store,
      workUnitId: "11111111-1111-4111-8111-111111111111",
      sessionId: "22222222-2222-4222-8222-222222222222",
      projectDirectory: "/a/b/c",
      configDir: "/home/user/.claude-worker",
    });

    await handle.callback(sessionEndInput(), undefined, NO_OP_HOOK_OPTIONS);

    expect(handle.lastError).toBeUndefined();

    const entries: { type: string; payload: { artifactDigests: readonly string[] } }[] = [];
    for await (const entry of store.queryEntries({ type: "evidence_pointer" })) {
      entries.push(
        entry as never as { type: string; payload: { artifactDigests: readonly string[] } },
      );
    }
    expect(entries).toHaveLength(1);
    expect(entries[0]?.payload.artifactDigests).toEqual([
      "/home/user/.claude-worker/projects/-a-b-c/22222222-2222-4222-8222-222222222222.jsonl",
    ]);
  });

  it("stamps the entry's runId/workUnitId envelope fields when runId is provided", async () => {
    const handle = createSessionEndEvidenceHook({
      journal: store,
      runId: "33333333-3333-4333-8333-333333333333",
      workUnitId: "11111111-1111-4111-8111-111111111111",
      sessionId: "22222222-2222-4222-8222-222222222222",
      projectDirectory: "/a/b/c",
      configDir: "/home/user/.claude-worker",
    });

    await handle.callback(sessionEndInput(), undefined, NO_OP_HOOK_OPTIONS);

    const entries: { runId?: string; workUnitId?: string }[] = [];
    for await (const entry of store.queryEntries({ type: "evidence_pointer" })) {
      entries.push(entry as never as { runId?: string; workUnitId?: string });
    }
    expect(entries[0]?.runId).toBe("33333333-3333-4333-8333-333333333333");
    expect(entries[0]?.workUnitId).toBe("11111111-1111-4111-8111-111111111111");
  });

  it("ignores non-SessionEnd hook events (no journal entry written)", async () => {
    const handle = createSessionEndEvidenceHook({
      journal: store,
      workUnitId: "11111111-1111-4111-8111-111111111111",
      sessionId: "22222222-2222-4222-8222-222222222222",
      projectDirectory: "/a/b/c",
      configDir: "/home/user/.claude-worker",
    });

    await handle.callback(postToolUseInput(), "tool-use-1", NO_OP_HOOK_OPTIONS);

    const entries: unknown[] = [];
    for await (const entry of store.queryEntries({ type: "evidence_pointer" })) {
      entries.push(entry);
    }
    expect(entries).toHaveLength(0);
    expect(handle.lastError).toBeUndefined();
  });

  it("fail-safe: a journal append failure never throws out of the hook, and is exposed via lastError", async () => {
    const throwingJournal: JournalStore = {
      appendEntry: () => {
        throw new Error("disk full");
      },
    } as unknown as JournalStore;
    const handle = createSessionEndEvidenceHook({
      journal: throwingJournal,
      workUnitId: "11111111-1111-4111-8111-111111111111",
      sessionId: "22222222-2222-4222-8222-222222222222",
      projectDirectory: "/a/b/c",
      configDir: "/home/user/.claude-worker",
    });

    await expect(
      handle.callback(sessionEndInput(), undefined, NO_OP_HOOK_OPTIONS),
    ).resolves.toEqual({});
    expect(handle.lastError).toBeInstanceOf(Error);
    expect(handle.lastError?.message).toBe("disk full");
  });
});
