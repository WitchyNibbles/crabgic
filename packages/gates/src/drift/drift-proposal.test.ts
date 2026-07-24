import { describe, expect, it } from "vitest";
import { compareDriftFixture, type DriftFixtureSnapshot } from "./drift-proposal.js";

const FIXED_NOW = () => new Date("2026-07-24T00:00:00.000Z");

describe("compareDriftFixture — no drift (pinned)", () => {
  it("reports drifted=false when version and shape are identical", () => {
    const snapshot: DriftFixtureSnapshot = {
      connector: "jira",
      pinnedVersion: "3.0.0",
      observedVersion: "3.0.0",
      pinnedShape: { summary: "string", description: "string" },
      observedShape: { summary: "string", description: "string" },
    };
    expect(compareDriftFixture(snapshot, FIXED_NOW)).toEqual({ drifted: false });
  });
});

describe("compareDriftFixture — failing-first: intentionally bumped fixture drifts", () => {
  it("a renamed field (withdrawn capability) produces drifted=true with a redacted diff and a recommended fixture update", () => {
    const snapshot: DriftFixtureSnapshot = {
      connector: "grafana",
      pinnedVersion: "11.0.0",
      observedVersion: "11.2.0",
      pinnedShape: { uid: "string", title: "string", version: "number" },
      observedShape: { uid: "string", title: "string", resourceVersion: "string" },
    };
    const result = compareDriftFixture(snapshot, FIXED_NOW);
    expect(result.drifted).toBe(true);
    expect(result.proposal).toBeDefined();
    expect(result.proposal?.connector).toBe("grafana");
    expect(result.proposal?.pinnedVersion).toBe("11.0.0");
    expect(result.proposal?.observedVersion).toBe("11.2.0");
    expect(result.proposal?.recommendedFixtureUpdate).toContain("resourceVersion");
    expect(result.proposal?.recommendedFixtureUpdate).toContain("version");
    expect(result.proposal?.detectedAt).toBe("2026-07-24T00:00:00.000Z");
  });

  it("a version-only bump (no shape change) still drifts", () => {
    const snapshot: DriftFixtureSnapshot = {
      connector: "jira",
      pinnedVersion: "3.0.0",
      observedVersion: "3.1.0",
      pinnedShape: { summary: "string" },
      observedShape: { summary: "string" },
    };
    const result = compareDriftFixture(snapshot, FIXED_NOW);
    expect(result.drifted).toBe(true);
    expect(result.proposal?.recommendedFixtureUpdate).toContain("version bump only");
  });

  it("the redacted diff never contains a secret-shaped value present in the raw shape", () => {
    const snapshot: DriftFixtureSnapshot = {
      connector: "grafana",
      pinnedVersion: "11.0.0",
      observedVersion: "11.1.0",
      pinnedShape: { password: "sk-real-secret-should-never-leak-abc123" },
      observedShape: {
        password: "sk-real-secret-should-never-leak-abc123",
        token: "another-secret",
      },
    };
    const result = compareDriftFixture(snapshot, FIXED_NOW);
    expect(result.proposal?.redactedDiff).not.toContain("sk-real-secret-should-never-leak-abc123");
  });

  // MINOR-1 (adversarial-validation round): key-name-based redaction alone
  // (`redactSecretBearingObject`) misses a secret embedded inside a NON-
  // secret-NAMED field's free text (e.g. an error-body string) — 16/20's own
  // discipline pairs it with CONTENT-shaped redaction
  // (`redactCredentialShapedText`) for exactly this case. Failing-first: this
  // must currently leak (RED) before the fix applies both redactors.
  it("a secret-SHAPED token embedded in a non-secret-named field's free text is ALSO redacted (both halves of 16/20's discipline, not just key-name matching)", () => {
    const snapshot: DriftFixtureSnapshot = {
      connector: "grafana",
      pinnedVersion: "11.0.0",
      observedVersion: "11.1.0",
      pinnedShape: {},
      observedShape: { errorBody: "upstream rejected with glsa_AAAAAAAAAAAAAAAAAAAAAAAA" },
    };
    const result = compareDriftFixture(snapshot, FIXED_NOW);
    expect(result.proposal?.redactedDiff).not.toContain("glsa_AAAAAAAAAAAAAAAAAAAAAAAA");
  });
});
