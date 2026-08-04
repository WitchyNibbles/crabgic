/**
 * `SupervisorDependencies`' durable registries are required BY CONSTRUCTION.
 *
 * WHY THIS FILE EXISTS. roadmap/24 exit criterion 8 made the criteria
 * verifier a REQUIRED parameter at `@crabgic/scheduler`'s public entry
 * points — and the omission promptly reappeared one layer up. The dependency
 * bundle that FEEDS those entry points declared
 * `readonly requirements?: Registry<Requirement>`, `composeSupervisor` never
 * built one, and `packages/cli/src/daemon/run-dispatcher.ts` therefore
 * resolved an EMPTY requirement set for every work unit in the shipped
 * daemon. Requiredness at a call site does not survive an optional field on
 * the bundle that supplies it. See the defect record
 * `24-daemon-requirements-registry-unwired.md`, and the phase file's own
 * twice-stated warning about this shape: "one path threaded it, the daemon
 * path did not".
 *
 * WHAT IT PROVES, AND HOW IT IS FALSIFIED. Each `@ts-expect-error` below is
 * a compile-time claim, and a compile-time claim asserted without being
 * measured is worth nothing (the brief records a prior "type-level proof"
 * whose restoration compiled clean). Restoring `?` on either field and
 * running `tsc -b --force` must report `TS2578: Unused '@ts-expect-error'
 * directive.` at the corresponding fixture — measured, reverted, and
 * committed at `docs/evidence/phase-24/fix-unwired-falsification.txt`.
 *
 * NOT covered here: whether the composition root actually builds a registry
 * over the SAME file intake writes. A type cannot see that. Its bearer is
 * `packages/cli/src/daemon/composed-daemon-seal-enforcement.test.ts`.
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createJournalStore } from "@crabgic/journal";
import { createArtifactIndexRegistry } from "../registries/artifact-index-registry.js";
import { createAuthorizationEnvelopesRegistry } from "../registries/authorization-envelopes-registry.js";
import { createChangeSetsRegistry } from "../registries/change-sets-registry.js";
import { createRequirementsRegistry } from "../registries/requirements-registry.js";
import { createRunsRegistry } from "../registries/runs-registry.js";
import { createWorkersRegistry } from "../registries/workers-registry.js";
import { createWorkUnitsRegistry } from "../registries/work-units-registry.js";
import type { SupervisorDependencies, TerminableWorker } from "./build-router.js";

function commonDeps() {
  return {
    journal: createJournalStore({
      journalDir: mkdtempSync(join(tmpdir(), "eo-supervisor-deps-required-")),
    }),
    runs: createRunsRegistry(),
    changeSets: createChangeSetsRegistry(),
    workUnits: createWorkUnitsRegistry(),
    workers: createWorkersRegistry(),
    artifactIndex: createArtifactIndexRegistry(),
    liveWorkers: new Map<string, TerminableWorker>(),
  };
}

describe("SupervisorDependencies' durable registries are required by construction (roadmap/24, defect 24-daemon-requirements-registry-unwired)", () => {
  it("rejects a SupervisorDependencies value that omits requirements", () => {
    const base = commonDeps();

    // @ts-expect-error — `requirements` is a REQUIRED member of
    // `SupervisorDependencies`. If this directive ever reports as unused,
    // a composition root can once again omit the requirements registry and
    // ship a daemon whose completion funnel verifies zero requirements.
    const deps: SupervisorDependencies = {
      ...base,
      envelopes: createAuthorizationEnvelopesRegistry(),
    };

    expect(deps).toBeDefined();
  });

  it("still accepts the bundle once requirements IS supplied — the fixture above fails for the omission, not for an unrelated type error", () => {
    const base = commonDeps();

    const deps: SupervisorDependencies = {
      ...base,
      envelopes: createAuthorizationEnvelopesRegistry(),
      requirements: createRequirementsRegistry(),
    };

    expect(deps.requirements).toBeDefined();
    expect(deps.envelopes).toBeDefined();
  });
});
