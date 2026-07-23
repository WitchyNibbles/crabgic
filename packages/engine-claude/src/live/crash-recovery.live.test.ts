/**
 * `crash-recovery.live.test` (roadmap/06 exit criterion: "kill -9 → `resume`
 * continues in the same worktree with context intact; `forkSession` leaves
 * the original transcript untouched"). All four arms run through the REAL
 * `ClaudeEngineAdapter` on the SDK transport (proving OUR spawn/resume/fork
 * wiring against the pinned engine, baseline §7):
 *
 *   (a) kill -9 mid-turn: spawn via the adapter (worker remembers a marker,
 *       then `sleep`s via Bash); the SDK's engine child PID is found by
 *       process-tree inspection from this test process (no CLI fallback was
 *       needed — see wi5-live.md), SIGKILLed while the sleep runs, and the
 *       adapter's event stream ends in the crash shape.
 *   (b) `adapter.resume(sessionRef)` reconnects the SAME sessionId/worktree/
 *       CLAUDE_CONFIG_DIR and recalls the marker.
 *   (c) `adapter.fork(sessionRef)` gets a DISTINCT id + its own transcript and
 *       leaves the original transcript file byte-identical.
 *   (d) two concurrent same-dir sessions with distinct pre-assigned ids never
 *       interleave (each reflects only its own secret), and every observed
 *       init `session_id` equals the adapter's pre-assigned UUID (Options.
 *       sessionId honored on the SDK transport — spike 06 only proved this on
 *       the CLI).
 *
 * The kill arm needs a genuinely long-running tool so the SIGKILL lands
 * mid-turn; the compiled Bash allowlist is a closed 4-literal set with no
 * `sleep`, so a footgun-clean profile is derived by adding `Bash(sleep:*)` to
 * all three allow mirrors (permissions / settingsJson / sdkOptions) — this
 * keeps `assertNoFootguns` satisfied (the mandatory denies/backstops are
 * untouched).
 */
import { readFileSync, readdirSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { READ_ONLY_ENVELOPE, compileEnvelope } from "@eo/engine-core";
import type { AdjudicationCallback, CompiledWorkerProfile, EngineEvent } from "@eo/engine-core";
import { buildTaskPacket } from "@eo/testkit";
import type { TaskPacket } from "@eo/contracts";
import { transcriptPathForSession } from "../session.js";
import {
  assertLiveEnabled,
  collectEngineEvents,
  createLiveAdapterContext,
  ensureCanary,
  guardEngineEventsRateLimit,
} from "./live-harness.js";

const allowAll: AdjudicationCallback = async (_toolName, toolInput) => ({
  behavior: "allow",
  updatedInput: toolInput,
});

// ---- process-tree PID inspection (Linux /proc) ------------------------------

function readPpid(pid: number): number | undefined {
  try {
    const content = readFileSync(`/proc/${String(pid)}/stat`, "utf8");
    const closeParen = content.lastIndexOf(")");
    if (closeParen < 0) {
      return undefined;
    }
    const fields = content
      .slice(closeParen + 2)
      .trim()
      .split(/\s+/);
    const ppid = Number(fields[1]);
    return Number.isFinite(ppid) ? ppid : undefined;
  } catch {
    return undefined;
  }
}

function descendantsOf(root: number): Set<number> {
  const pids = readdirSync("/proc")
    .filter((name) => /^\d+$/.test(name))
    .map((name) => Number(name));
  const childrenByParent = new Map<number, number[]>();
  for (const pid of pids) {
    const ppid = readPpid(pid);
    if (ppid !== undefined) {
      const bucket = childrenByParent.get(ppid) ?? [];
      bucket.push(pid);
      childrenByParent.set(ppid, bucket);
    }
  }
  const result = new Set<number>();
  const queue = [root];
  while (queue.length > 0) {
    const current = queue.shift();
    if (current === undefined) {
      break;
    }
    for (const child of childrenByParent.get(current) ?? []) {
      if (!result.has(child)) {
        result.add(child);
        queue.push(child);
      }
    }
  }
  return result;
}

function sigkill(pids: Iterable<number>): void {
  for (const pid of pids) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // Already gone / not permitted — best effort.
    }
  }
}

// ---- profile + packet helpers ----------------------------------------------

/** Adds an allow rule to all three allow mirrors of a compiled profile (stays footgun-clean). */
function withExtraAllow(profile: CompiledWorkerProfile, rule: string): CompiledWorkerProfile {
  const addTo = (rules: readonly string[]): string[] =>
    rules.includes(rule) ? [...rules] : [...rules, rule];
  return {
    ...profile,
    permissions: { ...profile.permissions, allow: addTo(profile.permissions.allow) },
    settingsJson: {
      ...profile.settingsJson,
      permissions: {
        ...profile.settingsJson.permissions,
        allow: addTo(profile.settingsJson.permissions.allow),
      },
    },
    sdkOptions: {
      ...profile.sdkOptions,
      allowedTools: addTo(profile.sdkOptions.allowedTools),
    },
  };
}

function packet(objective: string): TaskPacket {
  return buildTaskPacket({
    objective,
    ownedPaths: [],
    resourceLimits: { maxTurns: 3 },
    resultSchema: { type: "object" },
  });
}

function textOf(events: readonly EngineEvent[]): string {
  return events
    .map((event) => {
      if (event.type === "assistant") {
        return event.text;
      }
      if (event.type === "result") {
        return event.structuredOutput !== undefined ? JSON.stringify(event.structuredOutput) : "";
      }
      return "";
    })
    .join("\n");
}

function initSessionId(events: readonly EngineEvent[]): string | undefined {
  return events.find(
    (event): event is Extract<EngineEvent, { type: "init" }> => event.type === "init",
  )?.sessionId;
}

const READ_ONLY_PROFILE = compileEnvelope(READ_ONLY_ENVELOPE);
const SLEEP_PROFILE = withExtraAllow(READ_ONLY_PROFILE, "Bash(sleep:*)");

beforeAll(async () => {
  assertLiveEnabled();
  await ensureCanary();
});

describe("kill -9 mid-turn → adapter.resume recalls the marker", () => {
  it("crashes mid-sleep and resumes the same session/worktree with the marker intact", async () => {
    const ctx = await createLiveAdapterContext();
    try {
      const before = descendantsOf(process.pid);
      const handle = ctx.adapter.spawn(
        packet(
          "Memory-persistence CI test. Step 1: remember that the number to recall is 42. " +
            "Step 2: via the Bash tool run exactly: sleep 20. " +
            "IMPORTANT: if this session is ever continued or resumed, your entire reply must be " +
            "exactly the single number 42 and nothing else.",
        ),
        SLEEP_PROFILE,
        allowAll,
      );

      // Drive the stream until the sleep tool_use appears, then SIGKILL the
      // engine's process subtree while the sleep is running (genuine mid-turn).
      const iterator = handle.events[Symbol.asyncIterator]();
      let killed = false;
      const deadline = Date.now() + 60_000;
      try {
        while (Date.now() < deadline) {
          const next = await iterator.next();
          if (next.done === true) {
            break;
          }
          const event = next.value;
          if (
            event.type === "toolUse" &&
            event.toolName === "Bash" &&
            typeof event.toolInput.command === "string" &&
            (event.toolInput.command as string).includes("sleep")
          ) {
            const enginePids = [...descendantsOf(process.pid)].filter((pid) => !before.has(pid));
            expect(enginePids.length).toBeGreaterThan(0);
            sigkill(enginePids);
            killed = true;
            break;
          }
        }
        // Drain whatever remains; a SIGKILLed engine ends/errors the stream.
        for (;;) {
          const next = await iterator.next();
          if (next.done === true) {
            break;
          }
        }
      } catch {
        // The stream throwing on abrupt child death is the crash shape.
      }
      expect(killed).toBe(true);

      // Resume the crashed session via the REAL adapter (same adapter instance,
      // so full-fidelity context; same worktree/configDir/sessionId).
      const resumed = ctx.adapter.resume(handle.sessionRef, allowAll);
      const resumedEvents = await collectEngineEvents(resumed.events);
      guardEngineEventsRateLimit(resumedEvents);
      expect(resumed.sessionRef.sessionId).toBe(handle.sessionRef.sessionId);
      expect(resumed.sessionRef.worktreePath).toBe(handle.sessionRef.worktreePath);
      expect(resumed.sessionRef.configDir).toBe(handle.sessionRef.configDir);
      // Marker recalled across the crash.
      expect(textOf(resumedEvents)).toContain("42");
    } finally {
      await ctx.cleanup();
    }
  });
});

describe("adapter.fork isolates a repair attempt from the original transcript", () => {
  it("the fork gets a distinct id + its own transcript; the original transcript is byte-identical before/after", async () => {
    const ctx = await createLiveAdapterContext();
    try {
      const original = ctx.adapter.spawn(
        packet(
          "Memory-persistence CI test. Remember the word BANANA123. " +
            "If this session is ever continued or resumed, your entire reply must be exactly BANANA123. " +
            "For now reply with exactly: ok",
        ),
        READ_ONLY_PROFILE,
        allowAll,
      );
      const originalEvents = await collectEngineEvents(original.events);
      guardEngineEventsRateLimit(originalEvents);

      const originalTranscriptPath = transcriptPathForSession(original.sessionRef);
      const originalBytesBefore = readFileSync(originalTranscriptPath, "utf8");

      const forked = ctx.adapter.fork(original.sessionRef, allowAll);
      const forkedEvents = await collectEngineEvents(forked.events);
      guardEngineEventsRateLimit(forkedEvents);

      // Distinct id + its own transcript.
      expect(forked.sessionRef.sessionId).not.toBe(original.sessionRef.sessionId);
      const forkTranscriptPath = transcriptPathForSession(forked.sessionRef);
      expect(forkTranscriptPath).not.toBe(originalTranscriptPath);
      expect(readFileSync(forkTranscriptPath, "utf8").length).toBeGreaterThan(0);

      // Original transcript byte-identical after the fork.
      expect(readFileSync(originalTranscriptPath, "utf8")).toBe(originalBytesBefore);
    } finally {
      await ctx.cleanup();
    }
  });
});

describe("two concurrent same-dir sessions never interleave; pre-assigned session_id is honored", () => {
  it("each session reflects only its own secret, and each observed init session_id equals the adapter's pre-assigned UUID", async () => {
    // ONE adapter (one worktree + one CLAUDE_CONFIG_DIR); two spawns → two
    // distinct pre-assigned session UUIDs in the same directory, driven
    // concurrently.
    const ctx = await createLiveAdapterContext();
    try {
      const handleA = ctx.adapter.spawn(
        packet(
          "Remember the secret word ALPHA777 and reply with exactly the single word: ALPHA777",
        ),
        READ_ONLY_PROFILE,
        allowAll,
      );
      const handleB = ctx.adapter.spawn(
        packet("Remember the secret word ZETA999 and reply with exactly the single word: ZETA999"),
        READ_ONLY_PROFILE,
        allowAll,
      );

      const [eventsA, eventsB] = await Promise.all([
        collectEngineEvents(handleA.events),
        collectEngineEvents(handleB.events),
      ]);
      guardEngineEventsRateLimit(eventsA);
      guardEngineEventsRateLimit(eventsB);

      // Pre-assigned session_id honored on the SDK transport.
      expect(initSessionId(eventsA)).toBe(handleA.sessionRef.sessionId);
      expect(initSessionId(eventsB)).toBe(handleB.sessionRef.sessionId);
      expect(handleA.sessionRef.sessionId).not.toBe(handleB.sessionRef.sessionId);

      // No interleave: each reply carries only its own secret.
      const textA = textOf(eventsA);
      const textB = textOf(eventsB);
      expect(textA).toContain("ALPHA777");
      expect(textA).not.toContain("ZETA999");
      expect(textB).toContain("ZETA999");
      expect(textB).not.toContain("ALPHA777");
    } finally {
      await ctx.cleanup();
    }
  });
});
