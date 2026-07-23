import { describe, expect, it } from "vitest";
import {
  createHermeticitySelftestCheck,
  createRealHermeticitySelftestProbe,
} from "./hermeticity-selftest.js";

describe("createHermeticitySelftestCheck", () => {
  it("passes when the probe executed and the marker did not leak", async () => {
    const check = createHermeticitySelftestCheck({
      probe: async () => ({ executed: true, rogueMarkerLeaked: false, detail: "no effect" }),
    });
    const finding = await check.run();
    expect(finding.passed).toBe(true);
  });

  it("fails when the probe never executed (no sound absence evidence)", async () => {
    const check = createHermeticitySelftestCheck({
      probe: async () => ({
        executed: false,
        rogueMarkerLeaked: false,
        detail: "claude not found",
      }),
    });
    const finding = await check.run();
    expect(finding.passed).toBe(false);
    expect(finding.evidence).toContain("did not execute");
  });

  it("fails when the marker leaked", async () => {
    const check = createHermeticitySelftestCheck({
      probe: async () => ({ executed: true, rogueMarkerLeaked: true, detail: "leaked" }),
    });
    const finding = await check.run();
    expect(finding.passed).toBe(false);
  });
});

describe("createRealHermeticitySelftestProbe", () => {
  it("plants a rogue CLAUDE.md, spawns via the injected probe, and reports no leak on a clean stdout", async () => {
    const probe = createRealHermeticitySelftestProbe(async () => ({
      stdout: '{"result":"DONE"}',
      stderr: "",
      exitCode: 0,
    }));
    const result = await probe();
    expect(result.executed).toBe(true);
    expect(result.rogueMarkerLeaked).toBe(false);
  });

  it("reports a leak when the spawned probe's stdout contains the planted marker", async () => {
    const probe = createRealHermeticitySelftestProbe(async () => ({
      stdout: '{"result":"DONE PINEAPPLE-CI-77"}',
      stderr: "",
      exitCode: 0,
    }));
    const result = await probe();
    expect(result.executed).toBe(true);
    expect(result.rogueMarkerLeaked).toBe(true);
  });

  it("reports not-executed when the spawned probe itself fails", async () => {
    const probe = createRealHermeticitySelftestProbe(async () => ({
      stdout: "",
      stderr: "claude: command not found",
      exitCode: 127,
    }));
    const result = await probe();
    expect(result.executed).toBe(false);
  });

  it("adversarial-review regression guard: the planted CLAUDE.md is actually in scope — cwd is the scratch dir, env is isolated/allowlisted with CLAUDE_CONFIG_DIR set, PATH present, and the real ambient env NOT merged in", async () => {
    let capturedCwd: string | undefined;
    let capturedEnv: Readonly<Record<string, string>> | undefined;

    const probe = createRealHermeticitySelftestProbe(async (_command, _args, options) => {
      capturedCwd = options?.cwd;
      capturedEnv = options?.env;
      return { stdout: '{"result":"DONE"}', stderr: "", exitCode: 0 };
    });
    await probe();

    // cwd must be supplied at all (the pre-fix code never passed it, so the
    // planted CLAUDE.md was orphaned outside the process's real cwd).
    expect(capturedCwd).toBeDefined();
    // env must be supplied and must carry an isolated CLAUDE_CONFIG_DIR
    // nested under that same cwd (never the real ~/.claude).
    expect(capturedEnv).toBeDefined();
    const configDir = capturedEnv!.CLAUDE_CONFIG_DIR;
    expect(configDir).toBeDefined();
    expect(configDir!.startsWith(capturedCwd!)).toBe(true);
    // PATH must be present so `claude` itself can be resolved.
    expect(capturedEnv!.PATH).toBeTruthy();
    // The real ambient env must NOT be merged in — a value present in this
    // test process's own real env (e.g. a marker only vitest's own runner
    // env would have) must not silently appear via a merge. We assert this
    // structurally: the env object has exactly the 3 keys this probe
    // builds, never more.
    expect(Object.keys(capturedEnv!).sort()).toEqual(["CLAUDE_CONFIG_DIR", "HOME", "PATH"]);
  });
});
