import type { AdjudicationCallback } from "@eo/engine-core";
import type { FakeToolCall } from "./tool-call.js";

/**
 * Layer 3 (adjudication) — the mandatory fail-closed contract (roadmap/03-
 * envelope-compiler-engine-adapter.md §Test plan, Security bullet: "an
 * adjudication-hook-bypass test (fake engine attempts a tool call with no
 * `AdjudicationCallback` supplied, or one that throws) must fail closed,
 * never open"). `@eo/engine-core`'s own `AdjudicationCallback` doc comment
 * states this is each `EngineAdapter` implementation's own runtime
 * responsibility to enforce — this is that enforcement.
 */
export async function evaluateAdjudicationLayer(
  adjudicate: AdjudicationCallback | undefined,
  call: FakeToolCall,
): Promise<"allow" | "deny"> {
  if (typeof adjudicate !== "function") {
    return "deny";
  }
  try {
    const controller = new AbortController();
    const decision = await adjudicate(call.toolName, call.toolInput, { signal: controller.signal });
    return decision.behavior === "allow" ? "allow" : "deny";
  } catch {
    return "deny";
  }
}

export const alwaysAllowAdjudicate: AdjudicationCallback = async (_toolName, toolInput) => ({
  behavior: "allow",
  updatedInput: toolInput,
});

export const alwaysDenyAdjudicate: AdjudicationCallback = async () => ({
  behavior: "deny",
  message: "denied by test double (alwaysDenyAdjudicate)",
});

export const alwaysThrowAdjudicate: AdjudicationCallback = async () => {
  throw new Error("adjudication callback deliberately throws (fail-closed security test double)");
};
