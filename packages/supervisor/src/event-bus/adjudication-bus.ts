/**
 * Journal-teed adjudication bus — roadmap/05-supervisor-daemon.md
 * §Adjudication stub: "the journal-teed bus every tool call is routed
 * through for a pre-effect decision before it takes effect
 * (`adjudication_decision` journaled first). This phase's own stub policy
 * — 03 defines the `AdjudicationCallback` call shape it answers — resolves
 * any bridge failure (crash, timeout) to deny; 06 replaces the stub's
 * *policy* with the real journal-first allow/deny/`updatedInput` decision,
 * the bus and its fail-closed default do not change underneath it."
 *
 * `createAdjudicationBus` is that bus: it wraps whatever `policy` it is
 * given (defaulting to `denyAllPolicy`, this phase's own stub — see roadmap
 * 05 §Adjudication stub), enforces a bounded timeout around it, and
 * ALWAYS journals the resulting `adjudication_decision` entry before
 * returning the decision to the caller — the exact point at which 03's
 * `AdjudicationCallback` contract hands control back to `spawn`/`resume`,
 * which then acts on it (executes the tool on `allow`, surfaces the denial
 * on `deny`).
 */
import type {
  AdjudicationCallback,
  AdjudicationContext,
  AdjudicationDecision,
} from "@eo/engine-core";
import type { JournalStore } from "@eo/journal";

export type AdjudicationPolicy = (
  toolName: string,
  toolInput: Readonly<Record<string, unknown>>,
  context: AdjudicationContext,
) => Promise<AdjudicationDecision>;

export interface AdjudicationBusOptions {
  readonly journal: JournalStore;
  readonly runId?: string;
  readonly workUnitId?: string;
  /** Safety bound around the policy call itself. Default 5000ms. */
  readonly timeoutMs?: number;
  /** The actual policy answering allow/deny/updatedInput — 06 swaps this for the real journal-first implementation; this bus and its fail-closed default are unchanged by that swap. Defaults to `denyAllPolicy`. */
  readonly policy?: AdjudicationPolicy;
}

/** This phase's own stub policy (roadmap 05 §Adjudication stub) — denies every tool call unconditionally. Never the final production policy; 06 replaces it. */
export async function denyAllPolicy(
  toolName: string,
  _toolInput: Readonly<Record<string, unknown>>,
  _context: AdjudicationContext,
): Promise<AdjudicationDecision> {
  return {
    behavior: "deny",
    message: `supervisor: phase-05 adjudication stub denies "${toolName}" (no real policy wired until 06)`,
  };
}

function toErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error(`adjudication policy timed out after ${String(timeoutMs)}ms`));
    }, timeoutMs);
    timer.unref?.();

    promise.then(
      (value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(value);
      },
      (err: unknown) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(err instanceof Error ? err : new Error(toErrorMessage(err)));
      },
    );
  });
}

const DEFAULT_TIMEOUT_MS = 5_000;

/**
 * Builds the `AdjudicationCallback` `EngineAdapter.spawn`/`resume` invoke
 * per tool call. Every call — allow or deny, policy success or bridge
 * failure — is journaled as exactly one `adjudication_decision` entry
 * BEFORE this function returns the decision to its own caller.
 */
export function createAdjudicationBus(options: AdjudicationBusOptions): AdjudicationCallback {
  const policy = options.policy ?? denyAllPolicy;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  return async (toolName, toolInput, context) => {
    let decision: AdjudicationDecision;
    try {
      decision = await withTimeout(policy(toolName, toolInput, context), timeoutMs);
    } catch (err) {
      // Fail closed: a throwing or timed-out policy is indistinguishable
      // from an attacker's tool call at this boundary — never allow.
      decision = {
        behavior: "deny",
        message: `supervisor: adjudication bridge failed for "${toolName}" (${toErrorMessage(err)}) — failing closed`,
      };
    }

    await options.journal.appendEntry({
      type: "adjudication_decision",
      ...(options.runId !== undefined ? { runId: options.runId } : {}),
      ...(options.workUnitId !== undefined ? { workUnitId: options.workUnitId } : {}),
      payload: {
        decision: decision.behavior,
        rationale:
          decision.behavior === "allow" ? `allowed tool call: ${toolName}` : decision.message,
      },
    });

    return decision;
  };
}
