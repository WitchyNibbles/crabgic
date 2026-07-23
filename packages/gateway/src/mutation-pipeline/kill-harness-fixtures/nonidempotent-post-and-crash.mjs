// Kill-harness fixture (roadmap/16-gateway-core.md §Test plan, Conformance
// + §In scope "Ambiguity": "ambiguous POST timeout → search marker before
// retry; unresolvable → canonical `ambiguous_write`... block — never a
// guessed duplicate"). MEDIUM/HIGH #3's own required case: a genuinely
// NON-idempotent POST/create action — re-issuing the identical POST
// creates a SECOND, distinct remote object (unlike the deterministic-PUT
// fixture, this one has no natural "already applied, no-op" check).
//
// Models a create endpoint that assigns a fresh ID per call and appends a
// permanent, irreversible "post" line to `sideEffectFile` each time it is
// actually invoked — a double-create shows up as TWO such lines. Also
// models the marker-reconciliation mechanism this phase declares
// (`../reconciliation.js`): every create embeds a deterministic marker
// (derived from `plan.idempotencyKey`) in the fake remote's own durable
// "created objects" log, so a later restart can search for that marker
// BEFORE ever risking a second POST — exactly 18/20's own responsibility
// per this phase's interface (`MarkerReconciler`), modeled here directly
// since 18/20 haven't landed yet.
import { appendFileSync, readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { createJournalStore } from "@eo/journal";
import { executeMutationPlan, IdempotencyKeyLock, GatewayHttpClient } from "@eo/gateway";

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
const noReconcile = process.env.EO_FIXTURE_NO_RECONCILE === "1";
const plan = JSON.parse(process.env.EO_FIXTURE_PLAN_JSON);

const journal = createJournalStore({ journalDir });

// The fake remote's own durable "created objects" log — one line per
// object actually created, `{ marker, id }`. A real create endpoint would
// store the marker as a Jira entity property / Grafana annotation tag.
const createdLogFile = `${sideEffectFile}.created.jsonl`;
const marker = `marker-${plan.idempotencyKey}`;

function findByMarker() {
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

async function performCreate() {
  // The actual, non-idempotent network side effect: a fresh object every
  // single time this function runs — no check-before-create here, unlike
  // the deterministic-PUT fixture, which is exactly what makes a blind
  // retry dangerous for this action.
  if (faultPoint === "before-network-call") {
    await signalFaultPoint(faultPoint);
  }
  appendFileSync(sideEffectFile, "post\n");
  const id = randomUUID();
  appendFileSync(createdLogFile, `${JSON.stringify({ marker, id })}\n`);
  if (faultPoint === "after-network-call") {
    await signalFaultPoint(faultPoint);
  }
  return { appliedRevision: id };
}

const httpClient = new GatewayHttpClient({
  allowlist: { allowedSchemes: ["https:"], allowedOrigins: ["https://fake-provider.invalid"] },
  resolveHostAddresses: async () => ["203.0.113.7"],
  sendRequest: async () => {
    const applied = await performCreate();
    return { status: 201, headers: {}, bodyText: JSON.stringify(applied) };
  },
});

const handlers = {
  provider: "fake-provider",
  buildRequest: () => ({
    url: new URL("https://fake-provider.invalid/create"),
    method: "POST",
  }),
  parseResponse: (_plan, response) => JSON.parse(response.bodyText),
  verify: async (_plan, applied) =>
    typeof applied.appliedRevision === "string" && applied.appliedRevision.length > 0,
  // Marker-reconciliation (`../reconciliation.js`'s own philosophy,
  // modeled directly by this fixture since 18/20 haven't landed): search
  // for an object already carrying this operation's marker BEFORE ever
  // considering a fresh POST. Omitted entirely when
  // EO_FIXTURE_NO_RECONCILE=1, to exercise this pipeline's OWN fail-closed
  // default (block, never guess) with no hook available at all.
  ...(noReconcile
    ? {}
    : {
        reconcileAmbiguous: async () => {
          const existingId = findByMarker();
          return existingId === undefined ? undefined : { appliedRevision: existingId };
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
