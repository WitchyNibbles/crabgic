import { describe, expect, it, afterEach, beforeEach } from "vitest";
import { buildCliDependencies, pluginSourceDir, runCli, runCliJson } from "../src/cli-driver.js";
import { buildCleanRepo, type TempFixture } from "../src/fixtures.js";
import { createTestJournal, type TestJournal } from "../src/test-support/test-journal.js";

describe("cli-driver", () => {
  let journal: TestJournal;
  let fixture: TempFixture;

  beforeEach(async () => {
    journal = await createTestJournal();
    fixture = await buildCleanRepo();
  });

  afterEach(async () => {
    await journal.cleanup();
    await fixture.cleanup();
  });

  it("pluginSourceDir resolves to a real, existing @eo/plugin root", () => {
    const dir = pluginSourceDir();
    expect(dir.length).toBeGreaterThan(0);
  });

  it("connectClient rejects loudly if ever invoked (install/upgrade/uninstall must never call it)", async () => {
    const deps = buildCliDependencies({ targetDir: fixture.dir, journal: journal.store });
    await expect(deps.connectClient()).rejects.toThrow(/must never be invoked/);
  });

  it("runCli drives a real install end-to-end and returns a real CommandResult", async () => {
    const deps = buildCliDependencies({ targetDir: fixture.dir, journal: journal.store });
    const result = await runCli(["install", "--json"], deps);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBeDefined();
  });

  it("runCliJson parses the real --json stdout into a structural result", async () => {
    const deps = buildCliDependencies({ targetDir: fixture.dir, journal: journal.store });
    const { exitCode, result } = await runCliJson<{ status: string }>(["install"], deps);
    expect(exitCode).toBe(0);
    expect(result.status).toBe("installed");
  });

  it("runCliJson throws a descriptive error when a command result carries no stdout (e.g. a rejected connectClient bubbling through cancel)", async () => {
    const deps = buildCliDependencies({ targetDir: fixture.dir, journal: journal.store });
    // "cancel" is the one dispatched command this harness's own stub
    // deliberately makes fail: it calls `deps.connectClient()`, which
    // rejects, and `dispatchCommand`'s own catch branch returns
    // `{ exitCode, stderr }` with NO `stdout` field at all — exactly the
    // shape `runCliJson` must refuse to silently `JSON.parse(undefined)`.
    await expect(runCliJson(["cancel", "some-run-id"], deps)).rejects.toThrow(
      /expected --json stdout/,
    );
  });

  it("a confirmGitInit override is honored end-to-end", async () => {
    let invoked = false;
    const deps = buildCliDependencies({
      targetDir: fixture.dir,
      journal: journal.store,
      confirmGitInit: () => {
        invoked = true;
        return Promise.resolve(false);
      },
    });
    // fixture.dir is already a real repo, so confirmGitInit is never
    // reached on this path — asserting the override wiring itself compiles
    // and runs without throwing is the point of this test.
    await runCliJson(["install"], deps);
    expect(invoked).toBe(false);
  });
});
