import { mkdirSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadArtifacts, resolveArtifactStorePath, saveArtifacts } from "./artifact-store.js";

/**
 * The design and plan records have to outlive the call that submitted them:
 * `plan-covers-every-design-element` scores the plan against the DESIGN's elements,
 * and the two arrive in different stages. Handing the plan stage its own reference
 * set would be asking the party being checked to supply what it is checked against.
 */

let home: string;

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "eo-artifacts-"));
});

afterEach(async () => {
  await rm(home, { recursive: true, force: true });
});

const env = (): { HOME: string; XDG_STATE_HOME: string } => ({
  HOME: home,
  XDG_STATE_HOME: join(home, "state"),
});

const CHANGE_SET = "22222222-2222-4222-8222-222222222222";
const OTHER_CHANGE_SET = "33333333-3333-4333-8333-333333333333";

const design = (changeSetId = CHANGE_SET) => ({
  schemaVersion: 1 as const,
  changeSetId,
  elements: [{ id: "e1", name: "the store", addresses: [] }],
  interfaces: [],
  risks: [],
});

const plan = (changeSetId = CHANGE_SET) => ({
  schemaVersion: 1 as const,
  changeSetId,
  tasks: [{ id: "t1", statement: "build it", doneCriteria: ["tests pass"], dependsOn: [], covers: ["e1"] }],
});

describe("artifact store", () => {
  it("round-trips a design record", async () => {
    const path = resolveArtifactStorePath(env(), "p");
    await saveArtifacts(path, CHANGE_SET, { design: design() }, join(home, "state"));
    expect((await loadArtifacts(path, CHANGE_SET)).design).toEqual(design());
  });

  it("reads an absent store as empty", async () => {
    expect(await loadArtifacts(resolveArtifactStorePath(env(), "fresh"), CHANGE_SET)).toEqual({});
  });

  /**
   * The property the plan stage depends on. A submission carrying only a plan must
   * not erase the design — that record is exactly what the plan is scored against.
   */
  it("keeps the design when a later submission carries only a plan", async () => {
    const path = resolveArtifactStorePath(env(), "p");
    const state = join(home, "state");
    await saveArtifacts(path, CHANGE_SET, { design: design() }, state);
    await saveArtifacts(path, CHANGE_SET, { plan: plan() }, state);

    const stored = await loadArtifacts(path, CHANGE_SET);
    expect(stored.design).toEqual(design());
    expect(stored.plan).toEqual(plan());
  });

  it("keeps two ChangeSets' artifacts apart", async () => {
    const path = resolveArtifactStorePath(env(), "p");
    const state = join(home, "state");
    await saveArtifacts(path, CHANGE_SET, { design: design() }, state);
    await saveArtifacts(path, OTHER_CHANGE_SET, { design: design(OTHER_CHANGE_SET) }, state);

    expect((await loadArtifacts(path, CHANGE_SET)).design?.changeSetId).toBe(CHANGE_SET);
    expect((await loadArtifacts(path, OTHER_CHANGE_SET)).design?.changeSetId).toBe(
      OTHER_CHANGE_SET,
    );
  });

  it("supersedes an earlier record for the same kind", async () => {
    const path = resolveArtifactStorePath(env(), "p");
    const state = join(home, "state");
    await saveArtifacts(path, CHANGE_SET, { design: design() }, state);
    const revised = { ...design(), elements: [{ id: "e2", name: "the other store", addresses: [] }] };
    await saveArtifacts(path, CHANGE_SET, { design: revised }, state);
    expect((await loadArtifacts(path, CHANGE_SET)).design).toEqual(revised);
  });

  /**
   * Field-by-field validation: a malformed plan must not take a valid design down
   * with it, because the design is the reference set a later stage needs.
   */
  it("drops a malformed plan without losing the design beside it", async () => {
    const path = resolveArtifactStorePath(env(), "p");
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(
      path,
      JSON.stringify({ [CHANGE_SET]: { design: design(), plan: { tasks: "not a list" } } }),
      { mode: 0o600 },
    );
    const stored = await loadArtifacts(path, CHANGE_SET);
    expect(stored.design).toEqual(design());
    expect(stored.plan).toBeUndefined();
  });

  it("reads an unparseable store as empty rather than throwing mid-review", async () => {
    const path = resolveArtifactStorePath(env(), "p");
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, "{ not json", { mode: 0o600 });
    expect(await loadArtifacts(path, CHANGE_SET)).toEqual({});
  });
});
