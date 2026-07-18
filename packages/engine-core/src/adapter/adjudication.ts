/// <reference types="node" />

/**
 * `AdjudicationCallback` — the hook-slot type `spawn`/`resume` invoke per
 * tool call (roadmap/03-envelope-compiler-engine-adapter.md §In scope:
 * "`AdjudicationCallback` is the hook-slot type `spawn`/`resume` invoke
 * per tool call — this phase defines the call shape only; the policy that
 * answers it is supervisor-owned"). Deliberately mirrors the DOCUMENTED
 * Agent SDK `canUseTool` callback shape (adaptation §4.3: "`canUseTool`
 * (per-call permission adjudication with allow/deny + updated input)";
 * §5.3's worked example: `canUseTool: async (name, input, ctx) =>
 * supervisor.adjudicate(runId, name, input)"), NOT the undocumented CLI
 * flag `--permission-prompt-tool` (roadmap/03 §Risks, "§10 risk #2":
 * "the `AdjudicationCallback` hook slot deliberately mirrors the
 * documented SDK `canUseTool` callback shape, not the undocumented CLI
 * flag; 06 must not build the real wiring against the latter").
 */
export type AdjudicationDecision =
  | {
      readonly behavior: "allow";
      /** Canonicalized tool input (SDK `canUseTool`'s `updatedInput`, adaptation §4.3/§5.1). */
      readonly updatedInput: Readonly<Record<string, unknown>>;
    }
  | {
      readonly behavior: "deny";
      readonly message: string;
      /** Mirrors the SDK's optional `interrupt` flag on a deny decision. */
      readonly interrupt?: boolean;
    };

export interface AdjudicationContext {
  readonly signal: AbortSignal;
}

/**
 * Fail-closed contract (roadmap/03 §Test plan, Security bullet: "an
 * adjudication-hook-bypass test … must fail closed, never open"): an
 * `EngineAdapter` implementation MUST treat a callback that throws, or a
 * `spawn`/`resume` call given no callback at all (not expressible at the
 * type level here since the parameter is required — enforced by every
 * conforming implementation), as an implicit deny. This phase defines
 * only the call shape; enforcing fail-closed behavior at runtime is each
 * `EngineAdapter` implementation's own responsibility (05's fake engine,
 * 06's real adapter).
 */
export type AdjudicationCallback = (
  toolName: string,
  toolInput: Readonly<Record<string, unknown>>,
  context: AdjudicationContext,
) => Promise<AdjudicationDecision>;
