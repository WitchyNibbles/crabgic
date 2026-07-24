import { describe, expect, it } from "vitest";
import {
  buildWorkUnitGraph,
  CyclicWorkUnitGraphError,
  findUnmappedRequirements,
  type WorkUnitDraft,
} from "./dag-builder.js";

const CHANGE_SET_ID = "22222222-2222-4222-8222-222222222222";
const REQ_A = "aaaaaaaa-1111-4111-8111-111111111111";
const REQ_B = "bbbbbbbb-1111-4111-8111-111111111111";
const WU_1 = "11111111-1111-4111-8111-111111111111";
const WU_2 = "22222222-1111-4111-8111-111111111111";
const WU_3 = "33333333-1111-4111-8111-111111111111";

function draft(overrides: Partial<WorkUnitDraft> & { id: string }): WorkUnitDraft {
  return {
    title: "unit",
    requirementIds: [],
    dependsOn: [],
    role: "implementation",
    ownedPaths: ["packages/example/src/"],
    ...overrides,
  };
}

describe("buildWorkUnitGraph", () => {
  it("builds a schema-valid WorkUnit list and a topologically-sorted integration order", () => {
    const graph = buildWorkUnitGraph({
      changeSetId: CHANGE_SET_ID,
      requirementIds: [REQ_A, REQ_B],
      workUnits: [
        draft({ id: WU_1, requirementIds: [REQ_A] }),
        draft({ id: WU_2, requirementIds: [REQ_B], dependsOn: [WU_1] }),
        draft({ id: WU_3, dependsOn: [WU_2] }),
      ],
    });
    expect(graph.integrationOrder).toEqual([WU_1, WU_2, WU_3]);
    expect(graph.workUnits).toHaveLength(3);
    expect(graph.workUnits[0]!.changeSetId).toBe(CHANGE_SET_ID);
  });

  it("buildWorkUnitGraph tolerates an incomplete DAG (draft-time, coverage checked later at the ready gate)", () => {
    const graph = buildWorkUnitGraph({
      changeSetId: CHANGE_SET_ID,
      requirementIds: [REQ_A, REQ_B],
      workUnits: [draft({ id: WU_1, requirementIds: [REQ_A] })],
    });
    expect(graph.workUnits).toHaveLength(1);
  });

  it("findUnmappedRequirements reports every requirement with no owning WorkUnit", () => {
    expect(findUnmappedRequirements([REQ_A, REQ_B], [{ requirementIds: [REQ_A] }])).toEqual([
      REQ_B,
    ]);
    expect(findUnmappedRequirements([REQ_A], [{ requirementIds: [REQ_A] }])).toEqual([]);
  });

  it("throws CyclicWorkUnitGraphError for a non-DAG dependsOn graph", () => {
    expect(() =>
      buildWorkUnitGraph({
        changeSetId: CHANGE_SET_ID,
        requirementIds: [],
        workUnits: [draft({ id: WU_1, dependsOn: [WU_2] }), draft({ id: WU_2, dependsOn: [WU_1] })],
      }),
    ).toThrow(CyclicWorkUnitGraphError);
  });

  it("a diamond-shaped DAG (shared dependency, multi-parent join) sorts correctly", () => {
    const WU_4 = "44444444-1111-4111-8111-111111111111";
    const graph = buildWorkUnitGraph({
      changeSetId: CHANGE_SET_ID,
      requirementIds: [],
      workUnits: [
        draft({ id: WU_1 }),
        draft({ id: WU_2, dependsOn: [WU_1] }),
        draft({ id: WU_3, dependsOn: [WU_1] }),
        draft({ id: WU_4, dependsOn: [WU_2, WU_3] }),
      ],
    });
    expect(graph.integrationOrder[0]).toBe(WU_1);
    expect(graph.integrationOrder[3]).toBe(WU_4);
    expect(new Set(graph.integrationOrder)).toEqual(new Set([WU_1, WU_2, WU_3, WU_4]));
  });

  it("an empty WorkUnit list with no requirements builds an empty, valid graph", () => {
    const graph = buildWorkUnitGraph({
      changeSetId: CHANGE_SET_ID,
      requirementIds: [],
      workUnits: [],
    });
    expect(graph.workUnits).toEqual([]);
    expect(graph.integrationOrder).toEqual([]);
  });
});
