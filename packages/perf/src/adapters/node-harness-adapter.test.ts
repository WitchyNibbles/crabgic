import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createNodeHarnessAdapter } from "./node-harness-adapter.js";

/** Conformance fixture for the Node-harness adapter — roadmap/15 §Work items 3: "one conformance fixture per adapter type." */
describe("Node-harness adapter", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "eo-perf-node-harness-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("times a default-exported sync benchmark function and self-reports real getrusage figures", async () => {
    const modulePath = join(dir, "bench.mjs");
    await writeFile(
      modulePath,
      "export default function bench() {" +
        "const s=Date.now();let a=0;while(Date.now()-s<120){a+=Math.sqrt(a+1);}" +
        "const b=Buffer.alloc(5*1024*1024);b.fill(1);" +
        "}",
      "utf8",
    );

    const adapter = createNodeHarnessAdapter({ modulePath });
    expect(adapter.name).toBe("node-harness");
    const artifact = await adapter.run({ cwd: dir });

    expect(artifact.exitCode).toBe(0);
    expect(artifact.wallTimeMs).toBeGreaterThanOrEqual(110);
    expect(artifact.cpuUserMs + artifact.cpuSystemMs).toBeGreaterThan(0);
    expect(artifact.peakRssKb).toBeGreaterThan(0);
  }, 15000);

  it("supports a named export and an async function", async () => {
    const modulePath = join(dir, "bench-named.mjs");
    await writeFile(
      modulePath,
      "export async function slowAsync() {" + "await new Promise((r) => setTimeout(r, 50));" + "}",
      "utf8",
    );

    const adapter = createNodeHarnessAdapter({ modulePath, exportName: "slowAsync" });
    const artifact = await adapter.run({ cwd: dir });
    expect(artifact.exitCode).toBe(0);
    expect(artifact.wallTimeMs).toBeGreaterThanOrEqual(45);
  }, 15000);

  it("a benchmark module with no callable export exits non-zero and the artifact reflects it, without throwing", async () => {
    const modulePath = join(dir, "bench-broken.mjs");
    await writeFile(modulePath, "export default 42;", "utf8");
    const adapter = createNodeHarnessAdapter({ modulePath });
    const artifact = await adapter.run({ cwd: dir });
    expect(artifact.exitCode).not.toBe(0);
  }, 15000);
});
