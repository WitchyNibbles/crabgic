// Crash-recovery kill-harness fixture (roadmap/23-release-hardening.md
// work item 6: "crash-before/after-remote-commit, replay"). Plain .mjs,
// mirroring `packages/gateway/src/mutation-pipeline/kill-harness-fixtures/
// nonidempotent-post-and-crash.mjs`'s own established convention exactly
// (imports this repo's already-built `@eo/journal`/`@eo/gateway` dist
// output directly) — this is a NEW fixture for this harness's own matrix,
// reusing the REAL `executeMutationPlan` pipeline and the REAL, gateway-
// declared `reconcileAmbiguousPost`/`MarkerReconciler` mechanism (never a
// bespoke reconcile-or-block re-derivation), unlike the phase-16 fixture's
// own documented "modeled here directly since 18/20 haven't landed yet"
// concession — 18/20 HAVE landed by phase 23, so this fixture wires the
// real, exported gateway reconciliation primitive instead.
import { appendFileSync, readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { createJournalStore, signalFaultPoint } from "@eo/journal";
import {
  executeMutationPlan,
  IdempotencyKeyLock,
  GatewayHttpClient,
  reconcileAmbiguousPost,
} from "@eo/gateway";

const journalDir = process.env.EO_FIXTURE_JOURNAL_DIR;
const sideEffectFile = process.env.EO_FIXTURE_SIDE_EFFECT_FILE;
const faultPoint = process.env.EO_FIXTURE_FAULT_POINT ?? "none";
const noReconcile = process.env.EO_FIXTURE_NO_RECONCILE === "1";
const plan = JSON.parse(process.env.EO_FIXTURE_PLAN_JSON);

const journal = createJournalStore({ journalDir });

// The fake remote's own durable "created objects, keyed by marker" log —
// exactly the shape a real Jira entity-property / Grafana annotation-tag
// marker mechanism backs (`@eo/gateway`'s `MarkerReconciler` interface).
const createdLogFile = `${sideEffectFile}.created.jsonl`;
const marker = plan.idempotencyKey;

function findByMarkerFromLog() {
  let content;
  try {
    content = readFileSync(createdLogFile, "utf8");
  } catch {
    return undefined;
  }
  for (const line of content.trim().split("\n")) {
    if (line.length === 0) continue;
    const record = JSON.parse(line);
    if (record.marker === marker) return record.id;
  }
  return undefined;
}

/** `@eo/gateway`'s own `MarkerReconciler` interface, backed by the fake remote's durable log above. */
const reconciler = { findByMarker: async (m) => findByMarkerFromLog(m) };

async function performCreate() {
  // Genuinely non-idempotent: a fresh id + a permanent "post" line every
  // time this runs — no check-before-create, matching a real create
  // endpoint's own behavior and making a blind retry dangerous.
  if (faultPoint === "before-network-call") {
    signalFaultPoint(faultPoint);
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  appendFileSync(sideEffectFile, "post\n");
  const id = randomUUID();
  appendFileSync(createdLogFile, `${JSON.stringify({ marker, id })}\n`);
  if (faultPoint === "after-network-call") {
    signalFaultPoint(faultPoint);
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  return { appliedRevision: id };
}

const httpClient = new GatewayHttpClient({
  allowlist: {
    allowedSchemes: ["https:"],
    allowedOrigins: ["https://connector-matrix-fixture.invalid"],
  },
  resolveHostAddresses: async () => ["203.0.113.99"],
  sendRequest: async () => {
    const applied = await performCreate();
    return { status: 201, headers: {}, bodyText: JSON.stringify(applied) };
  },
});

const handlers = {
  provider: "connector-matrix-fixture-provider",
  buildRequest: () => ({
    url: new URL("https://connector-matrix-fixture.invalid/create"),
    method: "POST",
  }),
  parseResponse: (_plan, response) => JSON.parse(response.bodyText),
  verify: async (_plan, applied) =>
    typeof applied.appliedRevision === "string" && applied.appliedRevision.length > 0,
  // THE REAL, gateway-exported reconcile-or-block mechanism — never a
  // bespoke re-derivation:
  ...(noReconcile
    ? {}
    : {
        reconcileAmbiguous: async (reconcilePlan, _cause) => {
          const result = await reconcileAmbiguousPost(reconciler, reconcilePlan.idempotencyKey);
          return result.kind === "reconciled"
            ? { appliedRevision: result.canonicalTarget }
            : undefined;
        },
      }),
};

const outcome = await executeMutationPlan(plan, handlers, {
  journal,
  httpClient,
  lock: new IdempotencyKeyLock(),
});
appendFileSync(`${sideEffectFile}.outcomes.jsonl`, `${JSON.stringify(outcome)}\n`);
process.exit(0);
