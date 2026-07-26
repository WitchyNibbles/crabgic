import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { EvidenceRecord, RemoteResource } from "@eo/contracts";
import type { RemoteEvidencePointer } from "@eo/gates";
import {
  TRACEABILITY_INPUT_PATH,
  TRACEABILITY_RECORD_ENV,
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
  requiresRemoteBinding = true,
): ReleaseRequirement {
  return { id, text: `criterion ${id}`, gateTags, requiresRemoteBinding };
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
    // linkability arithmetic + the remote-binding scope line + one per-entry line.
    expect(result.details).toHaveLength(3);
  });

  it("always states the derived linkability arithmetic, pass or fail", () => {
    const passing = checkRequirementTraceability(passingInput());
    expect(passing.details.join("\n")).toContain("requirement linkability (derived)");
    expect(passing.details.join("\n")).toContain("1 requirement(s)");
    expect(passing.details.join("\n")).toContain("1 linked");

    const failing = checkRequirementTraceability({ ...passingInput(), pointers: [] });
    expect(failing.details.join("\n")).toContain("requirement linkability (derived)");
  });

  /**
   * The umbrella criterion is REPORTED but does not block.
   *
   * `requirementLinkability.ts` documents `unlinkable_umbrella` as
   * "structurally unlinkable BY DESIGN. Not a defect", and this check used
   * to raise it as a blocking reason regardless — so the item could not have
   * passed even with all 15 real requirements perfectly traced. It is now a
   * stated detail: named, explained, and not counted against the release.
   */
  it("names a structurally unlinkable (umbrella) requirement without blocking on it", () => {
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
          requiresRemoteBinding: false,
        },
      ],
    });
    expect(result.verdict).toBe("PASS");
    expect(result.details.join(" ")).toContain("REQ-U");
    expect(result.details.join(" ")).toContain("unlinkable_umbrella");
    expect(result.reasons.join(" ")).not.toContain("REQ-U");
  });

  it("still blocks on the unlinkable statuses that ARE real wiring gaps", () => {
    const result = checkRequirementTraceability({
      ...passingInput(),
      requirements: [
        requirement("REQ-1"),
        // Tagged, but nothing in the journal carries that tag: a harness
        // that scores this criterion does not exist.
        requirement("REQ-GAP", ["release-gate:nobody-emits-this"], false),
      ],
    });
    expect(result.verdict).toBe("FAIL");
    expect(result.reasons.join(" ")).toContain("unlinkable_no_emitting_harness");
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

  /**
   * THESE TESTS ARE ABOUT THE IN-REPO PATH, so the override must be off.
   *
   * `.github/workflows/release-e2e.yml` exports
   * `$EO_REQUIREMENT_TRACEABILITY_RECORD` at JOB level, so it is set for the
   * whole harness run in CI — and with it set, `readRequirementTraceabilityInput`
   * correctly ignores the `repoRoot` these tests hand it and reads the real
   * artifact instead. Every assertion below then describes the wrong file.
   * That is not hypothetical: it turned this file red in CI while it stayed
   * green on every developer machine, which is precisely the failure mode
   * `e2e/release/src/testJournal.ts`'s own note warns about for
   * `$EO_RELEASE_CANDIDATE_OBJECT_ID`. A test that depends on a variable
   * being unset has to unset it.
   */
  const savedOverride = process.env[TRACEABILITY_RECORD_ENV];

  beforeEach(() => {
    delete process.env[TRACEABILITY_RECORD_ENV];
  });

  function repoWithArtifact(contents: string): string {
    const root = mkdtempSync(join(tmpdir(), "eo-attest-trace-"));
    created.push(root);
    mkdirSync(join(root, "docs", "evidence", "phase-23"), { recursive: true });
    writeFileSync(join(root, TRACEABILITY_INPUT_PATH), contents, "utf-8");
    return root;
  }

  afterEach(() => {
    if (savedOverride === undefined) delete process.env[TRACEABILITY_RECORD_ENV];
    else process.env[TRACEABILITY_RECORD_ENV] = savedOverride;
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

/**
 * THE NARROWED REMOTE-BINDING RULE (owner-ratified, 2026-07-26).
 *
 * roadmap/23:125 reads "Every requirement linked to evidence from the exact
 * final Git object ID and remote (Jira/Grafana) revisions". The first
 * revision of this check read that as "every requirement must bind to a
 * Jira/Grafana resource", and applied it to all 16 release criteria — so
 * "two independent from-clean-checkout builds produce byte-identical
 * tarball hashes" was reported as failing for want of a Grafana dashboard
 * revision. There is no such dashboard, and inventing one to clear the gate
 * is precisely the aspirational evidence this phase forbids.
 *
 * The rule is therefore scoped to the requirements whose SUBJECT is a remote
 * system. The object-ID half of the criterion still applies to every
 * requirement without exception — only the remote-revision half is
 * conditional, and every requirement's status is still reported either way.
 */
describe("checkRequirementTraceability — the remote-binding rule is scoped, not universal", () => {
  it("passes a requirement with no remote subject and no remote binding at all", () => {
    const result = checkRequirementTraceability({
      releaseCandidateObjectId: RC,
      requirements: [requirement("REQ-LOCAL", ["release-gate:x"], false)],
      evidenceRecords: [evidence("REQ-LOCAL", RC)],
      remoteResources: [],
      pointers: [],
    });
    expect(result.reasons).toEqual([]);
    expect(result.verdict).toBe("PASS");
  });

  it("still FAILs a requirement whose subject IS a remote system when nothing binds it", () => {
    const result = checkRequirementTraceability({
      releaseCandidateObjectId: RC,
      requirements: [requirement("REQ-REMOTE", ["release-gate:x"], true)],
      evidenceRecords: [evidence("REQ-REMOTE", RC)],
      remoteResources: [],
      pointers: [],
    });
    expect(result.verdict).toBe("FAIL");
    expect(result.reasons.join("\n")).toContain("bound to no remote");
  });

  it("still FAILs a remote-subject requirement whose binding carries no confirmed revision", () => {
    const result = checkRequirementTraceability({
      releaseCandidateObjectId: RC,
      requirements: [requirement("REQ-1", ["release-gate:x"], true)],
      evidenceRecords: [evidence("REQ-1", RC)],
      // No resource to fall back to either — the pointer is the only source,
      // and it carries no revision.
      remoteResources: [],
      pointers: [pointerWithoutRevision()],
    });
    expect(result.verdict).toBe("FAIL");
    expect(result.reasons.join("\n")).toContain("no confirmed revision");
  });

  it("never waives the object-ID half — that applies to every requirement", () => {
    const result = checkRequirementTraceability({
      releaseCandidateObjectId: RC,
      requirements: [requirement("REQ-LOCAL", ["release-gate:x"], false)],
      evidenceRecords: [evidence("REQ-LOCAL", "some-other-commit")],
      remoteResources: [],
      pointers: [],
    });
    expect(result.verdict).toBe("FAIL");
    expect(result.reasons.join("\n")).toContain("no evidence at the release-candidate object ID");
  });

  it("states the scope on its face, so the narrowing is never silent", () => {
    const result = checkRequirementTraceability({
      releaseCandidateObjectId: RC,
      requirements: [
        requirement("REQ-LOCAL", ["release-gate:x"], false),
        requirement("REQ-REMOTE", ["release-gate:y"], true),
      ],
      evidenceRecords: [evidence("REQ-LOCAL", RC), evidence("REQ-REMOTE", RC)],
      remoteResources: [remoteResource("JIRA-1", "rev-9")],
      pointers: [pointer({ requirementId: "REQ-REMOTE" })],
    });
    expect(result.details.join("\n")).toContain("remote binding required of 1 of 2 requirement(s)");
  });
});

/**
 * THE GAP-16 OVERRIDE — the catch-22 this closes.
 *
 * The traceability artifact names the release-candidate object ID it was
 * captured against, and the check requires that to equal the candidate being
 * scored. Committing a freshly-regenerated artifact ADVANCES HEAD past the
 * object ID the artifact names, so the two conditions could never hold at
 * once and `requirement-traceability` was structurally unclearable — exactly
 * the problem `docs/interface-ledger.md`'s Gap 16 already solved for the
 * ARM64 run record (`$EO_ARM64_RUN_RECORD`) and the 15 re-run record
 * (`$EO_PERF_CONTRACT_RERUN_RECORD`). This artifact was the one Gap-16-shaped
 * input with no override, and so the one that could not be supplied
 * out-of-tree.
 */
describe("readRequirementTraceabilityInput — $EO_REQUIREMENT_TRACEABILITY_RECORD", () => {
  const created: string[] = [];
  const saved = process.env[TRACEABILITY_RECORD_ENV];

  afterEach(() => {
    if (saved === undefined) delete process.env[TRACEABILITY_RECORD_ENV];
    else process.env[TRACEABILITY_RECORD_ENV] = saved;
    for (const dir of created.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  function writeArtifactTo(fileName: string): string {
    const dir = mkdtempSync(join(tmpdir(), "eo-traceability-override-"));
    created.push(dir);
    const path = join(dir, fileName);
    writeFileSync(path, `${JSON.stringify(realArtifact(), null, 2)}\n`, "utf-8");
    return path;
  }

  it("reads the artifact from an absolute path outside the checkout", () => {
    process.env[TRACEABILITY_RECORD_ENV] = writeArtifactTo("requirement-traceability.json");
    const input = readRequirementTraceabilityInput(REPO_ROOT, RC, []);
    expect(input.artifactProblem).toBeUndefined();
    expect(input.remoteBindingProvenance?.releaseCandidateObjectId).toBe(RC);
    expect(input.pointers).toHaveLength(1);
  });

  it("falls back to the in-repo path when the override is blank", () => {
    process.env[TRACEABILITY_RECORD_ENV] = "   ";
    const input = readRequirementTraceabilityInput(REPO_ROOT, RC, []);
    // The committed artifact names a different candidate than this fixture's
    // RC — proving the in-repo path was read, not the override.
    expect(input.remoteBindingProvenance?.releaseCandidateObjectId).not.toBe(RC);
  });

  it("reports an unreadable override as a stated problem rather than throwing", () => {
    const dir = mkdtempSync(join(tmpdir(), "eo-traceability-override-"));
    created.push(dir);
    const path = join(dir, "requirement-traceability.json");
    writeFileSync(path, "{ not json", "utf-8");
    process.env[TRACEABILITY_RECORD_ENV] = path;

    const input = readRequirementTraceabilityInput(REPO_ROOT, RC, []);
    expect(input.artifactProblem).toBeDefined();
    expect(input.pointers).toEqual([]);

    // ...and the check turns that into a release-blocking reason, never silence.
    const result = checkRequirementTraceability({
      ...input,
      requirements: [requirement("REQ-1")],
      evidenceRecords: [evidence("REQ-1", RC)],
    });
    expect(result.verdict).toBe("FAIL");
    expect(result.reasons.join("\n")).toContain("unusable");
  });

  it("reports a missing override target rather than silently reading the repo copy", () => {
    process.env[TRACEABILITY_RECORD_ENV] = join(tmpdir(), "eo-no-such-traceability-record.json");
    const input = readRequirementTraceabilityInput(REPO_ROOT, RC, []);
    expect(input.pointers).toEqual([]);
    expect(input.remoteBindingProvenance).toBeUndefined();
  });
});

/**
 * Producer/consumer binding for the Gap-16 override.
 *
 * An override no workflow sets is unreachable machinery, and
 * `requirement-traceability` would go on reporting a stale artifact forever
 * while every test stayed green. This reads the REAL workflow file — not a
 * fixture — and asserts the env-var NAME against the exported constant
 * rather than a second copy of the string, exactly as
 * `e2e/release/src/releaseWorkflowWiring.test.ts` does for its own flag.
 */
describe("release-e2e.yml produces what this check consumes", () => {
  const workflow = readFileSync(
    join(REPO_ROOT, ".github", "workflows", "release-e2e.yml"),
    "utf-8",
  );

  it("sets the override the check reads", () => {
    expect(workflow).toContain(TRACEABILITY_RECORD_ENV);
  });

  it("points it outside the checked-out tree, so the artifact is never a foreign object in the candidate", () => {
    const assignment = new RegExp(
      `${TRACEABILITY_RECORD_ENV}:\\s*\\$\\{\\{\\s*runner\\.temp\\s*\\}\\}`,
    );
    expect(workflow).toMatch(assignment);
  });

  it("runs the containerized binding that writes it", () => {
    expect(workflow).toContain("e2e/attestation/vitest.live.config.ts");
  });

  it("exports it to later steps, so the attestation harness sees the same path", () => {
    expect(workflow).toMatch(
      new RegExp(
        `echo "${TRACEABILITY_RECORD_ENV}=\\$${TRACEABILITY_RECORD_ENV}" >> "\\$GITHUB_ENV"`,
      ),
    );
  });
});
