import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildEvidenceRecord, buildRemoteResource, buildRequirement } from "@eo/testkit";
import { buildTraceabilityView } from "./traceability-view.js";
import type { RemoteEvidencePointer } from "./remote-evidence-pointer.js";

/**
 * roadmap/21 §Exit criteria: "Traceability view resolves requirement →
 * work unit → exact object ID → RemoteResource → confirmed revision, both
 * directions, on a seeded multi-requirement ChangeSet. Evidence: golden
 * traceability-view fixture, snapshot-tested."
 *
 * Fixed, deterministic UUIDs throughout (never `randomUUID()`) so the
 * golden fixture (`../goldens/phase-21/traceability-view.golden.json`) is
 * byte-stable across runs — same convention as every other phase's own
 * `goldens/*.json` (see `.prettierignore`).
 */

const GOLDEN_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "goldens",
  "phase-21",
  "traceability-view.golden.json",
);

const REQ1 = "10000000-0000-4000-8000-000000000001"; // Jira-tracked, tracking-issue
const REQ2 = "10000000-0000-4000-8000-000000000002"; // Jira-tracked, tracking-issue
const REQ3 = "10000000-0000-4000-8000-000000000003"; // Grafana-tracked, dashboard
const WU1 = "30000000-0000-4000-8000-000000000001";
const WU2 = "30000000-0000-4000-8000-000000000002";
const WU3 = "30000000-0000-4000-8000-000000000003";
const REMOTE1 = "20000000-0000-4000-8000-000000000001";
const REMOTE2 = "20000000-0000-4000-8000-000000000002";
const REMOTE3 = "20000000-0000-4000-8000-000000000003";
const EXTERNAL_CONNECTION_ID = "70000000-0000-4000-8000-000000000001";

describe("buildTraceabilityView — golden, bidirectional, multi-requirement ChangeSet", () => {
  it("matches the committed golden fixture exactly (requirement -> work unit -> object id -> RemoteResource -> confirmed revision, both directions)", () => {
    const requirements = [
      buildRequirement({ id: REQ1, workUnitIds: [WU1] }),
      buildRequirement({ id: REQ2, workUnitIds: [WU2] }),
      buildRequirement({ id: REQ3, workUnitIds: [WU3] }),
    ];

    const evidenceRecords = [
      buildEvidenceRecord({ requirementId: REQ1, objectId: "object-id-req1" }),
      buildEvidenceRecord({ requirementId: REQ2, objectId: "object-id-req2" }),
      buildEvidenceRecord({ requirementId: REQ3, objectId: "object-id-req3" }),
    ];

    const remoteResources = [
      buildRemoteResource({
        id: REMOTE1,
        externalConnectionId: EXTERNAL_CONNECTION_ID,
        resourceKind: "issue",
        externalId: "PROJ-1",
        revision: "7",
      }),
      buildRemoteResource({
        id: REMOTE2,
        externalConnectionId: EXTERNAL_CONNECTION_ID,
        resourceKind: "issue",
        externalId: "PROJ-2",
        revision: "3",
      }),
      buildRemoteResource({
        id: REMOTE3,
        externalConnectionId: EXTERNAL_CONNECTION_ID,
        resourceKind: "dashboard",
        externalId: "dash-uid-1",
        revision: "etag-9",
      }),
    ];

    const pointers: readonly RemoteEvidencePointer[] = [
      {
        requirementId: REQ1,
        remoteResourceId: REMOTE1,
        relation: "tracking-issue",
        objectId: "object-id-req1",
        confirmedRevision: "7",
        evidenceRecordId: "40000000-0000-4000-8000-000000000001",
      },
      {
        requirementId: REQ2,
        remoteResourceId: REMOTE2,
        relation: "tracking-issue",
        objectId: "object-id-req2",
        confirmedRevision: "3",
        evidenceRecordId: "40000000-0000-4000-8000-000000000002",
      },
      {
        requirementId: REQ3,
        remoteResourceId: REMOTE3,
        relation: "dashboard",
        objectId: "object-id-req3",
        confirmedRevision: "etag-9",
        evidenceRecordId: "40000000-0000-4000-8000-000000000003",
      },
    ];

    const view = buildTraceabilityView({
      requirements,
      evidenceRecords,
      remoteResources,
      pointers,
    });

    // FORWARD: requirement -> work unit -> exact object id -> RemoteResource -> confirmed revision.
    const entry1 = view.entries.find((e) => e.requirementId === REQ1);
    expect(entry1).toEqual({
      requirementId: REQ1,
      workUnitIds: [WU1],
      objectIds: ["object-id-req1"],
      remoteResources: [
        { remoteResourceId: REMOTE1, relation: "tracking-issue", confirmedRevision: "7" },
      ],
    });

    // REVERSE: RemoteResource -> requirement.
    expect(view.byRemoteResourceId[REMOTE3]).toEqual([REQ3]);
    expect(view.byRemoteResourceId[REMOTE1]).toEqual([REQ1]);

    const golden = JSON.parse(readFileSync(GOLDEN_PATH, "utf-8")) as unknown;
    expect(view).toEqual(golden);
  });
});

describe("buildTraceabilityView — MINOR-3 (adversarial-validation round): non-degenerate topology", () => {
  it("fan-IN: two DIFFERENT requirements pointing at the SAME RemoteResource both appear in byRemoteResourceId's reverse index", () => {
    const sharedRemote = "20000000-0000-4000-8000-00000000fa11";
    const reqA = "10000000-0000-4000-8000-0000000000aa";
    const reqB = "10000000-0000-4000-8000-0000000000bb";

    const view = buildTraceabilityView({
      requirements: [
        buildRequirement({ id: reqA, workUnitIds: [] }),
        buildRequirement({ id: reqB, workUnitIds: [] }),
      ],
      evidenceRecords: [],
      remoteResources: [buildRemoteResource({ id: sharedRemote, revision: "5" })],
      pointers: [
        {
          requirementId: reqA,
          remoteResourceId: sharedRemote,
          relation: "tracking-issue",
          objectId: "obj-a",
          confirmedRevision: "5",
          evidenceRecordId: "40000000-0000-4000-8000-0000000000a1",
        },
        {
          requirementId: reqB,
          remoteResourceId: sharedRemote,
          relation: "tracking-issue",
          objectId: "obj-b",
          confirmedRevision: "5",
          evidenceRecordId: "40000000-0000-4000-8000-0000000000b1",
        },
      ],
    });

    expect(view.byRemoteResourceId[sharedRemote]).toEqual([reqA, reqB]);
    expect(view.entries.find((e) => e.requirementId === reqA)?.remoteResources).toEqual([
      { remoteResourceId: sharedRemote, relation: "tracking-issue", confirmedRevision: "5" },
    ]);
    expect(view.entries.find((e) => e.requirementId === reqB)?.remoteResources).toEqual([
      { remoteResourceId: sharedRemote, relation: "tracking-issue", confirmedRevision: "5" },
    ]);
  });

  it("fan-OUT: one requirement pointing at MULTIPLE distinct RemoteResources gets all of them, each with its own revision", () => {
    const req = "10000000-0000-4000-8000-0000000000cc";
    const remoteA = "20000000-0000-4000-8000-00000000000a";
    const remoteB = "20000000-0000-4000-8000-00000000000b";

    const view = buildTraceabilityView({
      requirements: [buildRequirement({ id: req, workUnitIds: [] })],
      evidenceRecords: [],
      remoteResources: [
        buildRemoteResource({ id: remoteA, revision: "1" }),
        buildRemoteResource({ id: remoteB, revision: "2" }),
      ],
      pointers: [
        {
          requirementId: req,
          remoteResourceId: remoteA,
          relation: "tracking-issue",
          objectId: "obj",
          confirmedRevision: "1",
          evidenceRecordId: "40000000-0000-4000-8000-00000000c0a1",
        },
        {
          requirementId: req,
          remoteResourceId: remoteB,
          relation: "dashboard",
          objectId: "obj",
          confirmedRevision: "2",
          evidenceRecordId: "40000000-0000-4000-8000-00000000c0b1",
        },
      ],
    });

    const entry = view.entries.find((e) => e.requirementId === req);
    expect(entry?.remoteResources).toHaveLength(2);
    expect(entry?.remoteResources).toEqual(
      expect.arrayContaining([
        { remoteResourceId: remoteA, relation: "tracking-issue", confirmedRevision: "1" },
        { remoteResourceId: remoteB, relation: "dashboard", confirmedRevision: "2" },
      ]),
    );
    expect(view.byRemoteResourceId[remoteA]).toEqual([req]);
    expect(view.byRemoteResourceId[remoteB]).toEqual([req]);
  });

  it("a duplicate pointer to the SAME RemoteResource for one requirement collapses to one binding, not two", () => {
    const req = "10000000-0000-4000-8000-0000000000dd";
    const remote = "20000000-0000-4000-8000-00000000000d";

    const view = buildTraceabilityView({
      requirements: [buildRequirement({ id: req, workUnitIds: [] })],
      evidenceRecords: [],
      remoteResources: [buildRemoteResource({ id: remote, revision: "9" })],
      pointers: [
        {
          requirementId: req,
          remoteResourceId: remote,
          relation: "tracking-issue",
          objectId: "obj-first",
          confirmedRevision: "9",
          evidenceRecordId: "40000000-0000-4000-8000-00000000dd01",
        },
        {
          requirementId: req,
          remoteResourceId: remote,
          relation: "tracking-issue",
          objectId: "obj-second",
          confirmedRevision: "9",
          evidenceRecordId: "40000000-0000-4000-8000-00000000dd02",
        },
      ],
    });

    expect(view.entries.find((e) => e.requirementId === req)?.remoteResources).toHaveLength(1);
    expect(view.byRemoteResourceId[remote]).toEqual([req]);
  });

  it("confirmedRevision source precedence: the pointer's OWN confirmedRevision wins even when it DIVERGES from RemoteResource.revision (the pointer is the gate/done-bridge's trusted value)", () => {
    const req = "10000000-0000-4000-8000-0000000000ee";
    const remote = "20000000-0000-4000-8000-00000000000e";

    const view = buildTraceabilityView({
      requirements: [buildRequirement({ id: req, workUnitIds: [] })],
      evidenceRecords: [],
      remoteResources: [buildRemoteResource({ id: remote, revision: "stale-9" })],
      pointers: [
        {
          requirementId: req,
          remoteResourceId: remote,
          relation: "tracking-issue",
          objectId: "obj",
          confirmedRevision: "fresh-10",
          evidenceRecordId: "40000000-0000-4000-8000-00000000ee01",
        },
      ],
    });

    expect(view.entries.find((e) => e.requirementId === req)?.remoteResources).toEqual([
      { remoteResourceId: remote, relation: "tracking-issue", confirmedRevision: "fresh-10" },
    ]);
  });

  it("falls back to RemoteResource.revision when the pointer itself carries no confirmedRevision", () => {
    const req = "10000000-0000-4000-8000-0000000000ff";
    const remote = "20000000-0000-4000-8000-00000000000f";

    const view = buildTraceabilityView({
      requirements: [buildRequirement({ id: req, workUnitIds: [] })],
      evidenceRecords: [],
      remoteResources: [buildRemoteResource({ id: remote, revision: "fallback-1" })],
      pointers: [
        {
          requirementId: req,
          remoteResourceId: remote,
          relation: "tracking-issue",
          objectId: "obj",
          evidenceRecordId: "40000000-0000-4000-8000-00000000ff01",
        },
      ],
    });

    expect(view.entries.find((e) => e.requirementId === req)?.remoteResources).toEqual([
      { remoteResourceId: remote, relation: "tracking-issue", confirmedRevision: "fallback-1" },
    ]);
  });

  it("a pointer whose RemoteResource id is ABSENT from the supplied remoteResources list still produces a binding, with confirmedRevision undefined rather than silently dropping the binding", () => {
    const req = "10000000-0000-4000-8000-000000001000";
    const missingRemote = "20000000-0000-4000-8000-000000001000";

    const view = buildTraceabilityView({
      requirements: [buildRequirement({ id: req, workUnitIds: [] })],
      evidenceRecords: [],
      remoteResources: [], // deliberately empty — the resource is absent
      pointers: [
        {
          requirementId: req,
          remoteResourceId: missingRemote,
          relation: "tracking-issue",
          objectId: "obj",
          evidenceRecordId: "40000000-0000-4000-8000-000000001001",
        },
      ],
    });

    const entry = view.entries.find((e) => e.requirementId === req);
    expect(entry?.remoteResources).toHaveLength(1);
    expect(entry?.remoteResources[0]?.remoteResourceId).toBe(missingRemote);
    expect(entry?.remoteResources[0]?.confirmedRevision).toBeUndefined();
    // The binding — and hence the reverse index — is NOT silently dropped.
    expect(view.byRemoteResourceId[missingRemote]).toEqual([req]);
  });
});
