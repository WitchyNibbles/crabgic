import { describe, expect, it } from "vitest";
import type { MutationPipelineOutcome } from "@crabgic/gateway";
import {
  createRecordingJournal,
  JIRA_SECURITY_FIXTURE_MATRIX,
  JIRA_TENANT_BOUNDARY_FORGED_TENANT,
  JIRA_TENANT_BOUNDARY_IN_ALLOWLIST_TENANT,
  makeJiraTenantBoundaryBreachScenario,
} from "./tenant-boundary-scenario.js";

/**
 * Pins the ORACLE of phase 18's tenant-boundary fixture, from day one.
 *
 * Defect `20-fault-injection-scenarios-have-unpinned-oracles` measured what
 * happens when a gate rides on an unpinned scenario: mutating a scenario's own
 * verdict (`passed: result.ok === false` → `passed: true`) left 83 files / 660
 * tests green across two packages. The gate faithfully reported whatever the
 * scenario concluded, and nothing pinned the scenario.
 *
 * So every direction this scenario can be broken in has a test here:
 *  - it must PASS against the real, intact enforcement (S1 — the control that
 *    is green before AND after, and that a fail-everything implementation
 *    could not satisfy together with S4);
 *  - it must FAIL when the executor accepts the forged-tenant plan (S3);
 *  - it must FAIL when the executor refuses EVERYTHING, including the
 *    in-allowlist control plan (S4);
 *  - it must FAIL when the "breach" plan does not actually declare an
 *    out-of-allowlist tenant (S5) — i.e. the verdict is a function of the
 *    DECLARED tenant, not a constant;
 *  - its pass detail must carry the scope sentence and must not overclaim
 *    (S6), and its fail details must not contain the pass detail's anchor
 *    phrase (S7), so an assertion on the detail cannot match both worlds.
 *
 * ⚠️ WHAT THIS FILE CANNOT PROVE. S3-S5 drive INJECTED executors. No
 * in-process test can prove the DEFAULT `executor` argument stays wired to
 * `@crabgic/gateway`'s real `executeMutationPlan` — a regression could point
 * it at a behaviourally faithful frozen copy and every test here would stay
 * green. S1 narrows that (it drives the real default executor into BOTH its
 * refuse and its admit branch, so it dies under an always-refuse and under an
 * always-accept rewiring), but the coupling proof is the committed deletion
 * probe `docs/evidence/phase-21/fix-21c5-jira-tenant-boundary-probe-batchH.txt`:
 * delete the `refuseOutOfAllowlistTenant` consultation in
 * `packages/gateway/src/mutation-pipeline/mutation-pipeline.ts`, rebuild, and
 * this file goes red.
 */

/** An executor that admits every plan — i.e. the world in which the enforcement was deleted. */
const alwaysAdmit = async (): Promise<MutationPipelineOutcome> => ({
  status: "recorded",
  appliedRevision: "rev-stub",
});

/** An executor that refuses every plan — the "fail everything" enforcement a naive gate would call correct. */
const alwaysRefuse = async (): Promise<MutationPipelineOutcome> => ({
  status: "failed",
  errorKind: "policy_blocked",
  detail: "stub refuses everything",
});

const PASS_DETAIL_ANCHOR = "positive control: the in-allowlist plan was admitted";

describe("Jira tenant-boundary breach scenario", () => {
  it("S2: the exported matrix is the zero-argument product of the factory and is non-empty", () => {
    expect(JIRA_SECURITY_FIXTURE_MATRIX.length).toBeGreaterThan(0);
    expect(JIRA_SECURITY_FIXTURE_MATRIX.every((s) => s.category === "tenant-boundary")).toBe(true);
    const [scenario] = JIRA_SECURITY_FIXTURE_MATRIX;
    expect(scenario!.name).toBe(makeJiraTenantBoundaryBreachScenario().name);
    expect(JIRA_TENANT_BOUNDARY_IN_ALLOWLIST_TENANT).not.toBe(JIRA_TENANT_BOUNDARY_FORGED_TENANT);
  });

  it("S1 (control, green before AND after the fix): the DEFAULT scenario passes against the real, intact enforcement", async () => {
    const result = await makeJiraTenantBoundaryBreachScenario().run();
    expect(result.passed).toBe(true);
    expect(result.detail).toContain(PASS_DETAIL_ANCHOR);
  });

  it("S3 (reverse probe): an executor that ADMITS the forged-tenant plan makes the scenario report passed: false", async () => {
    const result = await makeJiraTenantBoundaryBreachScenario({ executor: alwaysAdmit }).run();
    expect(result.passed).toBe(false);
    expect(result.detail).toContain("was NOT refused");
    expect(result.detail).not.toContain(PASS_DETAIL_ANCHOR);
  });

  it("S4 (reverse probe): an executor that refuses EVERYTHING also makes the scenario report passed: false — a refuse-all enforcement is not a tenant boundary", async () => {
    const result = await makeJiraTenantBoundaryBreachScenario({ executor: alwaysRefuse }).run();
    expect(result.passed).toBe(false);
    expect(result.detail).toContain("positive control broken");
    expect(result.detail).not.toContain(PASS_DETAIL_ANCHOR);
  });

  it("S5: the verdict is a function of the DECLARED tenant — declaring an IN-allowlist tenant on the breach arm makes the scenario report passed: false", async () => {
    const result = await makeJiraTenantBoundaryBreachScenario({
      declaredTenant: JIRA_TENANT_BOUNDARY_IN_ALLOWLIST_TENANT,
    }).run();
    expect(result.passed).toBe(false);
    expect(result.detail).toContain("was NOT refused");
  });

  it("S5b: a plan declaring a DIFFERENT out-of-allowlist tenant is refused too — the check is membership, not a single hardcoded string", async () => {
    const result = await makeJiraTenantBoundaryBreachScenario({
      declaredTenant: "tenant-some-other-org",
    }).run();
    expect(result.passed).toBe(true);
  });

  it("S6: the pass detail states the SCOPE and does not claim that cross-tenant access is refused", async () => {
    const result = await makeJiraTenantBoundaryBreachScenario().run();
    expect(result.detail).toContain("reads are not tenant-checked");
    expect(result.detail).toContain("actual tenant identity is not verified");
    // The wording pinned at
    // `packages/contracts/src/contracts/external-connection.ts:122` — this
    // field "is not a guarantee that cross-tenant access is refused", so no
    // detail string this fixture emits may say it is.
    expect(result.detail).not.toMatch(/cross-tenant access is refused/);
  });

  it("S7: no FAIL detail contains the pass detail's anchor phrase — an assertion on the detail cannot match both worlds", async () => {
    const admitted = await makeJiraTenantBoundaryBreachScenario({ executor: alwaysAdmit }).run();
    const refusedAll = await makeJiraTenantBoundaryBreachScenario({ executor: alwaysRefuse }).run();
    for (const result of [admitted, refusedAll]) {
      expect(result.passed).toBe(false);
      expect(result.detail).not.toContain(PASS_DETAIL_ANCHOR);
      expect(result.detail).not.toMatch(/cross-tenant access is refused/);
    }
  });

  it("S8: an EMPTY allowlist refuses the control plan too, through the REAL executor, so the scenario reports passed: false — fail-closed is not a passing tenant boundary", async () => {
    // Stronger than S4's stub: this drives the real `executeMutationPlan` into
    // its refuse branch for BOTH arms (`[]` = "nothing is permitted", per
    // `external-connection.ts:98-102`), so it rules out a refuse-everything
    // enforcement without injecting anything.
    const result = await makeJiraTenantBoundaryBreachScenario({ tenantAllowlist: [] }).run();
    expect(result.passed).toBe(false);
    expect(result.detail).toContain("positive control broken");
  });
});

/**
 * The recorder's own body. `createRecordingJournal` is what turns "refused
 * before any journal write" from prose into a counted `=== 0`, so the counter
 * itself needs to be shown to count — an always-empty `appends` array would
 * make the breach arm's `journalAppends === 0` conjunct pass for free.
 */
describe("the fixture's recording journal", () => {
  const REMOTE_OP_INPUT = {
    type: "remote_operation_record",
    payload: {
      schemaVersion: 1,
      id: "00000000-0000-4000-8000-0000000018b0",
      remoteMutationPlanId: "00000000-0000-4000-8000-0000000018b1",
      operationId: "op-1",
      contentHash: "sha256:deadbeef",
      status: "pending",
      recordedAt: new Date(0).toISOString(),
    },
  } as Parameters<ReturnType<typeof createRecordingJournal>["journal"]["appendEntry"]>[0];

  it("S9: records every append and replays it, so a zero count is a measurement rather than a constant", async () => {
    const { journal, appends } = createRecordingJournal();
    expect(appends).toHaveLength(0);
    const entry = await journal.appendEntry(REMOTE_OP_INPUT);
    expect(appends).toHaveLength(1);
    expect(entry.seq).toBe(1);
    expect(entry.type).toBe("remote_operation_record");

    const replayed = [];
    for await (const e of journal.queryEntries({ type: "remote_operation_record" }))
      replayed.push(e);
    expect(replayed).toHaveLength(1);

    const filteredOut = [];
    for await (const e of journal.queryEntries({ type: "run_transition" })) filteredOut.push(e);
    expect(filteredOut).toHaveLength(0);

    const unfiltered = [];
    for await (const e of journal.queryEntries()) unfiltered.push(e);
    expect(unfiltered).toHaveLength(1);
  });

  it("S10: every member the mutation pipeline does NOT call throws rather than silently answering", () => {
    const { journal } = createRecordingJournal();
    // Synchronous throws, not rejected promises: a silent `undefined` from any
    // of these would let a pipeline change start depending on the recorder
    // without anything noticing.
    expect(() => journal.verifyJournal()).toThrow(/not reachable/);
    expect(() => journal.repairJournal()).toThrow(/not reachable/);
    expect(() => journal.gc()).toThrow(/not reachable/);
    expect(() => journal.config.fs.readdir("/nowhere")).toThrow(/not reachable/);
    expect(journal.config.clock()).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});
