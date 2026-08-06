import { describe, expect, it } from "vitest";
import { CURRENT_SCHEMA_VERSION, type RemoteMutationPlan } from "@crabgic/contracts";
import { GRAFANA_RESOURCE_KINDS, type GrafanaResourceKind } from "../resource-kinds.js";
import { GrafanaPlanPayloadStore } from "./plan-payload-store.js";
import { grafanaFolderAttribution } from "./folder-attribution.js";

/**
 * DEFECT 16 — this connector's answer to the gateway's
 * `MutationPipelineHandlers.folderAttribution` question, i.e. the input
 * `ExternalConnection.folderAllowlist` is checked against.
 *
 * The mapping is derived per resource kind from each definition's own
 * `CANONICAL_FIELD_KEYS`, not from a guess. Census over the closed 7-kind
 * list (`../resource-kinds.ts`), each entry checked against the definition
 * module named beside it:
 *
 *   folder                (`../resources/definitions/folder.ts:14`)   — the resource IS a folder
 *   dashboard             (`../resources/definitions/dashboard.ts:14`) — `folderUid`
 *   alert-rule            (`../resources/definitions/alert-rule.ts:13`) — `folderUID` (note the case)
 *   annotation            (`../resources/definitions/annotation.ts:13`) — `dashboardUID` only; the
 *                                                                        folder is TRANSITIVE and
 *                                                                        needs a remote read
 *   contact-point         (`../resources/definitions/contact-point.ts:14`)         — org-level
 *   mute-timing           (`../resources/definitions/mute-timing.ts:13`)           — org-level
 *   notification-template (`../resources/definitions/notification-template.ts:14`) — org-level
 *
 * The exhaustiveness case at the bottom is what stops an 8th kind being
 * added with no folder ruling: it drives EVERY member of
 * `GRAFANA_RESOURCE_KINDS` through this function and requires each to land
 * in one of the three scopes deliberately.
 */
const PLAN_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";

function buildPlan(canonicalTarget: string): RemoteMutationPlan {
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    id: PLAN_ID,
    externalConnectionId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2",
    tenant: "org-1",
    canonicalTarget,
    action: "update",
    redactedDiff: "title changed",
    desiredStateHash: "sha256:folder-attribution-test",
    idempotencyKey: "folder-attribution-test-op",
    impactClass: "reversible",
    rollbackClass: "version-checked-restore",
    envelopeId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3",
  };
}

function storeWith(
  kind: GrafanaResourceKind,
  input: Readonly<Record<string, unknown>>,
): GrafanaPlanPayloadStore {
  const store = new GrafanaPlanPayloadStore();
  store.set(PLAN_ID, { kind, action: "update", input });
  return store;
}

describe("grafanaFolderAttribution — folder-bearing kinds resolve to their containing folder", () => {
  it("dashboard: folderUid names the folder the write lands in", () => {
    expect(
      grafanaFolderAttribution(
        buildPlan("dashboard:dash-1"),
        storeWith("dashboard", { title: "T", folderUid: "team-a" }),
      ),
    ).toEqual({ scope: "folders", folders: ["team-a"] });
  });

  it("alert-rule: folderUID (capitalised, unlike dashboard's) names the folder", () => {
    expect(
      grafanaFolderAttribution(
        buildPlan("alert-rule:rule-1"),
        storeWith("alert-rule", { title: "T", folderUID: "team-b" }),
      ),
    ).toEqual({ scope: "folders", folders: ["team-b"] });
  });

  /**
   * The two spellings are a real Grafana API difference, not a typo — the
   * dashboard body uses `folderUid` and the provisioning alert-rule body
   * uses `folderUID`. Reading the WRONG key would silently produce
   * `outside-folders`/`unknown` and refuse every write on a folder-scoped
   * connection, so each is pinned against the other's spelling.
   */
  it("does not cross-read the two spellings", () => {
    expect(
      grafanaFolderAttribution(
        buildPlan("dashboard:dash-1"),
        storeWith("dashboard", { folderUID: "team-a" }),
      ),
    ).toEqual({ scope: "outside-folders" });
    expect(
      grafanaFolderAttribution(
        buildPlan("alert-rule:rule-1"),
        storeWith("alert-rule", { folderUid: "team-b" }),
      ),
    ).toEqual({ scope: "unknown" });
  });

  it("folder: a write to a folder is a write IN that folder, taken from the canonical target", () => {
    // No payload needed at all — the id is on the plan.
    expect(
      grafanaFolderAttribution(buildPlan("folder:team-a"), new GrafanaPlanPayloadStore()),
    ).toEqual({ scope: "folders", folders: ["team-a"] });
  });
});

describe("grafanaFolderAttribution — the two refusal-bearing scopes are distinguished", () => {
  it("dashboard at the ROOT is outside-folders, not unknown", () => {
    // Grafana's classic API literally returns `{"folderUid":""}` for a root
    // dashboard (`../resources/definitions/dashboard.ts`), so `""` is a
    // POSITIVE statement that it lives in no folder — not missing data.
    expect(
      grafanaFolderAttribution(
        buildPlan("dashboard:dash-1"),
        storeWith("dashboard", { title: "T", folderUid: "" }),
      ),
    ).toEqual({ scope: "outside-folders" });
    expect(
      grafanaFolderAttribution(
        buildPlan("dashboard:dash-1"),
        storeWith("dashboard", { title: "T" }),
      ),
    ).toEqual({ scope: "outside-folders" });
  });

  it("alert-rule with no folder is UNKNOWN, not outside-folders — a Grafana alert rule always has one", () => {
    expect(
      grafanaFolderAttribution(
        buildPlan("alert-rule:rule-1"),
        storeWith("alert-rule", { title: "T" }),
      ),
    ).toEqual({ scope: "unknown" });
  });

  it("annotation is unknown — its folder is transitive through dashboardUID and needs a remote read", () => {
    expect(
      grafanaFolderAttribution(
        buildPlan("annotation:anno-1"),
        storeWith("annotation", { text: "x", dashboardUID: "dash-1" }),
      ),
    ).toEqual({ scope: "unknown" });
  });

  it.each(["contact-point", "mute-timing", "notification-template"] as const)(
    "%s is org-level — outside-folders",
    (kind) => {
      expect(
        grafanaFolderAttribution(buildPlan(`${kind}:x-1`), storeWith(kind, { name: "n" })),
      ).toEqual({ scope: "outside-folders" });
    },
  );

  it("a dashboard whose plan payload is missing is unknown, never admissible", () => {
    // `planCreate`/`planUpdate` stash the payload; a lost/expired store
    // entry must fail closed rather than read as "no folder".
    expect(
      grafanaFolderAttribution(buildPlan("dashboard:dash-1"), new GrafanaPlanPayloadStore()),
    ).toEqual({ scope: "unknown" });
  });

  it("a malformed canonical target is unknown rather than an exception", () => {
    // This hook runs ahead of every I/O and inside no try/catch of the
    // pipeline's — a throw here would escape `executeMutationPlan` as an
    // unexpected error instead of a typed refusal.
    expect(
      grafanaFolderAttribution(buildPlan("no-separator"), new GrafanaPlanPayloadStore()),
    ).toEqual({ scope: "unknown" });
    expect(
      grafanaFolderAttribution(buildPlan("not-a-kind:x"), new GrafanaPlanPayloadStore()),
    ).toEqual({ scope: "unknown" });
  });

  it("a non-string folderUid is unknown, not coerced", () => {
    expect(
      grafanaFolderAttribution(
        buildPlan("dashboard:dash-1"),
        storeWith("dashboard", { folderUid: 42 }),
      ),
    ).toEqual({ scope: "unknown" });
  });
});

describe("grafanaFolderAttribution — every declared resource kind has a deliberate ruling", () => {
  const EXPECTED_SCOPE: Readonly<Record<GrafanaResourceKind, string>> = {
    folder: "folders",
    dashboard: "folders",
    annotation: "unknown",
    "alert-rule": "folders",
    "contact-point": "outside-folders",
    "mute-timing": "outside-folders",
    "notification-template": "outside-folders",
  };

  it("covers all 7 kinds — an 8th kind added without a ruling fails here", () => {
    expect(Object.keys(EXPECTED_SCOPE).sort()).toEqual([...GRAFANA_RESOURCE_KINDS].sort());
    for (const kind of GRAFANA_RESOURCE_KINDS) {
      const input =
        kind === "dashboard"
          ? { folderUid: "team-a" }
          : kind === "alert-rule"
            ? { folderUID: "team-a" }
            : {};
      const attribution = grafanaFolderAttribution(
        buildPlan(`${kind}:${kind === "folder" ? "team-a" : "id-1"}`),
        storeWith(kind, input),
      );
      expect(attribution.scope, `kind ${kind}`).toBe(EXPECTED_SCOPE[kind]);
    }
  });
});
