/**
 * `@eo/contracts` public barrel — roadmap/02-contracts-and-schemas.md,
 * "Interfaces produced": "Package `packages/contracts` — zod schemas +
 * inferred TS types + `zod-to-json-schema`-built `schemas/*.json`."
 *
 * Every cross-cutting type in the system is exported from exactly this one
 * module (the phase's own Goal statement: "Every cross-cutting type in the
 * system exists exactly once"). Downstream phases import from `@eo/contracts`
 * directly — never reach into a submodule path — so this file is the sole
 * public surface.
 *
 * Excluded deliberately: `shared/schema-version-migration.demo.ts`. It is a
 * synthetic, non-contract fixture pair ("deliberately NOT one of this
 * phase's 21 real contracts" — its own doc comment) that exists only to
 * prove out the schemaVersion+migration pattern in
 * `schema-version-migration.test.ts`; it is not one of the "shared
 * primitives" this barrel re-exports.
 *
 * A repo-wide scan (`grep -R "^export \* from" src/index.ts | wc -l`
 * against the module list below) is how a future reviewer confirms nothing
 * public was left unexported; no export collisions exist across the 30+
 * source modules re-exported here (verified: no two modules under `src/`
 * declare the same top-level exported identifier).
 */

// Shared primitives (Id/Timestamp schemas, schemaVersion field + Migration type).
export * from "./shared/ids.js";
export * from "./shared/schema-version.js";

// State machines: Run lifecycle, WorkUnitAttemptStatus, and the shared
// transition-table primitives both are built from.
export * from "./state-machines/index.js";

// HighImpactCapabilityFlag (11-member closed union, interface-ledger Gap 10).
export * from "./capability-flags/high-impact-capability-flag.js";

// LearningProposalState (11-member closed union; type of LearningProposal.state).
export * from "./learning/learning-proposal-state.js";

// JournalEntryType (13-member closed union, interface-ledger Gap 5).
export * from "./journal/journal-entry-type.js";

// GATEWAY_MCP_SERVER_NAME (interface-ledger Gap 11 — see ./gateway/server-name.ts
// for the sole-definition-site scanner this file must not trip).
export * from "./gateway/server-name.js";

// Config precedence resolver + its security-key declarations.
export * from "./config/security-keys.js";
export * from "./config/precedence.js";

// Canonical connector-error union (10 members) + redacting constructors.
export * from "./errors/connector-error.js";

// renderer-core: length/line counters + attribution-token scanner primitives.
export * from "./renderer-core/index.js";

// The 21 contracts (zod schemas + inferred types), alphabetized by contract name.
export * from "./contracts/authorization-envelope.js";
export * from "./contracts/capability-manifest.js";
export * from "./contracts/capability-snapshot.js";
export * from "./contracts/change-set.js";
export * from "./contracts/communication-policy.js";
export * from "./contracts/evidence-record.js";
export * from "./contracts/external-connection.js";
export * from "./contracts/intent-contract.js";
export * from "./contracts/learning-proposal.js";
export * from "./contracts/performance-contract.js";
export * from "./contracts/project-profile.js";
export * from "./contracts/remote-mutation-plan.js";
export * from "./contracts/remote-operation-record.js";
export * from "./contracts/remote-resource.js";
export * from "./contracts/rendered-artifact.js";
export * from "./contracts/requirement.js";
export * from "./contracts/run-snapshot.js";
export * from "./contracts/stack-evidence.js";
export * from "./contracts/task-packet.js";
export * from "./contracts/work-unit.js";
export * from "./contracts/worker-result.js";
