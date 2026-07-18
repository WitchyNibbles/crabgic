import { describe, expect, it } from "vitest";
import {
  alwaysAllowAdjudicate,
  alwaysDenyAdjudicate,
  alwaysThrowAdjudicate,
  evaluateAdjudicationLayer,
} from "./adjudication-layer.js";

/**
 * Layer 3 (adjudication) — roadmap/03-envelope-compiler-engine-adapter.md
 * §Test plan, Security bullet: "an adjudication-hook-bypass test (fake
 * engine attempts a tool call with no `AdjudicationCallback` supplied, or
 * one that throws) must fail closed, never open." This is the mandatory
 * security-review-pass test this phase's own Risks section calls out
 * ("this phase 'only' generates configuration, but a defect here silently
 * disables enforcement for every worker in the system").
 */
const CALL = { toolName: "Bash", toolInput: { command: "echo hi" } };

describe("evaluateAdjudicationLayer — fail-closed contract (security)", () => {
  it("a callback that returns allow -> allow", async () => {
    expect(await evaluateAdjudicationLayer(alwaysAllowAdjudicate, CALL)).toBe("allow");
  });

  it("a callback that returns deny -> deny", async () => {
    expect(await evaluateAdjudicationLayer(alwaysDenyAdjudicate, CALL)).toBe("deny");
  });

  it("a callback that THROWS -> deny, never allow (fail-closed)", async () => {
    expect(await evaluateAdjudicationLayer(alwaysThrowAdjudicate, CALL)).toBe("deny");
  });

  it("a callback that throws a differently-worded error -> still deny (catch is message-agnostic)", async () => {
    const throwsUnrelatedError = async (): Promise<never> => {
      throw new Error("boom — some unrelated internal failure");
    };
    expect(await evaluateAdjudicationLayer(throwsUnrelatedError, CALL)).toBe("deny");
  });

  it("no callback supplied at all (runtime-undefined, bypassing the type system) -> deny, never allow", async () => {
    expect(await evaluateAdjudicationLayer(undefined, CALL)).toBe("deny");
  });

  it("a non-function value passed where a callback is expected -> deny", async () => {
    const notAFunction = "not-a-callback" as unknown as typeof alwaysAllowAdjudicate;
    expect(await evaluateAdjudicationLayer(notAFunction, CALL)).toBe("deny");
  });
});

describe("test doubles round-trip through their own declared behavior", () => {
  it("alwaysAllowAdjudicate resolves an allow decision", async () => {
    const decision = await alwaysAllowAdjudicate(CALL.toolName, CALL.toolInput, {
      signal: new AbortController().signal,
    });
    expect(decision.behavior).toBe("allow");
  });

  it("alwaysDenyAdjudicate resolves a deny decision", async () => {
    const decision = await alwaysDenyAdjudicate(CALL.toolName, CALL.toolInput, {
      signal: new AbortController().signal,
    });
    expect(decision.behavior).toBe("deny");
  });

  it("alwaysThrowAdjudicate rejects", async () => {
    await expect(
      alwaysThrowAdjudicate(CALL.toolName, CALL.toolInput, {
        signal: new AbortController().signal,
      }),
    ).rejects.toThrow();
  });
});
