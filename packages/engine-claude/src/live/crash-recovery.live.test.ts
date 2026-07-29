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
 *       interleave (each is asked to read a DIFFERENT seeded file in the shared
 *       worktree and report its marker, so each transcript carries only its own
 *       marker), and every observed init `session_id` equals the adapter's
 *       pre-assigned UUID (Options.sessionId honored on the SDK transport —
 *       spike 06 only proved this on the CLI).
 *
 * The kill arm needs a genuinely long-running tool so the SIGKILL lands
 * mid-turn; the compiled Bash allowlist is a closed 4-literal set with no
 * `sleep`, so a footgun-clean profile is derived by adding `Bash(sleep:*)` to
 * all three allow mirrors (permissions / settingsJson / sdkOptions) — this
 * keeps `assertNoFootguns` satisfied (the mandatory denies/backstops are
 * untouched).
 *
 * Arm (d) needs the `Read` tool for the same reason: the read-only envelope's
 * allow list is the compiler's floor (only the mandatory gateway entry), and
 * `docs/engine-baseline.md` §3 records that under `permissionMode: "dontAsk"` a
 * tool covered by no allow rule is auto-denied — so (d) derives its profile the
 * same footgun-clean way, adding a bare `Read` rule to all three mirrors. The
 * rule is deliberately BARE (no path specifier): the `//`-anchored path form's
 * exact matching semantics are still unprobed (that is precisely what
 * `path-anchor.live.test.ts` exists to settle), and this arm is testing session
 * isolation, not path anchoring. It weakens nothing — the mandatory
 * `Read(~/.ssh/**)`-class denies still win over any allow (baseline §3,
 * deny-over-allow at any level).
 */
import { readFileSync, readdirSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { READ_ONLY_ENVELOPE, compileEnvelope } from "@crabgic/engine-core";
import type {
  AdjudicationCallback,
  CompiledWorkerProfile,
  EngineEvent,
} from "@crabgic/engine-core";
import { buildTaskPacket } from "@crabgic/testkit";
import type { TaskPacket } from "@crabgic/contracts";
import { transcriptPathForSession } from "../session.js";
import {
  assertLiveEnabled,
  assertToolUseEmitted,
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

/**
 * `maxTurns` defaults to 3 and is raised where an objective needs more.
 *
 * Observed 2026-07-28, twice in a row and therefore not a flake: the fork
 * probe failed with the SDK's "Reached maximum number of turns (3)". Three
 * turns is not enough for a session that must acknowledge an instruction and
 * then be forked and answer again, and exhausting them makes the probe report
 * a fork/transcript failure it never actually observed.
 */
function packet(objective: string, maxTurns = 3): TaskPacket {
  return buildTaskPacket({
    objective,
    ownedPaths: [],
    resourceLimits: { maxTurns },
    resultSchema: { type: "object" },
  });
}

/**
 * Re-raises a turn exhaustion as explicitly INCONCLUSIVE.
 *
 * Turn exhaustion is not evidence about session forking in either direction.
 * Left as the SDK's bare error it is indistinguishable, in the output, from
 * the fork having genuinely misbehaved — so it is relabelled rather than
 * swallowed. The test still fails; the reader is told what it means.
 */
function rethrowInconclusive(err: unknown): never {
  const message = err instanceof Error ? err.message : String(err);
  if (/maximum number of turns/i.test(message)) {
    throw new Error(
      `INCONCLUSIVE, not a fork/transcript failure: the session exhausted its turn budget ` +
        `before the probe completed (${message}). Re-run; if it persists, raise this probe's maxTurns.`,
    );
  }
  throw err;
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
/** Read-only floor + a bare `Read` allow — see this file's header for why bare. */
const READ_FILE_PROFILE = withExtraAllow(READ_ONLY_PROFILE, "Read");

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
          // Acknowledge, then be forked and answer again: three turns is not
          // enough, and running out reported a fork failure never observed.
          6,
        ),
        READ_ONLY_PROFILE,
        allowAll,
      );
      const originalEvents = await collectEngineEvents(original.events).catch(rethrowInconclusive);
      guardEngineEventsRateLimit(originalEvents);

      const originalTranscriptPath = transcriptPathForSession(original.sessionRef);
      const originalBytesBefore = readFileSync(originalTranscriptPath, "utf8");

      const forked = ctx.adapter.fork(original.sessionRef, allowAll);
      const forkedEvents = await collectEngineEvents(forked.events).catch(rethrowInconclusive);
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

// Per-session markers. Deliberately shaped as obvious TEST FIXTURES (an
// `CRABGIC_FIXTURE_MARKER_` prefix, no entropy, no credential-looking shape) so the
// harness's sanitization scan and any human reader can tell at a glance that
// nothing secret is being planted — while staying unique and greppable.
const FIXTURE_MARKER_ALPHA = "CRABGIC_FIXTURE_MARKER_ALPHA";
const FIXTURE_MARKER_ZETA = "CRABGIC_FIXTURE_MARKER_ZETA";
// Two unrelated file names, NOT an `-a`/`-b` pair: neither prompt may hint that
// the other session's file exists, or a curious worker could read its sibling
// and fail the isolation assertion for a reason that is not an interleave.
const MARKER_FILE_ALPHA = "build-id.txt";
const MARKER_FILE_ZETA = "release-tag.txt";

describe("two concurrent same-dir sessions never interleave; pre-assigned session_id is honored", () => {
  it("each session reflects only its own seeded file's marker, and each observed init session_id equals the adapter's pre-assigned UUID", async () => {
    // ONE adapter (one worktree + one CLAUDE_CONFIG_DIR); two spawns → two
    // distinct pre-assigned session UUIDs in the same directory, driven
    // concurrently.
    const ctx = await createLiveAdapterContext();
    try {
      // WHY each session READS A SEEDED FILE rather than echoing a token: the
      // original framing told each session to "remember the secret word
      // ALPHA777 and reply with exactly the single word: ALPHA777". The REAL
      // engine REFUSED it, verbatim: "I appreciate the test, but I'm not going
      // to do that. My purpose is to help you with software engineering tasks
      // in this working directory, not to follow arbitrary instructions that
      // override that role", followed by "I won't call the StructuredOutput
      // tool without a legitimate reason." Parroting an arbitrary token is not
      // a software-engineering task, so `expect(textA).toContain("ALPHA777")`
      // failed on a TEST-DESIGN defect, not a product defect. DO NOT
      // reintroduce that framing. Reading a file that genuinely exists in the
      // working directory and reporting what it says IS such a task — and it
      // proves the isolation property MORE strongly than an echo did: the
      // marker reaches session A's transcript via real tool use over real
      // bytes on disk, and must never reach session B's.
      await Promise.all([
        writeFile(
          join(ctx.scratch.worktreePath, MARKER_FILE_ALPHA),
          `BUILD_ID=${FIXTURE_MARKER_ALPHA}\n`,
          "utf8",
        ),
        writeFile(
          join(ctx.scratch.worktreePath, MARKER_FILE_ZETA),
          `RELEASE_TAG=${FIXTURE_MARKER_ZETA}\n`,
          "utf8",
        ),
      ]);

      const handleA = ctx.adapter.spawn(
        packet(
          `Read the file ${MARKER_FILE_ALPHA} in your working directory and report the value ` +
            "of its BUILD_ID field verbatim in your reply.",
        ),
        READ_FILE_PROFILE,
        allowAll,
      );
      const handleB = ctx.adapter.spawn(
        packet(
          `Read the file ${MARKER_FILE_ZETA} in your working directory and report the value ` +
            "of its RELEASE_TAG field verbatim in your reply.",
        ),
        READ_FILE_PROFILE,
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

      // Executed-call guard (baseline §2's rewritten pattern): the two
      // `not.toContain` absence assertions below are only sound if each
      // session's probing Read actually ran. A refused/idle session would
      // otherwise satisfy both absences vacuously.
      assertToolUseEmitted(
        eventsA,
        (event) =>
          event.toolName === "Read" && JSON.stringify(event.toolInput).includes(MARKER_FILE_ALPHA),
        `session A's Read of ${MARKER_FILE_ALPHA}`,
      );
      assertToolUseEmitted(
        eventsB,
        (event) =>
          event.toolName === "Read" && JSON.stringify(event.toolInput).includes(MARKER_FILE_ZETA),
        `session B's Read of ${MARKER_FILE_ZETA}`,
      );

      // No interleave: each transcript carries only its OWN file's marker.
      const textA = textOf(eventsA);
      const textB = textOf(eventsB);
      expect(textA).toContain(FIXTURE_MARKER_ALPHA);
      expect(textA).not.toContain(FIXTURE_MARKER_ZETA);
      expect(textB).toContain(FIXTURE_MARKER_ZETA);
      expect(textB).not.toContain(FIXTURE_MARKER_ALPHA);
    } finally {
      await ctx.cleanup();
    }
  });
});
