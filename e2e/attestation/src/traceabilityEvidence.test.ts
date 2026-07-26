import { describe, expect, it } from "vitest";
import {
  CONTAINERIZED_PROVENANCE_SOURCE,
  SHARED_JOURNAL_ENV_VAR,
  TRACEABILITY_EVIDENCE_SCHEMA_VERSION,
  buildTraceabilityEvidenceFile,
  describeEvidenceJournal,
  describeProvenance,
  parseTraceabilityEvidenceFile,
} from "./traceabilityEvidence.js";

const RESOURCE = {
  id: "11111111-1111-4111-8111-111111111111",
  externalConnectionId: "22222222-2222-4222-8222-222222222222",
  resourceKind: "dashboard",
  externalId: "abc123",
  revision: "1",
  observedAt: "2026-07-26T00:00:00.000Z",
};

const POINTER = {
  requirementId: "33333333-3333-4333-8333-333333333333",
  remoteResourceId: RESOURCE.id,
  relation: "dashboard" as const,
  objectId: "a".repeat(40),
  confirmedRevision: "1",
  evidenceRecordId: "44444444-4444-4444-8444-444444444444",
};

function provenance() {
  return {
    source: CONTAINERIZED_PROVENANCE_SOURCE,
    capturedAt: "2026-07-26T00:00:00.000Z",
    releaseCandidateObjectId: "a".repeat(40),
    mutationOutcome: "recorded",
    evidenceJournal: describeEvidenceJournal({ shared: true, dir: "/tmp/shared-journal" }),
    container: {
      image: "grafana/grafana-oss:11.6.5",
      composeFile: "docker/grafana/11.6/docker-compose.yml",
      reportedVersion: "11.6.5",
      edition: "oss",
    },
    transportSeams: {
      resolveHostAddresses: "203.0.113.60",
      sendRequestPinnedAddress: "127.0.0.1",
      tlsTermination:
        "in-process HTTPS terminator fronting the container, disposable self-signed CA",
    },
  };
}

describe("buildTraceabilityEvidenceFile — the artifact states its own provenance on its face", () => {
  it("stamps the schema version and the containerized source", () => {
    const file = buildTraceabilityEvidenceFile({
      provenance: provenance(),
      remoteResources: [RESOURCE],
      pointers: [POINTER],
    });
    // Asserted against the LITERAL, never against the constant itself: an
    // assertion with the constant on both sides is self-cancelling and
    // survives any mutation of it.
    expect(file.schemaVersion).toBe(1);
    expect(TRACEABILITY_EVIDENCE_SCHEMA_VERSION).toBe(1);
    expect(file.provenance.source).toBe("containerized");
  });

  it("carries a statement that names the container AND the engaged address-resolution seams", () => {
    const file = buildTraceabilityEvidenceFile({
      provenance: provenance(),
      remoteResources: [RESOURCE],
      pointers: [POINTER],
    });
    expect(file.provenance.statement).toMatch(/containerized/i);
    expect(file.provenance.statement).toContain("203.0.113.60");
    expect(file.provenance.statement).toContain("127.0.0.1");
    expect(file.provenance.statement).toContain("grafana/grafana-oss:11.6.5");
    // The whole point: nobody may mistake this for a live-SaaS binding.
    expect(file.provenance.statement).toMatch(/not a live[- ]SaaS/i);
  });

  /**
   * MINOR-4 (adversarial validation): the production writer created its
   * evidence journal in an `mkdtemp` directory that teardown deleted, so the
   * artifact's `evidenceRecordId` was a permanently dangling reference and
   * roadmap/21 work item 1's actual deliverable — the journal entry — never
   * reached the shared release journal. The binding runner now writes through
   * the shared-journal contract, and the artifact must SAY on its face which
   * mode was used, so a dangling id can never again look identical to a
   * resolvable one.
   */
  it("states where the evidence record lives, and that a shared-journal id resolves", () => {
    const line = describeEvidenceJournal({ shared: true, dir: "/var/tmp/eo-journal" });
    expect(line).toContain("shared release journal");
    // The env-var name is asserted against the LITERAL, and the constant is
    // pinned to that literal separately — `toContain(SHARED_JOURNAL_ENV_VAR)`
    // would put the constant on both sides and survive any mutation of it.
    expect(line).toContain("EO_RELEASE_GATE_JOURNAL_DIR");
    expect(SHARED_JOURNAL_ENV_VAR).toBe("EO_RELEASE_GATE_JOURNAL_DIR");
    expect(line).toContain("/var/tmp/eo-journal");
    expect(line).toMatch(/resolves/);
  });

  it("states plainly that a run-local journal id does NOT resolve", () => {
    const line = describeEvidenceJournal({ shared: false, dir: "/tmp/eo-attestation-abc" });
    expect(line).toContain("/tmp/eo-attestation-abc");
    expect(line).toContain("discarded at teardown");
    expect(line).toContain("NOT resolvable");
    expect(line).not.toContain("shared release journal (");
  });

  it("carries the evidence-journal disposition into the composed statement", () => {
    const file = buildTraceabilityEvidenceFile({
      provenance: {
        ...provenance(),
        evidenceJournal: describeEvidenceJournal({ shared: false, dir: "/tmp/eo-throwaway" }),
      },
      remoteResources: [RESOURCE],
      pointers: [POINTER],
    });
    expect(file.provenance.statement).toContain("NOT resolvable");
    expect(describeProvenance(file.provenance)).toContain("NOT resolvable");
  });

  it("refuses to build an artifact with no pointers — pointers are what buildTraceabilityView binds from", () => {
    expect(() =>
      buildTraceabilityEvidenceFile({
        provenance: provenance(),
        remoteResources: [RESOURCE],
        pointers: [],
      }),
    ).toThrow(/no pointers/i);
  });

  it("refuses to build an artifact whose pointer references an absent RemoteResource", () => {
    expect(() =>
      buildTraceabilityEvidenceFile({
        provenance: provenance(),
        remoteResources: [],
        pointers: [POINTER],
      }),
    ).toThrow(/dangling/i);
  });

  it("refuses a pointer carrying no confirmed revision", () => {
    const { confirmedRevision: _dropped, ...withoutRevision } = POINTER;
    expect(() =>
      buildTraceabilityEvidenceFile({
        provenance: provenance(),
        remoteResources: [RESOURCE],
        pointers: [withoutRevision],
      }),
    ).toThrow(/confirmed revision/i);
  });

  it("refuses a mutation outcome that is not a durable success", () => {
    expect(() =>
      buildTraceabilityEvidenceFile({
        provenance: { ...provenance(), mutationOutcome: "blocked" },
        remoteResources: [RESOURCE],
        pointers: [POINTER],
      }),
    ).toThrow(/blocked/);
  });

  it("accepts a replayed outcome — an exactly-once replay is still a confirmed remote revision", () => {
    expect(() =>
      buildTraceabilityEvidenceFile({
        provenance: { ...provenance(), mutationOutcome: "replayed" },
        remoteResources: [RESOURCE],
        pointers: [POINTER],
      }),
    ).not.toThrow();
  });
});

describe("parseTraceabilityEvidenceFile — fails closed, never throws out of the reader", () => {
  it("round-trips a built artifact", () => {
    const file = buildTraceabilityEvidenceFile({
      provenance: provenance(),
      remoteResources: [RESOURCE],
      pointers: [POINTER],
    });
    const parsed = parseTraceabilityEvidenceFile(JSON.stringify(file));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.file.pointers).toHaveLength(1);
  });

  it("returns an error (never throws) on malformed JSON", () => {
    const parsed = parseTraceabilityEvidenceFile("{ not json");
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.error).toMatch(/not valid JSON/i);
  });

  it("returns an error (never throws) on schema-invalid content", () => {
    const parsed = parseTraceabilityEvidenceFile(JSON.stringify({ pointers: [] }));
    expect(parsed.ok).toBe(false);
    // Asserted on a DISTINCTIVE phrase from the reader's own message, not on
    // the bare word "schema": zod renders the missing-key issue path as
    // "schemaVersion: ...", so `/schema/i` matched the ZOD OUTPUT and stayed
    // green even when the reader's own sentence was reworded away entirely.
    if (!parsed.ok) expect(parsed.error).toMatch(/does not match the traceability-evidence schema/);
  });

  it("REFUSES an artifact whose provenance omits the evidence-journal disposition", () => {
    const file = buildTraceabilityEvidenceFile({
      provenance: provenance(),
      remoteResources: [RESOURCE],
      pointers: [POINTER],
    });
    const { evidenceJournal: _dropped, ...withoutJournal } = file.provenance;
    const parsed = parseTraceabilityEvidenceFile(
      JSON.stringify({ ...file, provenance: withoutJournal }),
    );
    // If this field were optional, an artifact could go back to saying nothing
    // about whether its `evidenceRecordId` resolves — the exact silence
    // MINOR-4 was about.
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.error).toContain("evidenceJournal");
  });

  /**
   * MUTATION SURVIVOR (adversarial validation): relaxing
   * `TraceabilityEvidenceFileSchema.strict()` to `.passthrough()` left the
   * whole suite green. `.strict()` is not decoration here — Gap 16 part (3)
   * requires producer drift to be surfaced rather than silently half-read,
   * and an unknown TOP-LEVEL key is exactly the shape a producer adding a
   * field takes.
   */
  it("REFUSES an unknown top-level key rather than passing it through", () => {
    const file = buildTraceabilityEvidenceFile({
      provenance: provenance(),
      remoteResources: [RESOURCE],
      pointers: [POINTER],
    });
    const parsed = parseTraceabilityEvidenceFile(JSON.stringify({ ...file, attestedBy: "nobody" }));
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.error).toContain("attestedBy");
  });

  /**
   * The same survivor, one level down: `TraceabilityProvenanceSchema.strict()`
   * could ALSO be relaxed to `.passthrough()` with the suite green. The
   * provenance block is the part of this artifact a reader trusts to say
   * where the evidence came from, so an unrecognised key in it is the one
   * place drift may least be swallowed.
   */
  it("REFUSES an unknown key inside `provenance` rather than passing it through", () => {
    const file = buildTraceabilityEvidenceFile({
      provenance: provenance(),
      remoteResources: [RESOURCE],
      pointers: [POINTER],
    });
    const parsed = parseTraceabilityEvidenceFile(
      JSON.stringify({
        ...file,
        provenance: { ...file.provenance, liveTenant: "acme.grafana.net" },
      }),
    );
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.error).toContain("liveTenant");
  });

  /**
   * Two levels down, and the last `.strict()` pair in this file that no test
   * pinned: `provenance.container` and `provenance.transportSeams`. Both
   * survived a `.strict()` -> `.passthrough()` mutation with the whole suite
   * green. These two blocks are the ones a reader consults to decide WHERE the
   * evidence was produced and HOW it left the box, so an unrecognised key in
   * either is producer drift about provenance itself — the case Gap 16 part (3)
   * exists to surface, not swallow.
   */
  it("REFUSES an unknown key inside `provenance.container` rather than passing it through", () => {
    const file = buildTraceabilityEvidenceFile({
      provenance: provenance(),
      remoteResources: [RESOURCE],
      pointers: [POINTER],
    });
    const parsed = parseTraceabilityEvidenceFile(
      JSON.stringify({
        ...file,
        provenance: {
          ...file.provenance,
          container: { ...file.provenance.container, digest: "sha256:deadbeef" },
        },
      }),
    );
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.error).toContain("digest");
  });

  it("REFUSES an unknown key inside `provenance.transportSeams` rather than passing it through", () => {
    const file = buildTraceabilityEvidenceFile({
      provenance: provenance(),
      remoteResources: [RESOURCE],
      pointers: [POINTER],
    });
    const parsed = parseTraceabilityEvidenceFile(
      JSON.stringify({
        ...file,
        provenance: {
          ...file.provenance,
          transportSeams: { ...file.provenance.transportSeams, proxyPolicy: "none" },
        },
      }),
    );
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.error).toContain("proxyPolicy");
  });

  /**
   * The deliberate counterpart to the four `.strict()` tests above, pinned so the
   * asymmetry cannot be "fixed" by someone who reads it as an oversight. The array
   * ELEMENTS are `.passthrough()` on purpose: the committed
   * `docs/evidence/phase-23/requirement-traceability.json` already ships per-record
   * `schemaVersion` and `canonicalUrl`, so tightening these to `.strict()` makes the
   * real artifact unreadable. This test fails if either element schema is tightened.
   */
  it("ACCEPTS producer-added keys on `remoteResources[]`/`pointers[]` entries, unlike every level above", () => {
    const file = buildTraceabilityEvidenceFile({
      provenance: provenance(),
      remoteResources: [RESOURCE],
      pointers: [POINTER],
    });
    const parsed = parseTraceabilityEvidenceFile(
      JSON.stringify({
        ...file,
        remoteResources: [
          { ...RESOURCE, schemaVersion: 1, canonicalUrl: "https://example.test/x" },
        ],
        pointers: [{ ...POINTER, annotatedBy: "connector" }],
      }),
    );
    expect(parsed.ok).toBe(true);
  });

  it("rejects an unknown provenance source rather than trusting the label", () => {
    const file = buildTraceabilityEvidenceFile({
      provenance: provenance(),
      remoteResources: [RESOURCE],
      pointers: [POINTER],
    });
    const tampered = { ...file, provenance: { ...file.provenance, source: "live-saas" } };
    const parsed = parseTraceabilityEvidenceFile(JSON.stringify(tampered));
    expect(parsed.ok).toBe(false);
  });
});

describe("describeProvenance", () => {
  it("renders one detail line naming the source, the image and both seams", () => {
    const file = buildTraceabilityEvidenceFile({
      provenance: provenance(),
      remoteResources: [RESOURCE],
      pointers: [POINTER],
    });
    const line = describeProvenance(file.provenance);
    expect(line).toContain("containerized");
    expect(line).toContain("grafana/grafana-oss:11.6.5");
    expect(line).toContain("203.0.113.60");
    expect(line).toContain("127.0.0.1");
  });
});
