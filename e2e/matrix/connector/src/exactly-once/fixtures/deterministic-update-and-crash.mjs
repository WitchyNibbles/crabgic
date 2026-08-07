// Crash-recovery kill-harness fixture — the DETERMINISTIC half of the
// crash-before/after-remote-commit matrix (roadmap/23-release-hardening.md
// work item 6), mirroring `packages/gateway/src/mutation-pipeline/
// kill-harness-fixtures/deterministic-put-and-crash.mjs`'s own established
// convention/rationale: a PUT-style deterministic mutation (check-before-
// apply, so re-issuing it is always a safe no-op) is what makes a
// "kill BEFORE the network call ever happened" recovery pass safe to
// converge via a plain retry — unlike the non-idempotent
// `nonidempotent-create-and-crash.mjs` fixture in this same directory
// (whose "before-network-call" case can only ever converge to `blocked`,
// by this pipeline's own deliberate, documented fail-closed design: it has
// no way to distinguish "never sent" from "sent but response lost," so it
// defers entirely to marker-reconciliation, which correctly cannot confirm
// an object that was genuinely never created).
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { createJournalStore } from "@crabgic/journal";
import { executeMutationPlan, IdempotencyKeyLock, GatewayHttpClient } from "@crabgic/gateway";

const FAULT_POINT_MARKER_PREFIX = "__EO_KILL_HARNESS_FAULT__:";
function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
async function signalFaultPoint(name) {
  process.stdout.write(`${FAULT_POINT_MARKER_PREFIX}${name}\n`);
  await delay(200);
}

const journalDir = process.env.CRABGIC_FIXTURE_JOURNAL_DIR;
const sideEffectFile = process.env.CRABGIC_FIXTURE_SIDE_EFFECT_FILE;
const faultPoint = process.env.CRABGIC_FIXTURE_FAULT_POINT ?? "none";
const plan = JSON.parse(process.env.CRABGIC_FIXTURE_PLAN_JSON);

const journal = createJournalStore({ journalDir });
const remoteStateFile = `${sideEffectFile}.remote-state.json`;
const DESIRED_REVISION = "connector-matrix-rev-1";

function readRemoteRevision() {
  try {
    return JSON.parse(readFileSync(remoteStateFile, "utf8")).revision;
  } catch {
    return undefined;
  }
}

async function performDeterministicUpdate() {
  if (readRemoteRevision() === DESIRED_REVISION) {
    // Already applied by a prior (possibly crashed) attempt — a
    // deterministic PUT/update is a safe no-op replay, never a duplicate.
    return { appliedRevision: DESIRED_REVISION };
  }
  if (faultPoint === "before-network-call") {
    await signalFaultPoint(faultPoint);
  }
  appendFileSync(sideEffectFile, "put\n");
  writeFileSync(remoteStateFile, JSON.stringify({ revision: DESIRED_REVISION }));
  if (faultPoint === "after-network-call") {
    await signalFaultPoint(faultPoint);
  }
  return { appliedRevision: DESIRED_REVISION };
}

const httpClient = new GatewayHttpClient({
  allowlist: {
    allowedSchemes: ["https:"],
    allowedOrigins: ["https://connector-matrix-fixture.invalid"],
  },
  resolveHostAddresses: async () => ["203.0.113.98"],
  sendRequest: async () => {
    const applied = await performDeterministicUpdate();
    return { status: 200, headers: {}, bodyText: JSON.stringify(applied) };
  },
});

const handlers = {
  provider: "connector-matrix-fixture-provider",
  buildRequest: () => ({
    url: new URL("https://connector-matrix-fixture.invalid/apply"),
    method: "PUT",
    hasPrecondition: true,
  }),
  parseResponse: (_plan, response) => JSON.parse(response.bodyText),
  verify: async (_plan, applied) => applied.appliedRevision === DESIRED_REVISION,
  // A deterministic PUT is always safe to redo — "reconciling" a
  // found-pending prior attempt is just performing the same idempotent
  // update again (this fixture's own documented rationale, mirroring the
  // gateway fixture it's modeled on).
  reconcileAmbiguous: async () => performDeterministicUpdate(),
};

const outcome = await executeMutationPlan(plan, handlers, {
  journal,
  httpClient,
  lock: new IdempotencyKeyLock(),
  // DEFECT 21: tenant-unscoped. Untyped here (or outside `tsc -b`), so stated
  // explicitly rather than left to default — an omitted key would read as
  // `undefined` anyway, but silence is what let this hole exist.
  tenantAllowlist: undefined,
  folderAllowlist: undefined,
});
appendFileSync(`${sideEffectFile}.outcomes.jsonl`, `${JSON.stringify(outcome)}\n`);
process.exit(0);
