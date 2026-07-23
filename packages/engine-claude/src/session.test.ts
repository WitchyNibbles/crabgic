/**
 * roadmap/06-claude-engine-adapter.md §Test plan, Property: "SessionRef/
 * worktree round-trip — for any generated UUID + worktree pair (fast-
 * check), `resume(sessionRef, adjudicate)` reconnects to that exact pair,
 * never a substituted one." Plus example tests for `createSessionRef`/
 * `transcriptPathForSession` (docs/engine-baseline.md §7's confirmed
 * munged-cwd pattern).
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fc from "fast-check";
import { createJournalStore, type JournalStore } from "@eo/journal";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import type { ClaudeEngineAdapterConfig, SdkQueryFunction } from "./adapter-config.js";
import { ClaudeEngineAdapter } from "./adapter.js";
import { createSessionRef, transcriptPathForSession, InvalidSessionIdError } from "./session.js";

// ---------------------------------------------------------------------------
// createSessionRef — examples
// ---------------------------------------------------------------------------

describe("createSessionRef", () => {
  it("generates a fresh UUID sessionId when none is supplied", () => {
    const ref = createSessionRef({ worktreePath: "/w", configDir: "/c" });
    expect(ref.sessionId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
    expect(ref.projectDirectory).toBe("/w");
    expect(ref.worktreePath).toBe("/w");
    expect(ref.configDir).toBe("/c");
  });

  it("honors an explicit valid sessionId", () => {
    const ref = createSessionRef({
      worktreePath: "/w",
      configDir: "/c",
      sessionId: "11111111-1111-4111-8111-111111111111",
    });
    expect(ref.sessionId).toBe("11111111-1111-4111-8111-111111111111");
  });

  it("throws InvalidSessionIdError for a malformed sessionId", () => {
    expect(() =>
      createSessionRef({ worktreePath: "/w", configDir: "/c", sessionId: "not-a-uuid" }),
    ).toThrow(InvalidSessionIdError);
  });

  it("projectDirectory always equals worktreePath", () => {
    const ref = createSessionRef({ worktreePath: "/some/deep/worktree", configDir: "/c" });
    expect(ref.projectDirectory).toBe(ref.worktreePath);
  });
});

// ---------------------------------------------------------------------------
// transcriptPathForSession — docs/engine-baseline.md §7 munging examples.
// ---------------------------------------------------------------------------

describe("transcriptPathForSession (docs/engine-baseline.md §7)", () => {
  it("builds <configDir>/projects/<munged-cwd>/<sessionId>.jsonl", () => {
    const ref = createSessionRef({
      worktreePath: "/a/b/c",
      configDir: "/config",
      sessionId: "22222222-2222-4222-8222-222222222222",
    });
    expect(transcriptPathForSession(ref)).toBe(
      "/config/projects/-a-b-c/22222222-2222-4222-8222-222222222222.jsonl",
    );
  });

  it("munges a deeper absolute path the same way", () => {
    const ref = createSessionRef({
      worktreePath: "/home/eimi/projects/crabgic",
      configDir: "/isolated/claude-config",
      sessionId: "33333333-3333-4333-8333-333333333333",
    });
    expect(transcriptPathForSession(ref)).toBe(
      "/isolated/claude-config/projects/-home-eimi-projects-crabgic/33333333-3333-4333-8333-333333333333.jsonl",
    );
  });
});

// ---------------------------------------------------------------------------
// PROPERTY: SessionRef/worktree round-trip through the REAL adapter's
// resume() — never a substituted worktree/configDir/sessionId.
// ---------------------------------------------------------------------------

function initMessage(sessionId: string, cwd: string): SDKMessage {
  return {
    type: "system",
    subtype: "init",
    apiKeySource: "user",
    claude_code_version: "2.1.210",
    cwd,
    tools: [],
    mcp_servers: [],
    model: "claude-haiku-4-5-20251001",
    permissionMode: "dontAsk",
    slash_commands: [],
    output_style: "default",
    skills: [],
    plugins: [],
    uuid: "44444444-4444-4444-4444-444444444444",
    session_id: sessionId,
  } as unknown as SDKMessage;
}

/** Safe absolute-path segments: alnum/dash/underscore only, no `..`/`~`/glob metacharacters. */
const pathSegmentArb = fc.stringMatching(/^[a-zA-Z0-9_-]{1,10}$/);
// >= 2 non-empty segments: a real worktree/worker-tmp is always at least that
// deep, and `substituteWorktreePlaceholders` now refuses a root-level /
// near-root path (Finding 4 minimum-depth defense).
const absoluteWorktreeArb = fc
  .array(pathSegmentArb, { minLength: 2, maxLength: 4 })
  .map((segments) => `/${segments.join("/")}`);

let journalDir: string;
let store: JournalStore;

beforeAll(async () => {
  journalDir = await mkdtemp(join(tmpdir(), "eo-engine-claude-session-property-"));
  store = createJournalStore({ journalDir });
});

afterAll(async () => {
  await rm(journalDir, { recursive: true, force: true });
});

async function allowAdjudicate(
  _toolName: string,
  toolInput: Readonly<Record<string, unknown>>,
): Promise<{
  readonly behavior: "allow";
  readonly updatedInput: Readonly<Record<string, unknown>>;
}> {
  return { behavior: "allow", updatedInput: toolInput };
}

describe("PROPERTY: resume(sessionRef, adjudicate) reconnects the exact (sessionId, worktree, configDir) triple", () => {
  it("never substitutes a different sessionId/cwd/configDir than the ones sessionRef itself names", async () => {
    // The adapter's OWN construction-time config deliberately names a
    // DIFFERENT worktree/configDir than any generated pair below — proving
    // resume() uses `sessionRef`'s own fields, never falling back to
    // `this.config`.
    const DECOY_CONFIG: ClaudeEngineAdapterConfig = {
      // >= 2 non-empty segments so `workerTmp`/`worktreePath` pass the
      // Finding 4 minimum-depth validation (these decoy values still differ
      // from every generated pair, which is all this property needs).
      worktreePath: "/decoy/adapter-worktree",
      provisioning: {
        HOME: "/decoy/home",
        TMP: "/decoy/tmp",
        CLAUDE_CONFIG_DIR: "/decoy/config-dir",
      },
      auth: { kind: "oauthToken", token: "test-token" },
      journal: store,
      engineVersionResolver: () => "2.1.210",
    };

    await fc.assert(
      fc.asyncProperty(
        fc.uuid(),
        absoluteWorktreeArb,
        absoluteWorktreeArb,
        async (sessionId, worktreePath, configDir) => {
          const calls: Array<{
            readonly cwd: string | undefined;
            readonly resume: string | undefined;
            readonly env: Record<string, string | undefined> | undefined;
          }> = [];
          const sdkQuery: SdkQueryFunction = (params) => {
            calls.push({
              cwd: params.options?.cwd,
              resume: params.options?.resume,
              env: params.options?.env,
            });
            return (async function* (): AsyncGenerator<SDKMessage, void, unknown> {
              yield initMessage(sessionId, worktreePath);
            })();
          };

          const adapter = new ClaudeEngineAdapter({ ...DECOY_CONFIG, sdkQuery });
          const sessionRef = { sessionId, projectDirectory: worktreePath, worktreePath, configDir };

          const handle = adapter.resume(sessionRef, allowAdjudicate);
          await handle.events[Symbol.asyncIterator]().next();

          const call = calls[0];
          expect(call?.resume).toBe(sessionId);
          expect(call?.cwd).toBe(worktreePath);
          expect(call?.env?.CLAUDE_CONFIG_DIR).toBe(configDir);
        },
      ),
      { numRuns: 1000 },
    );
  });
});
