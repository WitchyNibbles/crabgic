import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { runCommandWithResourceCapture } from "./command-runner.js";
import { ResourceCaptureArtifactSchema } from "./schema.js";

/**
 * Security negative test — roadmap/15 §Critical correctness points,
 * "Secret-leakage": "resource-capture artifacts contain NO process
 * environment/argv content (a real leakage vector into evidence)."
 */
describe("ResourceCaptureArtifact: no environment/argv content", () => {
  it("the schema rejects an artifact carrying an extra env-shaped field (.strict())", () => {
    const withEnv = {
      command: "echo hi",
      wallTimeMs: 1,
      cpuUserMs: 0,
      cpuSystemMs: 0,
      peakRssKb: 1,
      exitCode: 0,
      env: { SECRET_TOKEN: "sk-should-never-appear" },
    };
    expect(ResourceCaptureArtifactSchema.safeParse(withEnv).success).toBe(false);
  });

  it("the schema rejects an artifact carrying an extra argv-shaped field (.strict())", () => {
    const withArgv = {
      command: "echo hi",
      wallTimeMs: 1,
      cpuUserMs: 0,
      cpuSystemMs: 0,
      peakRssKb: 1,
      exitCode: 0,
      argv: ["node", "--secret-flag=sk-should-never-appear"],
    };
    expect(ResourceCaptureArtifactSchema.safeParse(withArgv).success).toBe(false);
  });

  it("a real command run with a secret injected into its environment never leaks that secret into the returned artifact", async () => {
    const secret = "sk-test-super-secret-value-should-never-leak-into-evidence";
    const artifact = await runCommandWithResourceCapture({
      command: 'node -e "process.exit(0)"',
      cwd: tmpdir(),
      env: { ...process.env, EO_PERF_TEST_SECRET: secret },
    });
    const serialized = JSON.stringify(artifact);
    expect(serialized).not.toContain(secret);
    expect(serialized).not.toContain("EO_PERF_TEST_SECRET");
  }, 15000);

  it("the current real process.env (whatever it happens to contain in CI) never appears in a captured artifact's serialized form", async () => {
    const artifact = await runCommandWithResourceCapture({
      command: 'node -e "process.exit(0)"',
      cwd: tmpdir(),
    });
    const serialized = JSON.stringify(artifact);
    for (const [key, value] of Object.entries(process.env)) {
      if (value === undefined || value.length < 6) continue; // skip trivially-short values that could coincidentally substring-match
      expect(serialized.includes(value)).toBe(false);
      expect(serialized.includes(key)).toBe(false);
    }
  }, 15000);
});
