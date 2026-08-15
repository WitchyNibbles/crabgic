import { describe, expect, it } from "vitest";
import {
  AUTONOMY_DEFAULTABLE_CONDITIONS,
  AutonomySettingsSchema,
  HALTING_AUTONOMY,
  resolveStopCondition,
  type AutonomySettings,
} from "./autonomy-settings.js";

/**
 * Autonomy defaults — owner ruling R3 (2026-08-15), roadmap/25 work item 10.
 *
 * The owner's pipeline says: "from this point no human/user feedback is needed
 * and everything must be completed automatically". Three stop conditions fired
 * after the design gate and each halted for the owner. R3 granted defaults for
 * two of them and excluded the third — and the exclusion is the part these tests
 * exist to make structural rather than remembered.
 */

const settings = (overrides: Record<string, unknown> = {}): AutonomySettings =>
  AutonomySettingsSchema.parse({
    schemaVersion: 1,
    defaults: {
      irreducible_product_decision: "prefer-reversible",
      exhausted_repairs: "park",
      ...overrides,
    },
  });

describe("expanded_authority can never be defaulted", () => {
  it("is not in the defaultable set", () => {
    // Ruling R3 excluded it, and Gap 18's whole safety argument rests on it:
    // nothing reachable from a session may widen the model's own authority.
    expect(AUTONOMY_DEFAULTABLE_CONDITIONS).not.toContain("expanded_authority");
  });

  it("REFUSES a settings document that tries to default it", () => {
    // Structural, not policed. A `.strict()` object means the key cannot be
    // represented at all -- so an operator cannot write it, a migration cannot
    // introduce it, and no reviewer has to notice it.
    const result = AutonomySettingsSchema.safeParse({
      schemaVersion: 1,
      defaults: {
        irreducible_product_decision: "prefer-reversible",
        exhausted_repairs: "park",
        expanded_authority: "proceed",
      },
    });
    expect(result.success).toBe(false);
  });

  it("still halts on expanded_authority under the most permissive settings", () => {
    const verdict = resolveStopCondition("expanded_authority", settings());
    expect(verdict.halts).toBe(true);
    expect(verdict.disposition).toBeUndefined();
  });

  it("halts on the four conditions R3 never covered", () => {
    // R3 named two. The other four were never in scope, and defaulting one by
    // omission is how a scope ruling quietly becomes a general permission.
    for (const kind of [
      "material_amendment",
      "critical_security_issue",
      "unsafe_overlap",
      "blocking_verification",
    ] as const) {
      expect(resolveStopCondition(kind, settings()).halts).toBe(true);
    }
  });
});

describe("the two conditions R3 granted", () => {
  it("takes the declared default for irreducible_product_decision", () => {
    const verdict = resolveStopCondition("irreducible_product_decision", settings());
    expect(verdict.halts).toBe(false);
    expect(verdict.disposition).toBe("prefer-reversible");
  });

  it("takes the declared default for exhausted_repairs", () => {
    const verdict = resolveStopCondition("exhausted_repairs", settings());
    expect(verdict.halts).toBe(false);
    expect(verdict.disposition).toBe("park");
  });

  it("halts when the declared default is `halt`", () => {
    // The owner may decline autonomy per-condition without deleting the
    // document. An all-or-nothing setting would push an operator into removing
    // the file, losing the record of what was decided.
    const verdict = resolveStopCondition(
      "exhausted_repairs",
      settings({ exhausted_repairs: "halt" }),
    );
    expect(verdict.halts).toBe(true);
  });

  it("refuses a disposition that is not one of the declared choices", () => {
    expect(
      AutonomySettingsSchema.safeParse({
        schemaVersion: 1,
        defaults: {
          irreducible_product_decision: "do whatever seems best",
          exhausted_repairs: "park",
        },
      }).success,
    ).toBe(false);
  });

  it("refuses a document that omits one of the two", () => {
    // Absence would have to mean something, and both readings are bad: "halt"
    // silently disables an autonomy the owner asked for, "proceed" silently
    // grants one they did not. Requiring both makes the choice explicit.
    expect(
      AutonomySettingsSchema.safeParse({
        schemaVersion: 1,
        defaults: { exhausted_repairs: "park" },
      }).success,
    ).toBe(false);
  });
});

describe("every defaulted firing is reportable", () => {
  it("returns the record an autonomous run has to journal", () => {
    // R3's obligation: the owner no longer blocks on these, so the only way
    // they can ever see one is afterwards. A default taken and not recorded is
    // the silent choosing the ruling was careful to forbid.
    const verdict = resolveStopCondition("irreducible_product_decision", settings());
    expect(verdict.record).toBeDefined();
    expect(verdict.record?.kind).toBe("irreducible_product_decision");
    expect(verdict.record?.disposition).toBe("prefer-reversible");
    expect(verdict.record?.declaredBefore).toBe(true);
  });

  it("marks the record as pre-declared, never as chosen in the moment", () => {
    // A disposition picked while the decision is live is the model deciding,
    // wearing a default's name. The flag exists so a reader of the journal can
    // tell the two apart without trusting the writer's word for it.
    expect(resolveStopCondition("exhausted_repairs", settings()).record?.declaredBefore).toBe(true);
  });

  it("produces no record for a condition that halted", () => {
    // A halt is already visible -- the run stopped and the owner is looking at
    // it. A "defaulted" record there would claim a decision nobody made.
    expect(resolveStopCondition("expanded_authority", settings()).record).toBeUndefined();
  });
});

describe("HALTING_AUTONOMY — the safe default when nothing is configured", () => {
  it("halts on every condition", () => {
    // A project that has not opted into autonomy behaves exactly as before. The
    // dangerous default here is the permissive one, so absence means halt.
    for (const kind of AUTONOMY_DEFAULTABLE_CONDITIONS) {
      expect(resolveStopCondition(kind, HALTING_AUTONOMY).halts).toBe(true);
    }
  });

  it("parses as a valid settings document", () => {
    // It has to be a real document, not a sentinel: the resolver must not need
    // a second code path for "unconfigured", which is where the two would drift.
    expect(AutonomySettingsSchema.safeParse(HALTING_AUTONOMY).success).toBe(true);
  });
});
