/**
 * roadmap/23-release-hardening.md work item 6: "tenant boundaries." Drives
 * the REAL `@crabgic/connectors-grafana` `checkGrafanaConnectionDoctor` — the
 * concrete org/tenant-boundary enforcement roadmap/20 §In scope's Auth
 * bullet describes ("a connection-doctor check validates token scope + org
 * binding before first use") — never a reimplementation.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { checkGrafanaConnectionDoctor } from "@crabgic/connectors-grafana";
import {
  CONNECTOR_MATRIX_GATE_TAG,
  createScenarioJournal,
  emitScenarioEvidence,
  recordEmittedEvidenceIds,
} from "../support/evidence.js";
import type { ScenarioJournal } from "../support/evidence.js";

let tj: ScenarioJournal;

/**
 * The ids of every `EvidenceRecord` THIS FILE appended, accumulated across
 * the whole file (module scope, so it survives the per-test `beforeEach`
 * journal). The tagging test below reads only these back — under a shared
 * journal (`CRABGIC_RELEASE_GATE_JOURNAL_DIR`) the journal also holds every
 * sibling harness's entries, tagged for other release-gate items.
 */
const emittedIds = new Set<string>();
let recording: ReturnType<typeof recordEmittedEvidenceIds>;

beforeEach(async () => {
  tj = await createScenarioJournal();
  recording = recordEmittedEvidenceIds(tj.store, emittedIds);
});

afterEach(async () => {
  await tj.cleanup();
});

describe("tenant/org boundary — checkGrafanaConnectionDoctor", () => {
  it("a token whose org IS in the connection's declared org allowlist is accepted", async () => {
    const result = await checkGrafanaConnectionDoctor({
      fetchTokenInfo: async () => ({ orgId: 7, role: "Editor" }),
      orgAllowlist: ["7"],
    });
    expect(result.ok).toBe(true);
  });

  it("a token bound to an org OUTSIDE the connection's declared org allowlist is refused — the tenant boundary cannot be crossed by presenting a valid token for a different tenant", async () => {
    const result = await checkGrafanaConnectionDoctor({
      fetchTokenInfo: async () => ({ orgId: 99, role: "Editor" }),
      orgAllowlist: ["7"],
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.reason).toMatch(/outside this connection's org allowlist/);

    await emitScenarioEvidence({
      journal: recording,
      command:
        "connector-matrix: tenant boundary — a token bound to an out-of-allowlist org is refused",
      exitStatus: 0,
      outcomeContent: JSON.stringify(result),
    });
  });

  it("an empty org allowlist fails closed — never implicitly 'any org is fine'", async () => {
    const result = await checkGrafanaConnectionDoctor({
      fetchTokenInfo: async () => ({ orgId: 7, role: "Editor" }),
      orgAllowlist: [],
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.reason).toMatch(/empty org allowlist/);
  });

  it("a role below the required minimum is refused even when the org matches (both dimensions of the boundary are enforced)", async () => {
    const result = await checkGrafanaConnectionDoctor({
      fetchTokenInfo: async () => ({ orgId: 7, role: "Viewer" }),
      orgAllowlist: ["7"],
      minimumRole: "Editor",
    });
    expect(result.ok).toBe(false);
  });

  it("emitted evidence for this file is tagged release-gate:connector-matrix", async () => {
    // Scoped to the ids this file itself appended (see `emittedIds`): a
    // bare journal-wide read is only "this file's evidence" while the
    // journal is private, and under `CRABGIC_RELEASE_GATE_JOURNAL_DIR` it would
    // instead assert this tag over every OTHER harness's records too.
    const entries: unknown[] = [];
    for await (const entry of tj.store.queryEntries({ type: "evidence_pointer" })) {
      if (entry.type === "evidence_pointer" && emittedIds.has(entry.payload.id))
        entries.push(entry);
    }
    for (const entry of entries) {
      expect((entry as { payload: { gateTag?: string } }).payload.gateTag).toBe(
        CONNECTOR_MATRIX_GATE_TAG,
      );
    }
  });
});
