import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import type { EvidenceRecord, RemoteResource } from "@eo/contracts";
import type { RemoteEvidencePointer } from "@eo/gates";
import {
  TRACEABILITY_INPUT_PATH,
  checkRequirementTraceability,
  readRequirementTraceabilityInput,
} from "./requirementTraceability.js";
import type { ReleaseRequirement } from "./releaseRequirements.js";
import {
  CONTAINERIZED_PROVENANCE_SOURCE,
  buildTraceabilityEvidenceFile,
  describeEvidenceJournal,
} from "./traceabilityEvidence.js";

/** A real, schema-valid artifact — built through the same constructor the live binding harness uses, never hand-assembled. */
function realArtifact() {
  return buildTraceabilityEvidenceFile({
    provenance: {
      source: CONTAINERIZED_PROVENANCE_SOURCE,
      capturedAt: "2026-07-26T00:00:00.000Z",
      releaseCandidateObjectId: RC,
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
        tlsTermination: "in-process HTTPS terminator, disposable self-signed CA",
      },
    },
    remoteResources: [
      {
        id: "11111111-1111-4111-8111-111111111111",
        externalConnectionId: "22222222-2222-4222-8222-222222222222",
        resourceKind: "dashboard",
        externalId: "abc123",
        revision: "1",
        observedAt: "2026-07-26T00:00:00.000Z",
      },
    ],
    pointers: [
      {
        requirementId: "33333333-3333-4333-8333-333333333333",
        remoteResourceId: "11111111-1111-4111-8111-111111111111",
        relation: "dashboard",
        objectId: RC,
        confirmedRevision: "1",
        evidenceRecordId: "44444444-4444-4444-8444-444444444444",
      },
    ],
  });
}

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const RC = "deadbeefdeadbeefdeadbeefdeadbeefdeadbeef";

/**
 * `buildTraceabilityView` reads exactly `requirement.id`/`workUnitIds`,
 * `evidenceRecord.requirementId`/`objectId`, `remoteResource.id`/`revision`
 * and the pointer fields. These fixtures supply those and are narrowed to
 * the contract types — building fully-populated 02 contracts would add
 * dozens of fields the function under test never reads, and would couple
 * this test to unrelated schema churn.
 */
function requirement(
  id: string,
  gateTags: readonly string[] = ["release-gate:x"],
): ReleaseRequirement {
  return { id, text: `criterion ${id}`, gateTags };
}

function evidence(requirementId: string, objectId: string): EvidenceRecord {
  return { requirementId, objectId } as unknown as EvidenceRecord;
}

function remoteResource(id: string, revision: string): RemoteResource {
  return { id, revision } as unknown as RemoteResource;
}

function pointer(overrides: Partial<RemoteEvidencePointer> = {}): RemoteEvidencePointer {
  return {
    requirementId: "REQ-1",
    remoteResourceId: "JIRA-1",
    relation: "tracking-issue",
    objectId: RC,
    confirmedRevision: "rev-9",
    evidenceRecordId: "ev-1",
    ...overrides,
  } as RemoteEvidencePointer;
}

/** `exactOptionalPropertyTypes` forbids spreading an explicit `undefined`, so the key is omitted outright. */
function pointerWithoutRevision(): RemoteEvidencePointer {
  return {
    requirementId: "REQ-1",
    remoteResourceId: "JIRA-1",
    relation: "tracking-issue",
    objectId: RC,
    evidenceRecordId: "ev-1",
  } as RemoteEvidencePointer;
}

function passingInput() {
  return {
    releaseCandidateObjectId: RC,
    requirements: [requirement("REQ-1")],
    evidenceRecords: [evidence("REQ-1", RC)],
    remoteResources: [remoteResource("JIRA-1", "rev-9")],
    pointers: [pointer()],
  };
}

describe("checkRequirementTraceability — PASS", () => {
  it("passes when every requirement links release-candidate evidence and a confirmed remote revision", () => {
    const result = checkRequirementTraceability(passingInput());
    expect(result.verdict).toBe("PASS");
    expect(result.details).toHaveLength(2);
  });

  it("always states the derived linkability arithmetic, pass or fail", () => {
    const passing = checkRequirementTraceability(passingInput());
    expect(passing.details.join("\n")).toContain("requirement linkability (derived)");
    expect(passing.details.join("\n")).toContain("1 requirement(s)");
    expect(passing.details.join("\n")).toContain("1 linked");

    const failing = checkRequirementTraceability({ ...passingInput(), pointers: [] });
    expect(failing.details.join("\n")).toContain("requirement linkability (derived)");
  });

  it("names a structurally unlinkable (umbrella) requirement in its own reason", () => {
    const result = checkRequirementTraceability({
      ...passingInput(),
      requirements: [
        requirement("REQ-1"),
        // The REAL umbrella wording, so this exercises the real rule table
        // rather than a fixture that only looks like the umbrella.
        {
          id: "REQ-U",
          text: "archived `e2e/release-gate-report.json` shows PASS for every item below",
          gateTags: [],
        },
      ],
    });
    expect(result.verdict).toBe("FAIL");
    expect(result.reasons.join(" ")).toContain("REQ-U");
    expect(result.reasons.join(" ")).toContain("unlinkable_umbrella");
  });

  it("lists every journaled gate tag that carries no requirementId, as the actionable wiring gap", () => {
    const result = checkRequirementTraceability({
      ...passingInput(),
      evidenceRecords: [
        evidence("REQ-1", RC),
        { objectId: RC, gateTag: "release-gate:git-matrix" } as unknown as EvidenceRecord,
      ],
    });
    expect(result.details.join("\n")).toContain("release-gate:git-matrix");
  });

  it("falls back to the RemoteResource revision when the pointer carries none", () => {
    const result = checkRequirementTraceability({
      ...passingInput(),
      pointers: [pointerWithoutRevision()],
    });
    expect(result.verdict).toBe("PASS");
  });
});

describe("checkRequirementTraceability — seeded defects each FAIL", () => {
  /** The silent-PASS trap: "every requirement is traced" is vacuously true of none. */
  it("FAILs on an empty requirement set rather than passing vacuously", () => {
    const result = checkRequirementTraceability({ ...passingInput(), requirements: [] });
    expect(result.verdict).toBe("FAIL");
    expect(result.reasons.join(" ")).toContain("never treated as");
  });

  it("FAILs when evidence exists but not at the release-candidate object ID", () => {
    const result = checkRequirementTraceability({
      ...passingInput(),
      evidenceRecords: [evidence("REQ-1", "0000000000000000000000000000000000000000")],
    });
    expect(result.verdict).toBe("FAIL");
    expect(result.reasons.join(" ")).toContain("no evidence at the release-candidate object ID");
  });

  it("FAILs when a requirement has no evidence at all", () => {
    const result = checkRequirementTraceability({ ...passingInput(), evidenceRecords: [] });
    expect(result.verdict).toBe("FAIL");
    expect(result.reasons.join(" ")).toContain("linked object IDs: none");
  });

  it("FAILs when a requirement is bound to no remote resource", () => {
    const result = checkRequirementTraceability({ ...passingInput(), pointers: [] });
    expect(result.verdict).toBe("FAIL");
    expect(result.reasons.join(" ")).toContain("bound to no remote");
  });

  it("FAILs when a remote binding carries no confirmed revision from either source", () => {
    const result = checkRequirementTraceability({
      ...passingInput(),
      remoteResources: [],
      pointers: [pointerWithoutRevision()],
    });
    expect(result.verdict).toBe("FAIL");
    expect(result.reasons.join(" ")).toContain("no confirmed revision");
  });

  /**
   * THE HOLE THE ADVERSARIAL VALIDATOR FOUND. `buildTraceabilityView`
   * derives `entry.objectIds` from `evidenceRecords` ONLY
   * (`packages/gates/src/traceability-view.ts:94`); the pointer's OWN
   * `objectId` — the Git object ID the remote binding was actually stamped
   * at — was compared to nothing. A pointer stamped at any other commit was
   * therefore counted as a valid remote binding, which is exactly the
   * "gate asserts more than it verifies" failure this repo exists to
   * prevent. The exit criterion is "linked to evidence from the EXACT final
   * Git object ID AND remote revisions" — both halves must be at the same
   * object ID.
   */
  it("FAILs when a remote evidence pointer was stamped at a different Git object ID", () => {
    const stale = "ffffffffffffffffffffffffffffffffffffffff";
    const result = checkRequirementTraceability({
      ...passingInput(),
      pointers: [pointer({ objectId: stale })],
    });
    expect(result.verdict).toBe("FAIL");
    expect(result.reasons.join(" ")).toContain("stamped at Git object ID");
    expect(result.reasons.join(" ")).toContain(stale);
    expect(result.reasons.join(" ")).toContain(RC);
  });

  it("checks EVERY pointer, not just the first — a stale one hiding behind a fresh one still FAILs", () => {
    const result = checkRequirementTraceability({
      ...passingInput(),
      remoteResources: [remoteResource("JIRA-1", "rev-9"), remoteResource("JIRA-2", "rev-10")],
      pointers: [
        pointer(),
        pointer({
          remoteResourceId: "JIRA-2",
          objectId: "ffffffffffffffffffffffffffffffffffffffff",
        }),
      ],
    });
    expect(result.verdict).toBe("FAIL");
    expect(result.reasons.join(" ")).toContain("JIRA-2");
  });

  it("names the stale pointer's own requirement and remote resource, not just the object ID", () => {
    const result = checkRequirementTraceability({
      ...passingInput(),
      pointers: [pointer({ objectId: "ffffffffffffffffffffffffffffffffffffffff" })],
    });
    expect(result.reasons.join(" ")).toContain("JIRA-1");
  });

  it("FAILs when the artifact's provenance records a different release candidate", () => {
    const artifact = realArtifact();
    const result = checkRequirementTraceability({
      ...passingInput(),
      releaseCandidateObjectId: "ffffffffffffffffffffffffffffffffffffffff",
      remoteBindingProvenance: artifact.provenance,
    });
    expect(result.verdict).toBe("FAIL");
    const provenanceReason = result.reasons.find((reason) =>
      reason.includes("provenance records release candidate"),
    );
    expect(provenanceReason).toBeDefined();
    expect(provenanceReason).toContain(RC);
    expect(provenanceReason).toContain("ffffffffffffffffffffffffffffffffffffffff");
  });

  it("raises NO provenance reason when the artifact was captured at this release candidate", () => {
    const artifact = realArtifact();
    const result = checkRequirementTraceability({
      ...passingInput(),
      remoteBindingProvenance: artifact.provenance,
    });
    expect(result.verdict).toBe("PASS");
    expect(result.reasons).toEqual([]);
  });

  it("reports each untraced requirement separately", () => {
    const result = checkRequirementTraceability({
      ...passingInput(),
      requirements: [requirement("REQ-1"), requirement("REQ-2")],
    });
    expect(result.verdict).toBe("FAIL");
    expect(result.reasons.join(" ")).toContain("REQ-2");
  });
});

describe("readRequirementTraceabilityInput — against the real repository", () => {
  it("reads whatever traceability input exists and carries the supplied evidence records", () => {
    const input = readRequirementTraceabilityInput(REPO_ROOT, RC, []);
    expect(input.releaseCandidateObjectId).toBe(RC);
    expect(Array.isArray(input.requirements)).toBe(true);
    expect(input.evidenceRecords).toEqual([]);
  });

  it("carries the real corpus's gate tags through, so linkability can be derived downstream", () => {
    const input = readRequirementTraceabilityInput(REPO_ROOT, RC, []);
    expect(input.requirements).toHaveLength(16);
    expect(input.requirements.some((r) => r.gateTags.length > 0)).toBe(true);
    expect(input.requirements.filter((r) => r.gateTags.length === 0)).toHaveLength(1);
  });
});

describe("readRequirementTraceabilityInput — the artifact is validated, never trusted", () => {
  const created: string[] = [];

  function repoWithArtifact(contents: string): string {
    const root = mkdtempSync(join(tmpdir(), "eo-attest-trace-"));
    created.push(root);
    mkdirSync(join(root, "docs", "evidence", "phase-23"), { recursive: true });
    writeFileSync(join(root, TRACEABILITY_INPUT_PATH), contents, "utf-8");
    return root;
  }

  afterEach(() => {
    for (const root of created.splice(0)) rmSync(root, { recursive: true, force: true });
  });

  it("reports malformed JSON as a stated problem instead of throwing out of the check", () => {
    const root = repoWithArtifact("{ not json");
    const input = readRequirementTraceabilityInput(root, RC, []);
    expect(input.artifactProblem).toMatch(/not valid JSON/i);
    expect(input.pointers).toEqual([]);
  });

  it("reports a schema-invalid artifact as a stated problem", () => {
    const root = repoWithArtifact(JSON.stringify({ pointers: [], remoteResources: [] }));
    const input = readRequirementTraceabilityInput(root, RC, []);
    // See `traceabilityEvidence.test.ts` — `/schema/i` also matched zod's own
    // rendered issue path ("schemaVersion: ..."), so it pinned nothing.
    expect(input.artifactProblem).toMatch(/does not match the traceability-evidence schema/);
  });

  it("reports NO problem when the artifact is simply absent — that is an honest 'not bound yet'", () => {
    const root = mkdtempSync(join(tmpdir(), "eo-attest-trace-"));
    created.push(root);
    const input = readRequirementTraceabilityInput(root, RC, []);
    expect(input.artifactProblem).toBeUndefined();
    expect(input.pointers).toEqual([]);
  });

  it("surfaces the artifact's provenance so the release-gate report states the binding's origin", () => {
    const root = repoWithArtifact(JSON.stringify(realArtifact()));
    const input = readRequirementTraceabilityInput(root, RC, []);
    expect(input.remoteBindingProvenance?.source).toBe("containerized");
    expect(input.pointers).toHaveLength(1);
    expect(input.remoteResources).toHaveLength(1);
  });

  it("a corrupt artifact FAILs the check with the parse problem quoted verbatim", () => {
    const result = checkRequirementTraceability({
      ...passingInput(),
      artifactProblem: "not valid JSON (Unexpected token n)",
    });
    expect(result.verdict).toBe("FAIL");
    expect(result.reasons.join(" ")).toContain("not valid JSON");
  });

  it("a valid artifact's provenance lands in the check's details", () => {
    const artifact = realArtifact();
    const result = checkRequirementTraceability({
      ...passingInput(),
      remoteBindingProvenance: artifact.provenance,
    });
    expect(result.details.join("\n")).toContain("remote binding provenance: containerized");
  });
});
