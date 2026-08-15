import { describe, expect, it } from "vitest";
import {
  DESIGN_GATE_CRITERION,
  OwnerDesignVerdictSchema,
  resolveDesignGate,
  type OwnerDesignVerdict,
} from "./owner-design-verdict.js";

/**
 * The design gate — owner ruling R2 (2026-08-15), roadmap/25 work item 5.
 *
 * Steps 6 and 7 of the owner's pipeline: ask whether the design is what they
 * intended, and loop while it is not. The stage exists in `PIPELINE_STAGES`
 * already; what these tests add is that **nothing except the owner can close
 * it** — no reviewer verdict, no attestation, no server-side derivation.
 *
 * That is the difference between a gate and a checkpoint the model can satisfy
 * for itself, and it is the same principle `contract.approve` rests on
 * (adaptation §5.5: the model must not be able to satisfy its own approval gate).
 */

const verdict = (overrides: Partial<OwnerDesignVerdict> = {}): OwnerDesignVerdict =>
  OwnerDesignVerdictSchema.parse({
    schemaVersion: 1,
    changeSetId: "22222222-3333-4444-8555-666666666666",
    designRevision: "sha256:abc123",
    verdict: "approved",
    recordedAt: "2026-08-15T00:00:00.000Z",
    ...overrides,
  });

describe("OwnerDesignVerdictSchema", () => {
  it("parses an approval", () => {
    expect(() => verdict()).not.toThrow();
  });

  it("REQUIRES a reason on a rejection", () => {
    // Steps 6-7 are a LOOP: rejection returns to the design stage, and a
    // rejection with no reason gives the next round nothing to change. An
    // approval needs no reason -- "yes, this is what I meant" is complete.
    const noReason = OwnerDesignVerdictSchema.safeParse({
      schemaVersion: 1,
      changeSetId: "22222222-3333-4444-8555-666666666666",
      designRevision: "sha256:abc123",
      verdict: "rejected",
      recordedAt: "2026-08-15T00:00:00.000Z",
    });
    expect(noReason.success).toBe(false);
  });

  it("parses a rejection once the reason is supplied", () => {
    expect(() =>
      verdict({ verdict: "rejected", reason: "the queue is the wrong shape" }),
    ).not.toThrow();
  });

  it("requires the design revision it was given over", () => {
    // An approval that does not say WHAT was approved would carry forward
    // across an edited design -- which is the material-amendment failure the
    // criteria seal exists to prevent, reproduced one stage earlier.
    const noRevision = OwnerDesignVerdictSchema.safeParse({
      schemaVersion: 1,
      changeSetId: "22222222-3333-4444-8555-666666666666",
      verdict: "approved",
      recordedAt: "2026-08-15T00:00:00.000Z",
    });
    expect(noRevision.success).toBe(false);
  });
});

describe("resolveDesignGate", () => {
  it("closes on an owner approval of the design under review", () => {
    const result = resolveDesignGate({
      ownerVerdict: verdict(),
      designRevision: "sha256:abc123",
    });
    expect(result.closable).toBe(true);
  });

  it("does NOT close when no owner verdict exists", () => {
    // The default state. A stage that closed on absence would be a gate nobody
    // ever has to pass through.
    const result = resolveDesignGate({ designRevision: "sha256:abc123" });
    expect(result.closable).toBe(false);
    expect(result.reason).toMatch(/owner/i);
  });

  it("does NOT close on a rejection, and carries the reason back", () => {
    // The loop half of steps 6-7: rejection returns to the design stage with
    // what the owner said, not merely with "no".
    const result = resolveDesignGate({
      ownerVerdict: verdict({ verdict: "rejected", reason: "the queue is the wrong shape" }),
      designRevision: "sha256:abc123",
    });
    expect(result.closable).toBe(false);
    expect(result.reason).toMatch(/the queue is the wrong shape/);
  });

  it("does NOT close on an approval of a DIFFERENT design revision", () => {
    // The design was edited after the owner said yes. Carrying that approval
    // forward is approving something nobody read -- the same failure phase 24's
    // criteria seal blocks at the requirements level.
    const result = resolveDesignGate({
      ownerVerdict: verdict({ designRevision: "sha256:older" }),
      designRevision: "sha256:abc123",
    });
    expect(result.closable).toBe(false);
    expect(result.reason).toMatch(/revision/i);
  });

  it("names the criterion the design-gate stage requires", () => {
    // The stage's single exit criterion, so a caller reporting closure failure
    // can point at the same id `PIPELINE_STAGES` declares.
    expect(DESIGN_GATE_CRITERION).toBe("design-gate-owner-verdict-recorded");
  });
});
