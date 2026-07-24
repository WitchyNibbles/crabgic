/**
 * roadmap/23-release-hardening.md work item 6: "crash-before/after-remote-
 * commit." Drives the REAL `@eo/journal` `runKillHarness` (04's kill
 * harness, reused directly — 07/05/13/23 all reuse it per its own doc
 * comment) against two fixtures in `./fixtures/`, each of which itself
 * drives the REAL `executeMutationPlan` (+ `reconcileAmbiguousPost` for the
 * non-idempotent one) — never a reimplementation of the pipeline itself.
 *
 * Two fixture shapes, mirroring `@eo/gateway`'s own kill-harness-fixtures
 * precedent exactly (see each fixture's own doc comment for why):
 *  - `deterministic-update-and-crash.mjs` (PUT-style, check-before-apply):
 *    exercises BOTH "before-network-call" and "after-network-call" —
 *    always safely convergeable via retry/redo.
 *  - `nonidempotent-create-and-crash.mjs` (POST-style, no natural no-op
 *    check): exercises "after-network-call" only, via real
 *    marker-reconciliation — a "before-network-call" crash for a
 *    genuinely non-idempotent create has no natural convergence path other
 *    than staying `blocked` (this pipeline's own deliberate fail-closed
 *    design: it cannot distinguish "never sent" from "sent, response
 *    lost"), which is why gateway's own equivalent test file never
 *    exercises that combination either.
 */
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runKillHarness } from "@eo/journal";
import {
  CONNECTOR_MATRIX_GATE_TAG,
  createScenarioJournal,
  emitScenarioEvidence,
} from "../support/evidence.js";
import type { ScenarioJournal } from "../support/evidence.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const DETERMINISTIC_FIXTURE = join(HERE, "fixtures", "deterministic-update-and-crash.mjs");
const NONIDEMPOTENT_FIXTURE = join(HERE, "fixtures", "nonidempotent-create-and-crash.mjs");

let journalDir: string;
let sideEffectFile: string;
let tj: ScenarioJournal;

beforeEach(async () => {
  journalDir = await mkdtemp(join(tmpdir(), "eo-connector-matrix-crash-"));
  sideEffectFile = join(journalDir, "side-effects.log");
  await writeFile(sideEffectFile, "");
  tj = await createScenarioJournal();
});

afterEach(async () => {
  await rm(journalDir, { recursive: true, force: true });
  await tj.cleanup();
});

function fixtureSpec(
  fixture: string,
  faultPoint: string,
  planJson: string,
  extraEnv: Readonly<Record<string, string>> = {},
) {
  return {
    command: process.execPath,
    args: [fixture],
    env: {
      EO_FIXTURE_JOURNAL_DIR: journalDir,
      EO_FIXTURE_SIDE_EFFECT_FILE: sideEffectFile,
      EO_FIXTURE_FAULT_POINT: faultPoint,
      EO_FIXTURE_PLAN_JSON: planJson,
      ...extraEnv,
    },
  };
}

const DETERMINISTIC_PLAN_JSON = JSON.stringify({
  schemaVersion: 1,
  id: "dddddddd-1111-4111-8111-111111111111",
  externalConnectionId: "dddddddd-2222-4222-8222-222222222222",
  tenant: "tenant-connector-matrix",
  canonicalTarget: "issue:CM-4",
  action: "issue.transition",
  redactedDiff: "status: To Do -> In Progress",
  desiredStateHash: "sha256:connector-matrix-deterministic-fixture-1",
  idempotencyKey: "connector-matrix:crash-recovery:deterministic-op-1",
  impactClass: "reversible",
  rollbackClass: "version-checked-restore",
  envelopeId: "dddddddd-3333-4333-8333-333333333333",
});

const NONIDEMPOTENT_PLAN_JSON = JSON.stringify({
  schemaVersion: 1,
  id: "cccccccc-1111-4111-8111-111111111111",
  externalConnectionId: "cccccccc-2222-4222-8222-222222222222",
  tenant: "tenant-connector-matrix",
  canonicalTarget: "issue:CM-3:comment",
  action: "comment.create",
  redactedDiff: "comment: (new) -> [crash-recovery fixture]",
  desiredStateHash: "sha256:connector-matrix-crash-fixture-1",
  idempotencyKey: "connector-matrix:crash-recovery:op-1",
  impactClass: "reversible",
  rollbackClass: "none",
  envelopeId: "cccccccc-3333-4333-8333-333333333333",
});

async function countSideEffectLines(marker: string): Promise<number> {
  const content = await readFile(sideEffectFile, "utf8");
  return content.split("\n").filter((line) => line === marker).length;
}

async function runRecoveryPass(
  fixture: string,
  planJson: string,
  extraEnv: Readonly<Record<string, string>> = {},
): Promise<void> {
  const spec = fixtureSpec(fixture, "none", planJson, extraEnv);
  await new Promise<void>((resolve, reject) => {
    const child = spawn(spec.command, spec.args, {
      env: { ...process.env, ...spec.env },
      stdio: "ignore",
    });
    child.on("exit", (code) =>
      code === 0 ? resolve() : reject(new Error(`recovery pass exited ${code}`)),
    );
    child.on("error", reject);
  });
}

describe("crash-before-remote-commit — deterministic update, kill before the network call", () => {
  it("recovery converges to exactly one real PUT-equivalent side effect (safe retry)", async () => {
    const report = await runKillHarness(
      fixtureSpec(DETERMINISTIC_FIXTURE, "before-network-call", DETERMINISTIC_PLAN_JSON),
      ["before-network-call"],
      {
        verify: async () => {
          await runRecoveryPass(DETERMINISTIC_FIXTURE, DETERMINISTIC_PLAN_JSON);
          const count = await countSideEffectLines("put");
          return { recovered: count === 1, detail: `putCount=${count}` };
        },
      },
    );
    expect(report.allConverged).toBe(true);

    await emitScenarioEvidence({
      journal: tj.store,
      command:
        "connector-matrix: crash-before-remote-commit (deterministic) — kill harness converges to exactly one apply",
      exitStatus: 0,
      outcomeContent: JSON.stringify(report),
    });
  });
});

describe("crash-after-remote-commit — deterministic update, kill after the network call", () => {
  it("recovery converges to exactly one real PUT-equivalent side effect", async () => {
    const report = await runKillHarness(
      fixtureSpec(DETERMINISTIC_FIXTURE, "after-network-call", DETERMINISTIC_PLAN_JSON),
      ["after-network-call"],
      {
        verify: async () => {
          await runRecoveryPass(DETERMINISTIC_FIXTURE, DETERMINISTIC_PLAN_JSON);
          const count = await countSideEffectLines("put");
          return { recovered: count === 1, detail: `putCount=${count}` };
        },
      },
    );
    expect(report.allConverged).toBe(true);
  });
});

describe("crash-after-remote-commit — non-idempotent create, kill after the network call (MEDIUM/HIGH #3's own required case)", () => {
  it("NEVER produces a double-create — the real reconcileAmbiguousPost marker search finds the already-landed create", async () => {
    const report = await runKillHarness(
      fixtureSpec(NONIDEMPOTENT_FIXTURE, "after-network-call", NONIDEMPOTENT_PLAN_JSON),
      ["after-network-call"],
      {
        verify: async () => {
          await runRecoveryPass(NONIDEMPOTENT_FIXTURE, NONIDEMPOTENT_PLAN_JSON);
          const count = await countSideEffectLines("post");
          return { recovered: count === 1, detail: `postCount=${count}` };
        },
      },
    );
    expect(report.allConverged).toBe(true);
  });

  it("with reconciliation disabled, blocks (never guesses) and STILL never double-creates", async () => {
    const noReconcile = { EO_FIXTURE_NO_RECONCILE: "1" };
    const report = await runKillHarness(
      fixtureSpec(
        NONIDEMPOTENT_FIXTURE,
        "after-network-call",
        NONIDEMPOTENT_PLAN_JSON,
        noReconcile,
      ),
      ["after-network-call"],
      {
        verify: async () => {
          await runRecoveryPass(NONIDEMPOTENT_FIXTURE, NONIDEMPOTENT_PLAN_JSON, noReconcile);
          const count = await countSideEffectLines("post");
          return { recovered: count === 1, detail: `postCount=${count}` };
        },
      },
    );
    expect(report.allConverged).toBe(true);

    const record = await emitScenarioEvidence({
      journal: tj.store,
      command:
        "connector-matrix: crash-after-remote-commit (non-idempotent) — no reconciliation hook fails closed, never double-creates",
      exitStatus: 0,
      outcomeContent: JSON.stringify(report),
    });
    expect(record.gateTag).toBe(CONNECTOR_MATRIX_GATE_TAG);
  });
});
