/**
 * Config-drift scenario — roadmap/10-plugin-and-installer.md's own
 * "checksum/drift check" doctor contribution, exercised through the REAL
 * `doctor` pipeline (`buildDefaultDoctorChecks` + `runDoctorChecks`, both
 * part of `engineering-orchestrator`'s public barrel via
 * `packages/cli/src/doctor/run-doctor.ts`/`framework.ts`) rather than a
 * re-implementation of drift detection: install for real, externally
 * mutate an owned "merged" artifact (simulating an out-of-band edit —
 * exactly what a user hand-editing `CLAUDE.md` after install produces),
 * then assert the REAL `installer.checksum-drift` finding flips to
 * `passed: false` and names the mutated file.
 */
import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { JournalStore } from "@eo/journal";
import { buildDefaultDoctorChecks, runDoctorChecks } from "engineering-orchestrator";
import { buildCliDependencies, pluginSourceDir, runCliJson } from "../cli-driver.js";
import { emitScenarioEvidence } from "../evidence.js";
import { buildCleanRepo } from "../fixtures.js";
import { requirePassed, requireStatus } from "../scenario-support.js";
import type { InstallJsonResult, ScenarioOutcome } from "../scenario-types.js";
import { resolveHeadObjectId } from "./object-id.js";

export async function runConfigDriftScenario(journal: JournalStore): Promise<ScenarioOutcome> {
  const fixture = await buildCleanRepo();
  try {
    const deps = buildCliDependencies({ targetDir: fixture.dir, journal });
    const { result: installResult } = await runCliJson<InstallJsonResult>(["install"], deps);
    requireStatus(installResult.status, "installed", "config-drift");

    const claudeMdPath = join(fixture.dir, "CLAUDE.md");
    const installedContent = await readFile(claudeMdPath, "utf8");
    const driftedContent = `${installedContent}\n<!-- out-of-band edit, never made through the installer -->\n`;
    await writeFile(claudeMdPath, driftedContent, "utf8");

    const checks = buildDefaultDoctorChecks({
      projectHash: deps.projectHash,
      journal,
      installer: { targetDir: fixture.dir, pluginSourceDir: pluginSourceDir() },
    });
    const report = await runDoctorChecks(checks);
    const driftFinding = report.findings.find((f) => f.id === "installer.checksum-drift");

    const passed =
      driftFinding !== undefined &&
      driftFinding.passed === false &&
      driftFinding.evidence.includes("CLAUDE.md");

    const objectId = await resolveHeadObjectId(fixture.dir);
    const detail = `installer.checksum-drift finding: ${driftFinding === undefined ? "MISSING" : JSON.stringify(driftFinding)}`;

    await emitScenarioEvidence(journal, {
      changeSetId: randomUUID(),
      command: "doctor --json (config-drift)",
      exitStatus: passed ? 0 : 1,
      objectId,
      detail,
    });
    requirePassed(passed, "installation-matrix/config-drift", detail);
    return { name: "installation-matrix/config-drift", passed, detail, objectId };
  } finally {
    await fixture.cleanup();
  }
}
