/**
 * Repo-format scenarios — roadmap/23-release-hardening.md work item 5:
 * "SHA-256 repos, submodules, LFS." Drives the REAL `validateRepository`
 * (`@eo/git-engine`, spawns real `git`) against real, on-disk fixture
 * repos in each shape — never a hand-built `RepositoryValidationReport`.
 */
import { randomUUID } from "node:crypto";
import type { JournalStore } from "@eo/journal";
import { validateRepository } from "@eo/git-engine";
import { emitScenarioEvidence } from "../evidence.js";
import {
  commitAll,
  freshTmpDir,
  initFixtureRepo,
  plumbing,
  withCleanup,
  writeFixtureFile,
} from "../fixtures.js";
import { exitStatusFor, requirePassed, type ScenarioOutcome } from "../scenario-types.js";

export async function runSha256RepoScenario(journal: JournalStore): Promise<ScenarioOutcome> {
  const dir = await freshTmpDir("sha256");
  const fixture = withCleanup(dir);
  try {
    await initFixtureRepo(dir, { objectFormat: "sha256" });
    await writeFixtureFile(dir, "README.md", "# sha256 fixture\n");
    const headObjectId = await commitAll(dir, "initial commit (sha256 repo)");

    const report = await validateRepository(plumbing, dir);
    const passed = report.objectFormat === "sha256" && /^[0-9a-f]{64}$/.test(headObjectId);
    const detail = `objectFormat=${report.objectFormat}; headObjectId length=${String(headObjectId.length)}`;

    await emitScenarioEvidence(journal, {
      changeSetId: randomUUID(),
      command: "validateRepository (SHA-256 object format)",
      exitStatus: exitStatusFor(passed),
      objectId: headObjectId,
      detail,
    });
    requirePassed(passed, "git-matrix/sha256-repo", detail);
    return { name: "git-matrix/sha256-repo", passed, detail, objectId: headObjectId };
  } finally {
    await fixture.cleanup();
  }
}

export async function runSubmoduleScenario(journal: JournalStore): Promise<ScenarioOutcome> {
  const submoduleSourceDir = await freshTmpDir("submodule-source");
  const submoduleSourceFixture = withCleanup(submoduleSourceDir);
  const parentDir = await freshTmpDir("submodule-parent");
  const parentFixture = withCleanup(parentDir);
  try {
    await initFixtureRepo(submoduleSourceDir);
    await writeFixtureFile(submoduleSourceDir, "lib.txt", "vendored library\n");
    await commitAll(submoduleSourceDir, "vendored library initial commit");

    await initFixtureRepo(parentDir);
    await writeFixtureFile(parentDir, "README.md", "# parent fixture\n");
    await commitAll(parentDir, "parent initial commit");
    // `protocol.file.allow=always` is required for a LOCAL-path submodule
    // add against real git >=2.38's default-deny file-transport policy —
    // this fixture setup step only, never applied to the validation call
    // itself.
    await plumbing.run(
      ["-c", "protocol.file.allow=always", "submodule", "add", submoduleSourceDir, "vendor/lib"],
      { cwd: parentDir },
    );
    const headObjectId = await commitAll(parentDir, "add vendor/lib submodule");

    const report = await validateRepository(plumbing, parentDir);
    const passed = report.hasSubmodules === true;
    const detail = `hasSubmodules=${String(report.hasSubmodules)}`;

    await emitScenarioEvidence(journal, {
      changeSetId: randomUUID(),
      command: "validateRepository (submodule)",
      exitStatus: exitStatusFor(passed),
      objectId: headObjectId,
      detail,
    });
    requirePassed(passed, "git-matrix/submodule", detail);
    return { name: "git-matrix/submodule", passed, detail, objectId: headObjectId };
  } finally {
    await parentFixture.cleanup();
    await submoduleSourceFixture.cleanup();
  }
}

const LFS_POINTER_CONTENT = [
  "version https://git-lfs.github.com/spec/v1",
  "oid sha256:0000000000000000000000000000000000000000000000000000000000000000",
  "size 4",
  "",
].join("\n");

export async function runLfsPointerScenario(journal: JournalStore): Promise<ScenarioOutcome> {
  const dir = await freshTmpDir("lfs");
  const fixture = withCleanup(dir);
  try {
    await initFixtureRepo(dir);
    await writeFixtureFile(dir, "assets/large-binary.bin", LFS_POINTER_CONTENT);
    const headObjectId = await commitAll(dir, "add LFS-pointer-shaped tracked file");

    const report = await validateRepository(plumbing, dir);
    const passed =
      report.lfsPointerPaths.length === 1 &&
      report.lfsPointerPaths[0] === "assets/large-binary.bin";
    const detail = `lfsPointerPaths=${JSON.stringify(report.lfsPointerPaths)}`;

    await emitScenarioEvidence(journal, {
      changeSetId: randomUUID(),
      command: "validateRepository (LFS pointer, no smudge)",
      exitStatus: exitStatusFor(passed),
      objectId: headObjectId,
      detail,
    });
    requirePassed(passed, "git-matrix/lfs-pointer", detail);
    return { name: "git-matrix/lfs-pointer", passed, detail, objectId: headObjectId };
  } finally {
    await fixture.cleanup();
  }
}
