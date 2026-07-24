/**
 * Golden TaskPacket generation — roadmap/13-scheduler-packets-context.md
 * §Work items 2: "TaskPacket builder + budget enforcement + golden packets
 * + the ephemeral lesson-preamble slot." Mirrors `packages/engine-core/src/
 * goldens/generate-golden-artifacts.ts` and `packages/supervisor/src/
 * intake/goldens/generate-golden-artifacts.ts`'s own documented convention:
 * pure in-memory build (no filesystem I/O here), `JSON.stringify(value,
 * null, 2)` plus exactly one trailing newline, stable key order.
 *
 * Every input below is a fixed literal (no id/clock provider) — `
 * buildTaskPacket` takes every identifying field as an explicit argument,
 * so determinism across two consecutive in-process builds holds by
 * construction, without needing a seeded provider the way contract
 * fixtures do.
 */
import { buildAuthorizationEnvelope } from "@eo/testkit";
import { buildTaskPacket } from "../task-packet-builder.js";

export interface GoldenArtifact {
  readonly relativePath: string;
  readonly content: string;
}

function serialize(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

const FIXTURE_ENVELOPE = buildAuthorizationEnvelope({
  id: "aaaaaaaa-0000-4000-8000-000000000001",
  changeSetId: "aaaaaaaa-0000-4000-8000-000000000002",
  createdAt: "2026-01-01T00:00:00.000Z",
  ownedPaths: ["packages/example/src/", "packages/example/src/nested/"],
  commands: ["npm run build", "npm run test", "git status", "git diff"],
});

const BASE_OBJECT_ID = "0123456789abcdef0123456789abcdef01234567";

/** A minimal, everything-defaulted packet — the floor case. */
function buildMinimalGoldenPacket() {
  return buildTaskPacket({
    id: "bbbbbbbb-0000-4000-8000-000000000001",
    workUnitId: "bbbbbbbb-0000-4000-8000-000000000002",
    requirementIds: [],
    objective: "Implement the deterministic golden fixture's minimal case.",
    baseObjectId: BASE_OBJECT_ID,
    ownedPaths: ["packages/example/src/"],
    resourceLimits: { maxTurns: 20 },
    resultSchema: { type: "object" },
    envelope: FIXTURE_ENVELOPE,
  }).packet;
}

/** A fully-populated packet exercising every optional field, incl. a narrower allowedCommands scope. */
function buildFullGoldenPacket() {
  return buildTaskPacket({
    id: "cccccccc-0000-4000-8000-000000000001",
    workUnitId: "cccccccc-0000-4000-8000-000000000002",
    requirementIds: ["dddddddd-0000-4000-8000-000000000001"],
    objective: "Implement the deterministic golden fixture's fully-populated case.",
    nonGoals: ["Do not refactor unrelated modules."],
    baseObjectId: BASE_OBJECT_ID,
    relevantInterfaces: ["@eo/contracts#WorkUnit", "@eo/engine-core#EngineAdapter"],
    ownedPaths: ["packages/example/src/", "packages/example/src/nested/"],
    allowedCommands: ["npm run build", "npm run test"],
    additionalConstraints: ["Never modify packages/example/src/legacy/**."],
    gates: ["coverage", "lint"],
    resourceLimits: { maxTurns: 40, maxBudgetUsd: 5 },
    resultSchema: { type: "object", properties: { outcome: { type: "string" } } },
    envelope: FIXTURE_ENVELOPE,
  }).packet;
}

/** Golden packets this phase commits — see `../../goldens/README.md` note in the evidence doc for byte-stability rationale. */
export function buildGoldenTaskPackets(): readonly GoldenArtifact[] {
  return [
    { relativePath: "task-packet-minimal.json", content: serialize(buildMinimalGoldenPacket()) },
    { relativePath: "task-packet-full.json", content: serialize(buildFullGoldenPacket()) },
  ];
}
