// Kill-harness fixture (roadmap/05-supervisor-daemon.md §Test plan,
// Integration: "kill -9 mid-operation → restart → registries recovered
// via 04's recover(runId) with no duplicated side effect (reuse 04's
// runKillHarness)"). Plain .mjs, matching @eo/journal's own
// kill-harness-fixtures/*.mjs convention (a raw spawnable Node script, no
// TypeScript compilation needed at kill-harness spawn time) — imports
// @eo/journal's already-built dist output directly.
import { createJournalStore } from "@eo/journal";

const journalDir = process.env.EO_KILL_HARNESS_JOURNAL_DIR;
const runId = process.env.EO_KILL_HARNESS_RUN_ID;
const changeSetId = process.env.EO_KILL_HARNESS_CHANGE_SET_ID;
const faultPoint = process.env.EO_KILL_HARNESS_FAULT_POINT;

const FAULT_POINT_MARKER_PREFIX = "__EO_KILL_HARNESS_FAULT__:";
function signalFaultPoint(name) {
  process.stdout.write(`${FAULT_POINT_MARKER_PREFIX}${name}\n`);
}

const store = createJournalStore({ journalDir });

await store.appendEntry({
  type: "run_transition",
  runId,
  changeSetId,
  payload: { from: "draft", to: "awaiting_approval" },
});

if (faultPoint === "before-second-transition") {
  signalFaultPoint(faultPoint);
}

await store.appendEntry({
  type: "run_transition",
  runId,
  changeSetId,
  payload: { from: "awaiting_approval", to: "ready" },
});

if (faultPoint === "after-second-transition") {
  signalFaultPoint(faultPoint);
}

process.exit(0);
