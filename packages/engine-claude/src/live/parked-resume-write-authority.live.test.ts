/**
 * `parked-resume-write-authority.live.test` — discharges the probe OWED by the
 * active-park-resume feature (PR #27): "a real engine session, once resumed
 * after a rate-limit park, continues with WRITE authority (not the read-only
 * fallback)."
 *
 * WHAT IS ACTUALLY LOAD-BEARING, and why this is an ADAPTER-level probe:
 * `resumeAttempt({trigger:{kind:"parkResume"}})` (the scheduler's park-resume
 * entry point) does exactly one engine-touching thing — it calls
 * `adapter.resume(sessionRef, adjudicate)`. The `parkResume` trigger only
 * changes SCHEDULER behavior (it skips the repair gate); it does NOT change
 * what `resume` does. Whether the resumed worker can WRITE is governed SOLELY
 * by which `{packet, profile}` `resume` recovers from the adapter's
 * `spawnContexts` map (adapter.ts): the write-capable profile the session was
 * spawned with, or — if the map has no entry — `FALLBACK_SPAWN_CONTEXT`, whose
 * `compileEnvelope(READ_ONLY_ENVELOPE)` profile grants NO write and would make
 * the engine auto-deny `Write` (baseline §3: an unlisted tool under
 * `permissionMode:"dontAsk"` is auto-denied). So the one unproven claim is:
 * does the REAL adapter's `resume`, when the map still holds the session,
 * actually continue with write authority? This probe answers it directly by
 * resuming ON THE SAME ADAPTER INSTANCE and proving the resumed turn's `Write`
 * lands real bytes on disk.
 *
 * That is precisely the same-daemon park-resume path PR #27 ships: the daemon
 * dispatcher RETAINS the spawning adapter (`retainedByRun`) and resumes on it,
 * so `spawnContexts` still holds the write-capable profile. This probe +
 * #27's unit proof that the parkResume path reuses that retained adapter =
 * the full chain, live.
 *
 * HONEST SCOPE — deliberately NOT covered here:
 *   - The cross-process / cross-adapter-instance resume (a daemon RESTART):
 *     `spawnContexts` is in-memory per adapter, so a restart hits
 *     `FALLBACK_SPAWN_CONTEXT` and degrades to READ_ONLY by design. Restart-
 *     safe session context is the ledger's separate carry-forward; this probe
 *     asserts nothing about it.
 *   - Forcing a REAL rate-limit park: a `rejected` limit event has never been
 *     observed live (baseline §8; `rate-limit-fixtures.ts`), and actually
 *     exhausting the subscription is non-deterministic and quota-destroying.
 *     The park/resume WIRING is proven by the fake-engine matrix suite
 *     (`e2e/matrix/orchestration/.../limit-parked-resume-restart.test.ts`);
 *     what only a live run can prove — that OUR adapter's `resume` carries
 *     write authority against the pinned engine — is what this file adds.
 *
 * Like every `*.live.test.ts` it fails RED (never skips) without
 * `CRABGIC_LIVE=1` — `assertLiveEnabled()` throws in `beforeAll`.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { CANONICAL_ENVELOPE_CASES, compileEnvelope } from "@crabgic/engine-core";
import type { AdjudicationCallback, EngineEvent } from "@crabgic/engine-core";
import { createAdjudicationBus } from "@crabgic/supervisor";
import { buildTaskPacket } from "@crabgic/testkit";
import { createEnvelopeAdjudicationPolicy } from "../adjudication-policy.js";
import { substituteWorktreePlaceholders } from "../options-assembler.js";
import { AdjudicationAuditViolationError } from "../adapter.js";
import {
  assertLiveEnabled,
  assertToolUseEmitted,
  collectEngineEvents,
  createLiveAdapterContext,
  ensureCanary,
  guardEngineEventsRateLimit,
} from "./live-harness.js";

const STANDARD_CASE = CANONICAL_ENVELOPE_CASES.find(
  (envelopeCase) => envelopeCase.name === "standard-implementation",
);
if (STANDARD_CASE === undefined) {
  throw new Error("standard-implementation canonical envelope case not found");
}

/** The owned path the resumed worker writes into (matches the standard envelope's grant). */
const OWNED_REL_DIR = "packages/example/src";
const PROBE_REL_PATH = `${OWNED_REL_DIR}/resumed-probe.txt`;
const PROBE_CONTENT = "ok";

/**
 * Collects every `adjudication_decision` journal entry as `{decision, rationale}`.
 * The bus journals an allow as exactly `allowed tool call: <toolName>`, which
 * lets the assertion scope to the driven `Write` alone (an `every(allow)` over
 * ALL decisions would flake on a worker that tries one legitimately-denied
 * command on the way — the same review-caught trap `adjudication-bridge` notes).
 */
async function collectAdjudicationDecisions(
  journal: Awaited<ReturnType<typeof createLiveAdapterContext>>["journal"],
): Promise<readonly { readonly decision: string; readonly rationale: string }[]> {
  const decisions: { readonly decision: string; readonly rationale: string }[] = [];
  for await (const entry of journal.queryEntries({ type: "adjudication_decision" })) {
    const payload = (
      entry as { readonly payload?: { readonly decision?: unknown; readonly rationale?: unknown } }
    ).payload;
    if (typeof payload?.decision === "string") {
      decisions.push({
        decision: payload.decision,
        rationale: typeof payload.rationale === "string" ? payload.rationale : "",
      });
    }
  }
  return decisions;
}

/**
 * Re-raises a turn-budget exhaustion as explicitly INCONCLUSIVE. Exhaustion is
 * not evidence about write authority in either direction; left bare it is
 * indistinguishable from the resumed session having genuinely lacked write
 * authority. Same relabel-not-swallow pattern as `crash-recovery.live.test`.
 */
function rethrowInconclusive(err: unknown): never {
  const message = err instanceof Error ? err.message : String(err);
  if (/maximum number of turns/i.test(message)) {
    throw new Error(
      `INCONCLUSIVE, not a write-authority failure: the session exhausted its turn budget ` +
        `before the probe completed (${message}). Re-run; if it persists, raise maxTurns.`,
    );
  }
  throw err;
}

beforeAll(async () => {
  assertLiveEnabled();
  await ensureCanary();
});

describe("resume carries WRITE authority (owed probe for active park resume, PR #27)", () => {
  it("spawns a session that defers its write, then resumes it on the SAME adapter and the resumed turn's Write lands real bytes", async () => {
    // Pre-create the owned dir so the Write targets an existing directory,
    // exactly as `adjudication-bridge`'s owned-path Write probe does.
    const ctx = await createLiveAdapterContext({ seedOwnedRelPath: OWNED_REL_DIR });
    try {
      const absProbePath = join(ctx.scratch.worktreePath, PROBE_REL_PATH);

      // The write-capable standard-implementation profile — NOT read-only. Its
      // owned-path grant is what the resumed session must still hold.
      const profile = compileEnvelope(STANDARD_CASE.envelope);
      const substituted = substituteWorktreePlaceholders(
        profile,
        ctx.scratch.worktreePath,
        ctx.scratch.tmpDir,
      );
      const policy = createEnvelopeAdjudicationPolicy({ permissions: substituted.permissions });
      // ONE real policy-backed adjudicate, passed to BOTH spawn and resume, so
      // the resumed Write is enforced by the real envelope policy and journaled.
      const adjudicate: AdjudicationCallback = createAdjudicationBus({
        journal: ctx.journal,
        policy,
      });

      // The write is DEFERRED to the continuation: `resume` sends only the
      // engine's fixed RESUME_PROMPT ("Continue the previous session."), so the
      // resumed turn's action has to be pre-loaded into the spawn objective —
      // the same deferred-instruction shape `crash-recovery` relies on.
      const packet = buildTaskPacket({
        objective:
          "CI resume write-authority diagnostic. For THIS first turn, do NOT create any file — " +
          "reply with exactly: ready. " +
          "IMPORTANT: when this session is later CONTINUED or RESUMED, your task is to use the " +
          `Write tool exactly once to create the file ${PROBE_REL_PATH} (inside the current ` +
          `working directory) with exactly the content: ${PROBE_CONTENT} — then reply with exactly: done.`,
        ownedPaths: [OWNED_REL_DIR],
        resourceLimits: { maxTurns: 6 },
        resultSchema: { type: "object" },
      });

      // --- Turn 1: spawn. The session acknowledges and defers the write. ---
      const handle = ctx.adapter.spawn(packet, profile, adjudicate);
      const spawnEvents = await collectEngineEvents(handle.events).catch(rethrowInconclusive);
      guardEngineEventsRateLimit(spawnEvents);

      // The write must not have happened yet, or its later presence would not
      // be attributable to the RESUMED turn. An eager spawn-time write is a
      // test-timing miss (re-run), not a product failure.
      expect(
        existsSync(absProbePath),
        "INCONCLUSIVE: the worker wrote the probe file during the SPAWN turn instead of deferring " +
          "it to resume, so resume write-authority cannot be attributed. Re-run.",
      ).toBe(false);

      // --- Turn 2: resume ON THE SAME ADAPTER (spawnContexts still holds the
      // write-capable profile — the retained-adapter case PR #27 ships). ---
      const resumed = ctx.adapter.resume(handle.sessionRef, adjudicate);
      let resumedEvents: EngineEvent[] = [];
      let resumedAuditAborted = false;
      try {
        resumedEvents = await collectEngineEvents(resumed.events);
      } catch (err) {
        if (err instanceof AdjudicationAuditViolationError) {
          resumedAuditAborted = true;
        } else {
          rethrowInconclusive(err);
        }
      }
      guardEngineEventsRateLimit(resumedEvents);

      // Same session continued, not a fresh/forked id.
      expect(resumed.sessionRef.sessionId).toBe(handle.sessionRef.sessionId);
      expect(resumed.sessionRef.worktreePath).toBe(handle.sessionRef.worktreePath);
      expect(resumed.sessionRef.configDir).toBe(handle.sessionRef.configDir);

      // A genuinely-allowed Write must not audit-abort.
      expect(
        resumedAuditAborted,
        "the RESUMED worker audit-aborted on a genuinely-allowed owned-path Write",
      ).toBe(false);

      // The resumed turn's OWN event stream executed the Write — attributing
      // the write to the continuation, not the spawn.
      assertToolUseEmitted(
        resumedEvents,
        (event) =>
          event.toolName === "Write" &&
          typeof event.toolInput.file_path === "string" &&
          (event.toolInput.file_path as string).includes(PROBE_REL_PATH),
        `resumed session's Write(${PROBE_REL_PATH})`,
      );

      // THE DISCRIMINATOR: real bytes on disk. Under the read-only fallback the
      // engine would auto-deny Write (baseline §3) and this file would never
      // exist — so its presence proves `resume` continued with the write-
      // capable profile, not `FALLBACK_SPAWN_CONTEXT`'s read-only one.
      expect(
        existsSync(absProbePath),
        "the resumed session's Write did not land on disk — resume degraded to the read-only " +
          "fallback profile (the exact failure this probe exists to catch)",
      ).toBe(true);
      expect(readFileSync(absProbePath, "utf8").trim()).toBe(PROBE_CONTENT);

      // And the allow was journaled through the real bridge on the resumed turn.
      const decisions = await collectAdjudicationDecisions(ctx.journal);
      expect(
        decisions.some(
          (entry) => entry.decision === "allow" && entry.rationale === "allowed tool call: Write",
        ),
        `no allow adjudication_decision was journaled for the resumed Write. ` +
          `Decisions seen: ${JSON.stringify(decisions)}`,
      ).toBe(true);
    } finally {
      await ctx.cleanup();
    }
  });
});
