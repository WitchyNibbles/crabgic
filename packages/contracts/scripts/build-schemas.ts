/**
 * JSON Schema build script — roadmap/02-contracts-and-schemas.md work item 1
 * ("`zod-to-json-schema` build emitting `schemas/*.json`") and the
 * byte-stability exit criterion ("JSON Schema artifacts byte-stable across
 * two consecutive builds (empty diff)").
 *
 * Run with `npm run build:schemas` from `packages/contracts` (or
 * `node scripts/build-schemas.ts` after `npx tsc -b packages/contracts`).
 * `package.json`'s `build:schemas` script runs `tsc -b` first automatically.
 *
 * Execution choice (documented per this worker's brief, "your choice,
 * document it"): this script imports the already-**compiled**
 * `../dist/index.js` barrel rather than the `../src` TypeScript sources
 * directly. Two reasons: (1) `../src`'s own relative imports carry the
 * NodeNext `.js` extension convention pointing at sibling `.ts` files
 * (`src/shared/ids.js` -> `ids.ts`); Node's native type-stripping (no flag
 * needed — confirmed default-on under this repo's pinned `node@24.18.0`,
 * `engines: { node: ">=24" }`) does NOT perform that TS-style `.js`->`.ts`
 * remapping for plain relative specifiers, only for specifiers using the
 * literal `.ts` extension — so importing `../src/index.js` from a
 * type-stripped script fails to resolve. (2) Building from `dist/` also
 * means this script exercises the exact compiled artifact every downstream
 * consumer actually imports, not a parallel unbuilt copy of the schemas.
 * The script itself is plain, flag-free `.ts`, run directly by
 * `node scripts/build-schemas.ts` (Node 24's own native stripping handles
 * the leftover type annotations in this file).
 *
 * Determinism (byte-stability exit criterion):
 *  - `$refStrategy: "none"` — every contract is converted independently and
 *    fully inlined (no `$ref`/`definitions` indirection), so ajv can
 *    `compile()` each `schemas/*.json` file completely standalone (no
 *    external registry) — the same setting testkit's ajv integration
 *    harness relies on (see `packages/testkit/src/ajv-harness.ts`).
 *  - `target: "jsonSchema7"` — draft-07, ajv 8's default supported dialect
 *    (no need for `ajv/dist/2019`), and matches `ajv-formats`' `uuid`/
 *    `date-time` format keywords used by `IdSchema`/`TimestampSchema`.
 *  - Key ordering is "as produced" by `zod-to-json-schema` — that library's
 *    own object-literal construction order is itself stable/deterministic
 *    run-to-run for a given zod schema (no key-sorting pass is applied here
 *    on top of it — sorting would diverge from what `zod-to-json-schema`
 *    actually emits and isn't needed for byte-stability, since the same
 *    input schema always produces the same key order).
 *  - `JSON.stringify(schema, null, 2)` — fixed 2-space indentation — plus
 *    one trailing `\n` appended to every file.
 *  - Emission order: the 21 contracts are processed in a fixed, alphabetized
 *    (by output filename) array — never `Object.keys` iteration order,
 *    which is not guaranteed stable across V8 versions for all key shapes.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import {
  AuthorizationEnvelopeSchema,
  CapabilityManifestSchema,
  CapabilitySnapshotSchema,
  ChangeSetSchema,
  CommunicationPolicySchema,
  EvidenceRecordSchema,
  ExternalConnectionSchema,
  IntentContractSchema,
  LearningProposalSchema,
  PerformanceContractSchema,
  ProjectProfileSchema,
  RemoteMutationPlanSchema,
  RemoteOperationRecordSchema,
  RemoteResourceSchema,
  RenderedArtifactSchema,
  RequirementSchema,
  RunSnapshotSchema,
  StackEvidenceSchema,
  TaskPacketSchema,
  WorkUnitSchema,
  WorkerResultSchema,
} from "../dist/index.js";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = join(SCRIPT_DIR, "..");
const SCHEMAS_DIR = join(PACKAGE_ROOT, "schemas");

/**
 * The 21 contracts (roadmap/02 §In scope, "Contracts (zod + JSON Schema
 * export, 21)" list), each paired with its `schemas/<kebab-name>.json`
 * output filename. Kept in the exact order that list is written in the
 * roadmap file, then sorted alphabetically by filename below for
 * deterministic emission order — the fixed array literal itself is the
 * single source of truth for "all 21 present," not a directory scan.
 */
const CONTRACTS: ReadonlyArray<{ readonly fileName: string; readonly schema: z.ZodTypeAny }> = [
  { fileName: "project-profile", schema: ProjectProfileSchema },
  { fileName: "stack-evidence", schema: StackEvidenceSchema },
  { fileName: "intent-contract", schema: IntentContractSchema },
  { fileName: "requirement", schema: RequirementSchema },
  { fileName: "authorization-envelope", schema: AuthorizationEnvelopeSchema },
  { fileName: "capability-manifest", schema: CapabilityManifestSchema },
  { fileName: "performance-contract", schema: PerformanceContractSchema },
  { fileName: "change-set", schema: ChangeSetSchema },
  { fileName: "work-unit", schema: WorkUnitSchema },
  { fileName: "task-packet", schema: TaskPacketSchema },
  { fileName: "worker-result", schema: WorkerResultSchema },
  { fileName: "evidence-record", schema: EvidenceRecordSchema },
  { fileName: "external-connection", schema: ExternalConnectionSchema },
  { fileName: "capability-snapshot", schema: CapabilitySnapshotSchema },
  { fileName: "remote-mutation-plan", schema: RemoteMutationPlanSchema },
  { fileName: "remote-operation-record", schema: RemoteOperationRecordSchema },
  { fileName: "remote-resource", schema: RemoteResourceSchema },
  { fileName: "communication-policy", schema: CommunicationPolicySchema },
  { fileName: "rendered-artifact", schema: RenderedArtifactSchema },
  { fileName: "learning-proposal", schema: LearningProposalSchema },
  { fileName: "run-snapshot", schema: RunSnapshotSchema },
].slice() as ReadonlyArray<{ readonly fileName: string; readonly schema: z.ZodTypeAny }>;

if (CONTRACTS.length !== 21) {
  throw new Error(`Expected exactly 21 contracts, found ${CONTRACTS.length}.`);
}

const sortedContracts = [...CONTRACTS].sort((a, b) => a.fileName.localeCompare(b.fileName));

mkdirSync(SCHEMAS_DIR, { recursive: true });

for (const { fileName, schema } of sortedContracts) {
  const jsonSchema = zodToJsonSchema(schema, {
    target: "jsonSchema7",
    $refStrategy: "none",
  });
  const serialized = `${JSON.stringify(jsonSchema, null, 2)}\n`;
  const outPath = join(SCHEMAS_DIR, `${fileName}.json`);
  writeFileSync(outPath, serialized, "utf8");
  process.stdout.write(`wrote ${outPath}\n`);
}

process.stdout.write(`done: ${sortedContracts.length} schema files written to ${SCHEMAS_DIR}\n`);
