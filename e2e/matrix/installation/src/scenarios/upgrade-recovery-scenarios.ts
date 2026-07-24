/**
 * Interrupted-upgrade / rollback scenarios — roadmap/10-plugin-and-
 * installer.md work item 5's own failing-first framing: "a process kill
 * mid-write leaves torn state under the stub (no recovery)." Both
 * scenarios seed the real, documented on-disk "torn upgrade" shape (see
 * `../upgrade-marker-fixture.ts`'s file-level doc comment for why a seeded
 * fixture, not a live kill, is used — the SAME technique
 * `packages/cli/src/installer/upgrade.test.ts` itself uses for this exact
 * code path) and then exercise the REAL recovery logic via a real
 * `dispatchCommand(["upgrade", ...])` call — 100% production code from
 * that point on.
 *
 * "Interrupted upgrade" asserts recovery FIRES (`recoveredFromInterruptedUpgrade:
 * true`) and cleans up its own torn state (marker + backup files gone
 * afterward); "rollback" asserts the recovered CONTENT is byte-exact
 * against the pre-crash snapshot — the two complementary angles
 * `upgrade.ts`'s own doc comment describes as "one mechanism serves both
 * roles."
 */
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { JournalStore } from "@eo/journal";
import { buildCliDependencies, runCliJson } from "../cli-driver.js";
import { emitScenarioEvidence } from "../evidence.js";
import { buildCleanRepo, type TempFixture } from "../fixtures.js";
import { requirePassed, requireStatus } from "../scenario-support.js";
import type { InstallJsonResult, ScenarioOutcome, UpgradeJsonResult } from "../scenario-types.js";
import {
  backupDir as seededBackupDir,
  seedInterruptedUpgrade,
  upgradeMarkerPath,
} from "../upgrade-marker-fixture.js";
import { resolveHeadObjectId } from "./object-id.js";

interface PreparedTornInstall {
  readonly fixture: TempFixture;
  readonly claudeMdPath: string;
  readonly preCrashContent: string;
  readonly currentOnDiskContent: string;
}

/**
 * Installs for real, then seeds a torn-upgrade marker referencing a
 * DIFFERENT ("pre-crash") snapshot of `CLAUDE.md` than what is currently on
 * disk — modeling "an upgrade was in the middle of rewriting this file
 * when the process was killed" (the file on disk right now is the
 * mid-write/already-installed content; the backup is what existed
 * immediately before that interrupted write started).
 */
async function prepareTornInstall(journal: JournalStore): Promise<PreparedTornInstall> {
  const fixture = await buildCleanRepo();
  const deps = buildCliDependencies({ targetDir: fixture.dir, journal });
  const { result } = await runCliJson<InstallJsonResult>(["install"], deps);
  requireStatus(result.status, "installed", "upgrade-recovery");

  const claudeMdPath = join(fixture.dir, "CLAUDE.md");
  const currentOnDiskContent = await readFile(claudeMdPath, "utf8");
  const preCrashContent = `<!-- pre-crash snapshot, seeded by the harness -->\n${currentOnDiskContent}`;

  await seedInterruptedUpgrade(fixture.dir, [
    { relPath: "CLAUDE.md", kind: "merged", preUpgradeContent: preCrashContent },
  ]);

  return { fixture, claudeMdPath, preCrashContent, currentOnDiskContent };
}

export async function runInterruptedUpgradeScenario(
  journal: JournalStore,
): Promise<ScenarioOutcome> {
  const prepared = await prepareTornInstall(journal);
  try {
    const deps = buildCliDependencies({ targetDir: prepared.fixture.dir, journal });
    const { result } = await runCliJson<UpgradeJsonResult>(["upgrade"], deps);

    const markerGone = !existsSync(upgradeMarkerPath(prepared.fixture.dir));
    const backupDir = seededBackupDir(prepared.fixture.dir);
    const remainingBackups = existsSync(backupDir) ? await readdir(backupDir) : [];

    const passed =
      result.recoveredFromInterruptedUpgrade === true &&
      markerGone &&
      remainingBackups.length === 0;
    const objectId = await resolveHeadObjectId(prepared.fixture.dir);
    const detail = `recoveredFromInterruptedUpgrade=${String(result.recoveredFromInterruptedUpgrade)} markerGone=${String(markerGone)} remainingBackups=${String(remainingBackups.length)}`;

    await emitScenarioEvidence(journal, {
      changeSetId: randomUUID(),
      command: "upgrade --json (interrupted-upgrade recovery)",
      exitStatus: passed ? 0 : 1,
      objectId,
      detail,
    });
    requirePassed(passed, "installation-matrix/interrupted-upgrade", detail);
    return { name: "installation-matrix/interrupted-upgrade", passed, detail, objectId };
  } finally {
    await prepared.fixture.cleanup();
  }
}

export async function runRollbackScenario(journal: JournalStore): Promise<ScenarioOutcome> {
  const prepared = await prepareTornInstall(journal);
  try {
    const deps = buildCliDependencies({ targetDir: prepared.fixture.dir, journal });
    await runCliJson<UpgradeJsonResult>(["upgrade"], deps);

    const restoredContent = await readFile(prepared.claudeMdPath, "utf8");
    const byteExact = restoredContent === prepared.preCrashContent;

    const objectId = await resolveHeadObjectId(prepared.fixture.dir);
    const detail = byteExact
      ? "CLAUDE.md restored byte-exact to the pre-crash snapshot"
      : `CLAUDE.md content mismatch after rollback: expected pre-crash snapshot (${String(prepared.preCrashContent.length)} bytes), got ${String(restoredContent.length)} bytes`;

    await emitScenarioEvidence(journal, {
      changeSetId: randomUUID(),
      command: "upgrade --json (rollback content-fidelity)",
      exitStatus: byteExact ? 0 : 1,
      objectId,
      detail,
    });
    requirePassed(byteExact, "installation-matrix/rollback", detail);
    return { name: "installation-matrix/rollback", passed: byteExact, detail, objectId };
  } finally {
    await prepared.fixture.cleanup();
  }
}
