import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { runCommandWithResourceCapture } from "./command-runner.js";

const BUSY_SCRIPT =
  "const s=Date.now();let a=0;while(Date.now()-s<150){a+=Math.sqrt(a+1);}const b=Buffer.alloc(5*1024*1024);b.fill(1);";

describe("runCommandWithResourceCapture", () => {
  it("measures a synthetic workload with known resource consumption (a ~150ms CPU busy-loop + a 5MB allocation)", async () => {
    const artifact = await runCommandWithResourceCapture({
      command: `node -e "${BUSY_SCRIPT}"`,
      cwd: tmpdir(),
      sampleIntervalMs: 10,
    });
    expect(artifact.exitCode).toBe(0);
    expect(artifact.wallTimeMs).toBeGreaterThanOrEqual(140);
    expect(artifact.cpuUserMs + artifact.cpuSystemMs).toBeGreaterThan(0);
    expect(artifact.peakRssKb).toBeGreaterThan(0);
  }, 15000);

  it("reports the child's real exit code", async () => {
    const artifact = await runCommandWithResourceCapture({
      command: 'node -e "process.exit(3)"',
      cwd: tmpdir(),
    });
    expect(artifact.exitCode).toBe(3);
  }, 15000);

  it("carries the declared command string on the artifact", async () => {
    const artifact = await runCommandWithResourceCapture({
      command: 'node -e "process.exit(0)"',
      cwd: tmpdir(),
    });
    expect(artifact.command).toBe('node -e "process.exit(0)"');
  }, 15000);
});
