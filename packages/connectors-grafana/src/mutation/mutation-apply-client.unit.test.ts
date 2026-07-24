import { describe, expect, it } from "vitest";
import { CURRENT_SCHEMA_VERSION, type RemoteMutationPlan } from "@eo/contracts";
import { buildRouteTable, capabilityFlag } from "../discovery/route-table.js";
import { GRAFANA_RESOURCE_KINDS } from "../resource-kinds.js";
import {
  createGrafanaMutationApplyClient,
  type GrafanaRawHttpResponse,
} from "./mutation-apply-client.js";
import { buildGrafanaMutationPlan } from "./mutation-plan-builder.js";
import { GrafanaPlanPayloadStore } from "./plan-payload-store.js";
import { GrafanaRollbackSnapshotStore } from "./snapshot-store.js";

const FULL_ROUTE_TABLE = buildRouteTable(
  new Set(GRAFANA_RESOURCE_KINDS.map((kind) => capabilityFlag(kind, "legacy"))),
);
const BASE_PLAN = {
  externalConnectionId: "00000000-0000-4000-8000-000000000801",
  tenant: "tenant-1",
  envelopeId: "00000000-0000-4000-8000-000000000802",
  redactedDiff: "folder: test",
};

function buildClient(
  get: (path: string) => Promise<GrafanaRawHttpResponse> = async () => ({
    status: 200,
    headers: {},
    bodyText: "{}",
  }),
) {
  const payloadStore = new GrafanaPlanPayloadStore();
  const snapshotStore = new GrafanaRollbackSnapshotStore();
  const applyClient = createGrafanaMutationApplyClient({
    baseUrl: "https://fake-grafana.invalid",
    routeTable: FULL_ROUTE_TABLE,
    payloadStore,
    snapshotStore,
    get,
  });
  return { applyClient, payloadStore, snapshotStore };
}

describe("createGrafanaMutationApplyClient — direct unit coverage of edge branches", () => {
  it("buildRequest throws when no payload was stored for the plan", () => {
    const { applyClient } = buildClient();
    const plan = buildGrafanaMutationPlan({
      ...BASE_PLAN,
      id: "00000000-0000-4000-8000-000000000811",
      kind: "folder",
      action: "create",
      canonicalId: "uid-1",
      input: { title: "x" },
      idempotencyKey: "op-1",
    });
    expect(() => applyClient.buildRequest(plan)).toThrow(/no stored plan payload/);
  });

  it("buildRequest throws when an update plan is missing expectedRemoteRevision", () => {
    const { applyClient, payloadStore } = buildClient();
    const plan = buildGrafanaMutationPlan({
      ...BASE_PLAN,
      id: "00000000-0000-4000-8000-000000000812",
      kind: "folder",
      action: "update",
      canonicalId: "fold-1",
      input: { title: "x" },
      idempotencyKey: "op-2",
    });
    payloadStore.set(plan.id, { kind: "folder", action: "update", input: { title: "x" } });
    expect(() => applyClient.buildRequest(plan)).toThrow(/missing expectedRemoteRevision/);
  });

  it("verify returns false when no payload was stored", async () => {
    const { applyClient } = buildClient();
    const plan = buildGrafanaMutationPlan({
      ...BASE_PLAN,
      id: "00000000-0000-4000-8000-000000000813",
      kind: "folder",
      action: "create",
      canonicalId: "uid-1",
      input: { title: "x" },
      idempotencyKey: "op-3",
    });
    await expect(applyClient.verify!(plan, { appliedRevision: "1" })).resolves.toBe(false);
  });

  it("verify returns false for an annotation create whose marker is not found", async () => {
    const { applyClient, payloadStore } = buildClient();
    const plan = buildGrafanaMutationPlan({
      ...BASE_PLAN,
      id: "00000000-0000-4000-8000-000000000814",
      kind: "annotation",
      action: "create",
      canonicalId: "uid-1",
      input: { text: "x" },
      idempotencyKey: "op-4",
    });
    payloadStore.set(plan.id, { kind: "annotation", action: "create", input: { text: "x" } });
    await expect(applyClient.verify!(plan, { appliedRevision: "1" })).resolves.toBe(false);
  });

  it("verify returns false when the read-back GET fails (status >= 400)", async () => {
    const { applyClient, payloadStore } = buildClient(async () => ({
      status: 500,
      headers: {},
      bodyText: "",
    }));
    const plan = buildGrafanaMutationPlan({
      ...BASE_PLAN,
      id: "00000000-0000-4000-8000-000000000815",
      kind: "folder",
      action: "update",
      canonicalId: "fold-1",
      input: { title: "x" },
      idempotencyKey: "op-5",
      expectedRemoteRevision: "etag-1",
    });
    payloadStore.set(plan.id, { kind: "folder", action: "update", input: { title: "x" } });
    await expect(applyClient.verify!(plan, { appliedRevision: "1" })).resolves.toBe(false);
  });

  it("reconcileAmbiguous returns undefined when no payload was stored", async () => {
    const { applyClient } = buildClient();
    const plan = buildGrafanaMutationPlan({
      ...BASE_PLAN,
      id: "00000000-0000-4000-8000-000000000816",
      kind: "folder",
      action: "create",
      canonicalId: "uid-1",
      input: { title: "x" },
      idempotencyKey: "op-6",
    });
    await expect(applyClient.reconcileAmbiguous!(plan, new Error("x"))).resolves.toBeUndefined();
  });

  it("reconcileAmbiguous(create) returns undefined when the found resource's read-back GET fails", async () => {
    const { applyClient, payloadStore } = buildClient(async () => ({
      status: 404,
      headers: {},
      bodyText: "",
    }));
    const plan = buildGrafanaMutationPlan({
      ...BASE_PLAN,
      id: "00000000-0000-4000-8000-000000000817",
      kind: "folder",
      action: "create",
      canonicalId: "uid-1",
      input: { title: "x" },
      idempotencyKey: "op-7",
    });
    payloadStore.set(plan.id, { kind: "folder", action: "create", input: { title: "x" } });
    await expect(applyClient.reconcileAmbiguous!(plan, new Error("x"))).resolves.toBeUndefined();
  });

  it("reconcileAmbiguous(update) returns undefined when the read-back GET fails", async () => {
    const { applyClient, payloadStore } = buildClient(async () => ({
      status: 500,
      headers: {},
      bodyText: "",
    }));
    const plan = buildGrafanaMutationPlan({
      ...BASE_PLAN,
      id: "00000000-0000-4000-8000-000000000818",
      kind: "folder",
      action: "update",
      canonicalId: "fold-1",
      input: { title: "x" },
      idempotencyKey: "op-8",
      expectedRemoteRevision: "etag-1",
    });
    payloadStore.set(plan.id, { kind: "folder", action: "update", input: { title: "x" } });
    await expect(applyClient.reconcileAmbiguous!(plan, new Error("x"))).resolves.toBeUndefined();
  });

  it("reconcileAmbiguous(update) returns undefined when remote content does NOT match the desired state (never guesses)", async () => {
    const { applyClient, payloadStore } = buildClient(async () => ({
      status: 200,
      headers: {},
      bodyText: JSON.stringify({ title: "Something Else", parentUid: null }),
    }));
    const plan = buildGrafanaMutationPlan({
      ...BASE_PLAN,
      id: "00000000-0000-4000-8000-000000000819",
      kind: "folder",
      action: "update",
      canonicalId: "fold-1",
      input: { title: "Desired", parentUid: null },
      idempotencyKey: "op-9",
      expectedRemoteRevision: "etag-1",
    });
    payloadStore.set(plan.id, {
      kind: "folder",
      action: "update",
      input: { title: "Desired", parentUid: null },
    });
    await expect(applyClient.reconcileAmbiguous!(plan, new Error("x"))).resolves.toBeUndefined();
  });

  it("reconcileAmbiguous(update) resolves when remote content ALREADY matches the desired state", async () => {
    const { applyClient, payloadStore } = buildClient(async () => ({
      status: 200,
      headers: { etag: '"etag-2"' },
      bodyText: JSON.stringify({ title: "Desired", parentUid: null }),
    }));
    const plan = buildGrafanaMutationPlan({
      ...BASE_PLAN,
      id: "00000000-0000-4000-8000-000000000820",
      kind: "folder",
      action: "update",
      canonicalId: "fold-1",
      input: { title: "Desired", parentUid: null },
      idempotencyKey: "op-10",
      expectedRemoteRevision: "etag-1",
    });
    payloadStore.set(plan.id, {
      kind: "folder",
      action: "update",
      input: { title: "Desired", parentUid: null },
    });
    await expect(applyClient.reconcileAmbiguous!(plan, new Error("x"))).resolves.toEqual({
      appliedRevision: "etag-2",
    });
  });

  it('buildRequest throws for a plan whose action is neither "create" nor "update" (an extensible-but-unsupported action string)', () => {
    const { applyClient, payloadStore } = buildClient();
    const plan: RemoteMutationPlan = {
      schemaVersion: CURRENT_SCHEMA_VERSION,
      id: "00000000-0000-4000-8000-000000000821",
      externalConnectionId: BASE_PLAN.externalConnectionId,
      tenant: BASE_PLAN.tenant,
      canonicalTarget: "folder:fold-1",
      action: "transition",
      redactedDiff: BASE_PLAN.redactedDiff,
      desiredStateHash: "sha256:x",
      idempotencyKey: "op-11",
      impactClass: "reversible",
      rollbackClass: "version-checked-restore",
      envelopeId: BASE_PLAN.envelopeId,
    };
    payloadStore.set(plan.id, { kind: "folder", action: "update", input: { title: "x" } });
    expect(() => applyClient.buildRequest(plan)).toThrow(/unsupported action/);
  });

  it('reconcileAmbiguous resolves undefined for a plan whose action is neither "create" nor "update"', async () => {
    const { applyClient, payloadStore } = buildClient();
    const plan: RemoteMutationPlan = {
      schemaVersion: CURRENT_SCHEMA_VERSION,
      id: "00000000-0000-4000-8000-000000000822",
      externalConnectionId: BASE_PLAN.externalConnectionId,
      tenant: BASE_PLAN.tenant,
      canonicalTarget: "folder:fold-1",
      action: "transition",
      redactedDiff: BASE_PLAN.redactedDiff,
      desiredStateHash: "sha256:x",
      idempotencyKey: "op-12",
      impactClass: "reversible",
      rollbackClass: "version-checked-restore",
      envelopeId: BASE_PLAN.envelopeId,
    };
    payloadStore.set(plan.id, { kind: "folder", action: "update", input: { title: "x" } });
    await expect(applyClient.reconcileAmbiguous!(plan, new Error("x"))).resolves.toBeUndefined();
  });
});
