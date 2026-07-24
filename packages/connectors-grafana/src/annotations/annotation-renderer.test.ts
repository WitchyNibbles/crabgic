import { describe, expect, it } from "vitest";
import { DEFAULT_COMMUNICATION_POLICY } from "@eo/contracts";
import { renderGrafanaAnnotationArtifact } from "./annotation-renderer.js";

const FIXED_NOW = () => new Date("2026-01-01T00:00:00.000Z");

describe("renderGrafanaAnnotationArtifact — conformance: every annotation goes through 17's renderWithRegeneration", () => {
  it("renders on the first attempt when the composed text fits the template + length limit", async () => {
    const outcome = await renderGrafanaAnnotationArtifact({
      state: "deployed",
      service: "checkout",
      change: "rolled out v2.3.1",
      evidenceRef: "run:abc123",
      policy: DEFAULT_COMMUNICATION_POLICY,
      now: FIXED_NOW,
    });
    expect(outcome.status).toBe("rendered");
    if (outcome.status === "rendered") {
      expect(outcome.artifact.content).toBe(
        "deployed | checkout | rolled out v2.3.1 | evidence=run:abc123",
      );
      expect(outcome.artifact.kind).toBe("grafana_annotation");
      expect(outcome.artifact.content.length).toBeLessThanOrEqual(
        DEFAULT_COMMUNICATION_POLICY.limits.grafanaAnnotation.maxChars,
      );
    }
  });

  it("regenerates once (shortening `change`) when the first candidate exceeds the 240-char limit, and the second attempt succeeds", async () => {
    const longChange = "x".repeat(300);
    const outcome = await renderGrafanaAnnotationArtifact({
      state: "deployed",
      service: "checkout",
      change: longChange,
      evidenceRef: "run:abc123",
      policy: DEFAULT_COMMUNICATION_POLICY,
      now: FIXED_NOW,
    });
    expect(outcome.status).toBe("rendered");
    if (outcome.status === "rendered") {
      expect(outcome.artifact.content).not.toContain(longChange);
      expect(outcome.artifact.content.length).toBeLessThanOrEqual(
        DEFAULT_COMMUNICATION_POLICY.limits.grafanaAnnotation.maxChars,
      );
    }
  });

  it("blocks (never writes anything) when even the shortened second candidate still fails lint — regenerate-once, never a third attempt", async () => {
    // A service/state/evidenceRef combination long enough that even a
    // fully-shortened `change` can't fit under the 240-char limit.
    const outcome = await renderGrafanaAnnotationArtifact({
      state:
        "deployed-with-an-extremely-long-state-label-that-alone-consumes-most-of-the-budget-available",
      service: "checkout-service-with-an-equally-long-and-verbose-descriptive-name-attached-to-it",
      change: "x".repeat(300),
      evidenceRef:
        "run:abc123-with-a-very-long-suffix-appended-to-push-this-well-past-the-240-character-ceiling",
      policy: DEFAULT_COMMUNICATION_POLICY,
      now: FIXED_NOW,
    });
    expect(outcome.status).toBe("blocked");
    if (outcome.status === "blocked") {
      expect(outcome.error).toBe("policy_blocked");
      expect(outcome.findings.length).toBeGreaterThan(0);
    }
  });

  it("defaults `now` to the current time when omitted", async () => {
    const outcome = await renderGrafanaAnnotationArtifact({
      state: "deployed",
      service: "checkout",
      change: "v3",
      evidenceRef: "run:def456",
      policy: DEFAULT_COMMUNICATION_POLICY,
    });
    expect(outcome.status).toBe("rendered");
    if (outcome.status === "rendered") {
      expect(new Date(outcome.artifact.renderedAt).getTime()).toBeGreaterThan(0);
    }
  });

  it("never renders the raw evidence pointer as anything other than the evidence=<ref> suffix (template shape is fixed)", async () => {
    const outcome = await renderGrafanaAnnotationArtifact({
      state: "rolled-back",
      service: "billing",
      change: "reverted migration 042",
      evidenceRef: "run:xyz789",
      policy: DEFAULT_COMMUNICATION_POLICY,
      now: FIXED_NOW,
    });
    expect(outcome.status).toBe("rendered");
    if (outcome.status === "rendered") {
      expect(outcome.artifact.content.endsWith("evidence=run:xyz789")).toBe(true);
    }
  });
});
