// Kill-harness fixture (roadmap/16-gateway-core.md §Test plan, Conformance:
// "exactly-once crash matrix reusing 04's runKillHarness — kill before/
// after the remote-commit point"). Plain .mjs, matching @eo/journal's own
// and @eo/supervisor's `kill-harness-fixtures/*.mjs` convention — imports
// both packages' already-built dist output directly.
//
// Models a realistic PUT/PATCH-style DETERMINISTIC mutation (roadmap/16
// §In scope, "Retry ladder": "PUT/PATCH deterministic + precondition
// only"): the fake remote's own durable state (a JSON file standing in
// for a real provider's database row) is checked BEFORE mutating it, so
// re-issuing the identical PUT is always a safe no-op. This fixture's own
// `reconcileAmbiguous` hook exploits exactly that property — "reconciling"
// a found-pending prior attempt is nothing more than redoing the same
// deterministic PUT, which is why HIGH/MEDIUM #3's fix (never blindly
// retrying without an explicit reconciliation hook) does not regress this
// fixture's own exactly-once behavior.
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { createJournalStore } from "@eo/journal";
import {
  executeMutationPlan,
  IdempotencyKeyLock,
  GatewayHttpClient,
} from "@eo/gateway";

const FAULT_POINT_MARKER_PREFIX = "__EO_KILL_HARNESS_FAULT__:";
function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
async function signalFaultPoint(name) {
  process.stdout.write(`${FAULT_POINT_MARKER_PREFIX}${name}\n`);
  await delay(200);
}

const journalDir = process.env.EO_FIXTURE_JOURNAL_DIR;
const sideEffectFile = process.env.EO_FIXTURE_SIDE_EFFECT_FILE;
const faultPoint = process.env.EO_FIXTURE_FAULT_POINT ?? "none";
const plan = JSON.parse(process.env.EO_FIXTURE_PLAN_JSON);

const journal = createJournalStore({ journalDir });
const remoteStateFile = `${sideEffectFile}.remote-state.json`;
const DESIRED_REVISION = "rev-1";

function readRemoteRevision() {
  try {
    return JSON.parse(readFileSync(remoteStateFile, "utf8")).revision;
  } catch {
    return undefined;
  }
}

async function performDeterministicPut() {
  if (readRemoteRevision() === DESIRED_REVISION) {
    // Already applied by a prior (possibly crashed) attempt — a
    // deterministic PUT is a no-op replay, never a duplicate side effect.
    return { appliedRevision: DESIRED_REVISION };
  }
  if (faultPoint === "before-network-call") {
    await signalFaultPoint(faultPoint);
  }
  appendFileSync(sideEffectFile, "put\n"); // the one real network side effect
  writeFileSync(remoteStateFile, JSON.stringify({ revision: DESIRED_REVISION }));
  if (faultPoint === "after-network-call") {
    await signalFaultPoint(faultPoint);
  }
  return { appliedRevision: DESIRED_REVISION };
}

const httpClient = new GatewayHttpClient({
  allowlist: { allowedSchemes: ["https:"], allowedOrigins: ["https://fake-provider.invalid"] },
  resolveHostAddresses: async () => ["203.0.113.7"],
  sendRequest: async () => {
    const applied = await performDeterministicPut();
    return { status: 200, headers: {}, bodyText: JSON.stringify(applied) };
  },
});

const handlers = {
  provider: "fake-provider",
  buildRequest: () => ({
    url: new URL("https://fake-provider.invalid/apply"),
    method: "PUT",
    hasPrecondition: true,
  }),
  parseResponse: (_plan, response) => JSON.parse(response.bodyText),
  verify: async (_plan, applied) => applied.appliedRevision === DESIRED_REVISION,
  // Deterministic PUT is always safe to redo — "reconciling" a found-
  // pending prior attempt is just performing the same idempotent PUT again.
  reconcileAmbiguous: async () => performDeterministicPut(),
};

const outcome = await executeMutationPlan(plan, handlers, {
  journal,
  httpClient,
  lock: new IdempotencyKeyLock(),
});
appendFileSync(`${sideEffectFile}.outcomes.jsonl`, `${JSON.stringify(outcome)}\n`);
process.exit(0);
