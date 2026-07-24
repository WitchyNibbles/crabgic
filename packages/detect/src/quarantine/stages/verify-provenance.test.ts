import { describe, expect, it } from "vitest";
import type { PinnedCandidate } from "../types.js";
import { runVerifyProvenanceStage, type SignatureVerifier } from "./verify-provenance.js";

function pinned(overrides: Partial<PinnedCandidate> = {}): PinnedCandidate {
  return {
    kind: "skill",
    name: "example-skill",
    files: [{ path: "SKILL.md", content: "# Example\n" }],
    permissionFootprint: [],
    digest: "sha256:aaa",
    ...overrides,
  };
}

describe("runVerifyProvenanceStage", () => {
  it("passes for a candidate with no signature at all (absence is not itself a failure)", () => {
    const result = runVerifyProvenanceStage(pinned());
    expect(result.passed).toBe(true);
    expect(result.detail).toContain("evidence only");
  });

  it("rejects an unsigned digest swap post-pin (roadmap/12's own named seeded threat)", () => {
    const result = runVerifyProvenanceStage(pinned({ digest: "sha256:bbb" }), {
      previousDigest: "sha256:aaa",
    });
    expect(result.passed).toBe(false);
    expect(result.detail).toContain("unsigned digest swap");
  });

  it("accepts a digest change accompanied by a valid new signature", () => {
    const verifier: SignatureVerifier = { verify: () => true };
    const result = runVerifyProvenanceStage(
      pinned({ digest: "sha256:bbb", provenance: { signature: "valid-sig" } }),
      { previousDigest: "sha256:aaa", verifier },
    );
    expect(result.passed).toBe(true);
  });

  it("passes when the digest is unchanged from the previous pin, even with no signature", () => {
    const result = runVerifyProvenanceStage(pinned({ digest: "sha256:aaa" }), {
      previousDigest: "sha256:aaa",
    });
    expect(result.passed).toBe(true);
  });

  it("fails a present-but-invalid signature under the default (always-false) verifier", () => {
    const result = runVerifyProvenanceStage(pinned({ provenance: { signature: "some-sig" } }));
    expect(result.passed).toBe(false);
  });

  it("passes a present, independently-verified-valid signature under an injected verifier", () => {
    const verifier: SignatureVerifier = { verify: () => true };
    const result = runVerifyProvenanceStage(pinned({ provenance: { signature: "some-sig" } }), {
      verifier,
    });
    expect(result.passed).toBe(true);
  });
});
