import { describe, expect, it } from "vitest";

import { FakeComposeRunner } from "../src/testing/fakeComposeRunner.js";
import { verifyTornDown } from "../src/verifyTornDown.js";
import { ProvisionConfigSchema } from "../src/types.js";

describe("verifyTornDown", () => {
  it("reports tornDown: true when nothing exists for a runId", async () => {
    const runner = new FakeComposeRunner();
    const verification = await verifyTornDown("never-provisioned", runner);
    expect(verification).toEqual({
      tornDown: true,
      surviving: { containers: [], volumes: [], networks: [] },
    });
  });

  it("reports tornDown: false while containers/volumes/networks are still up", async () => {
    const runner = new FakeComposeRunner();
    const config = ProvisionConfigSchema.parse({ runId: "run-up", composeFile: "x.yml" });
    await runner.up(config);

    const verification = await verifyTornDown("run-up", runner);

    expect(verification.tornDown).toBe(false);
    expect(verification.surviving.containers.length).toBeGreaterThan(0);
    expect(verification.surviving.volumes.length).toBeGreaterThan(0);
    expect(verification.surviving.networks.length).toBeGreaterThan(0);
  });

  it("reports tornDown: true after down() when down() fully cleans up", async () => {
    const runner = new FakeComposeRunner();
    const config = ProvisionConfigSchema.parse({ runId: "run-clean", composeFile: "x.yml" });
    await runner.up(config);
    await runner.down(config);

    expect((await verifyTornDown("run-clean", runner)).tornDown).toBe(true);
  });

  it("reports tornDown: false when down() alone leaves a labeled volume behind", async () => {
    const runner = new FakeComposeRunner();
    runner.seedDownLeavesVolumeBehind("run-partial");
    const config = ProvisionConfigSchema.parse({ runId: "run-partial", composeFile: "x.yml" });
    await runner.up(config);
    await runner.down(config);

    const verification = await verifyTornDown("run-partial", runner);
    expect(verification.tornDown).toBe(false);
    expect(verification.surviving.volumes).toHaveLength(1);
  });

  it("reports tornDown: true once pruneRun sweeps what down() left behind", async () => {
    const runner = new FakeComposeRunner();
    runner.seedDownLeavesVolumeBehind("run-swept");
    const config = ProvisionConfigSchema.parse({ runId: "run-swept", composeFile: "x.yml" });
    await runner.up(config);
    await runner.down(config);
    await runner.pruneRun("run-swept");

    expect((await verifyTornDown("run-swept", runner)).tornDown).toBe(true);
  });
});
