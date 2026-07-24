import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * The no-exec-jail conformance exit criterion, verbatim: "No-execution
 * proof: detectors run under a no-exec jail test that fails if any child
 * process spawns." roadmap/12 §Test plan, "Conformance" bullet: "the
 * detector suite fails if any child process spawns while analyzing a
 * fixture repo containing an executable `postinstall` script."
 *
 * `node:child_process` is replaced (via `vi.mock`, hoisted) with a
 * call-recording wrapper around every real subprocess-launching export
 * (`spawn`, `spawnSync`, `exec`, `execSync`, `execFile`, `execFileSync`,
 * `fork`) — ESM's module namespace is not `spyOn`-configurable directly
 * (`vi.spyOn` on a namespace object throws "Module namespace is not
 * configurable"), so a full-module mock is the correct mechanism here, not
 * a workaround. The wrapped functions still delegate to the real
 * implementation (so anything ELSE in the test run that legitimately
 * spawns is unaffected) — this test only records whether they were EVER
 * called during one detection pass over a fixture whose `package.json`
 * declares (and whose disk tree contains, executable-bit set) a malicious
 * `postinstall` script that itself shells out to `curl ... | sh`.
 */
const recordedCalls = vi.hoisted(() => ({ names: [] as string[] }));

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  function wrap<T extends (...args: never[]) => unknown>(name: string, fn: T): T {
    return ((...args: Parameters<T>) => {
      recordedCalls.names.push(name);
      return fn(...args);
    }) as T;
  }
  return {
    ...actual,
    spawn: wrap("spawn", actual.spawn),
    spawnSync: wrap("spawnSync", actual.spawnSync),
    exec: wrap("exec", actual.exec),
    execSync: wrap("execSync", actual.execSync),
    execFile: wrap("execFile", actual.execFile),
    execFileSync: wrap("execFileSync", actual.execFileSync),
    fork: wrap("fork", actual.fork),
  };
});

describe("no-exec jail — detectors never spawn a child process", () => {
  afterEach(() => {
    recordedCalls.names.length = 0;
  });

  it("zero child_process calls while running the full detection pass over a fixture with an executable postinstall script", async () => {
    const { removeDirTree } = await import("./test-support/fixture-repo.js");
    const { buildMaliciousPostinstallFixture } = await import("./test-support/stack-fixtures.js");
    const { buildStackEvidence } = await import("./evidence-builder.js");

    const root = buildMaliciousPostinstallFixture();
    try {
      const evidence = buildStackEvidence(root);
      expect(recordedCalls.names).toEqual([]);
      // Sanity: detection still ran and actually saw the fixture (a
      // vacuously-empty pass would make the "zero calls" assertion above
      // meaningless).
      expect(evidence.findings.some((f) => f.category === "manifest")).toBe(true);
    } finally {
      removeDirTree(root);
    }
  });
});
