import { describe, expect, it } from "vitest";

import { provisionAndRun } from "../src/provisioning.js";
import { FakeComposeRunner } from "../src/testing/fakeComposeRunner.js";
import { verifyTornDown } from "../src/verifyTornDown.js";

describe("provisionAndRun — happy path", () => {
  it("brings the environment up, runs the probe, and tears down afterward", async () => {
    const runner = new FakeComposeRunner();
    const outcome = await provisionAndRun(
      { runId: "happy-1", composeFile: "x.yml", services: ["app"], healthPollIntervalMs: 5 },
      undefined,
      async (ctx) => {
        expect(ctx.runId).toBe("happy-1");
        return "probe-result";
      },
      { runner },
    );

    expect(outcome).toEqual({ status: "ok", result: "probe-result" });
    expect((await verifyTornDown("happy-1", runner)).tornDown).toBe(true);
  });

  it("waits for an app-level healthProbe when one is supplied", async () => {
    const runner = new FakeComposeRunner();
    let probeCalls = 0;
    const healthProbe = async (): Promise<boolean> => {
      probeCalls += 1;
      return probeCalls >= 3;
    };

    const outcome = await provisionAndRun(
      { runId: "healthprobe-1", composeFile: "x.yml", healthPollIntervalMs: 5 },
      healthProbe,
      async () => "ok",
      { runner },
    );

    expect(outcome).toEqual({ status: "ok", result: "ok" });
    expect(probeCalls).toBeGreaterThanOrEqual(3);
    expect((await verifyTornDown("healthprobe-1", runner)).tornDown).toBe(true);
  });
});

describe("provisionAndRun — timeout path (Jira DC-style heavy/never-healthy container)", () => {
  it("returns status: 'timeout' and still tears down when health never arrives", async () => {
    const runner = new FakeComposeRunner();
    runner.seedNeverHealthy("timeout-1", "jira");

    const outcome = await provisionAndRun(
      {
        runId: "timeout-1",
        composeFile: "x.yml",
        services: ["jira"],
        healthTimeoutMs: 30,
        healthPollIntervalMs: 5,
      },
      undefined,
      async () => "unreachable",
      { runner },
    );

    expect(outcome.status).toBe("timeout");
    if (outcome.status === "timeout") {
      expect(outcome.waitedMs).toBe(30);
    }
    expect((await verifyTornDown("timeout-1", runner)).tornDown).toBe(true);
  });
});

describe("provisionAndRun — error path", () => {
  it("returns status: 'error' and still tears down when the probe throws", async () => {
    const runner = new FakeComposeRunner();

    const outcome = await provisionAndRun(
      { runId: "error-1", composeFile: "x.yml", healthPollIntervalMs: 5 },
      undefined,
      async () => {
        throw new Error("probe blew up");
      },
      { runner },
    );

    expect(outcome).toEqual({ status: "error", message: "probe blew up" });
    expect((await verifyTornDown("error-1", runner)).tornDown).toBe(true);
  });

  it("stringifies a non-Error throw", async () => {
    const runner = new FakeComposeRunner();

    const outcome = await provisionAndRun(
      { runId: "error-2", composeFile: "x.yml", healthPollIntervalMs: 5 },
      undefined,
      async () => {
        throw "raw string throw";
      },
      { runner },
    );

    expect(outcome).toEqual({ status: "error", message: "raw string throw" });
  });

  it("still tears down (via pruneRun) when down() alone leaves a resource behind", async () => {
    const runner = new FakeComposeRunner();
    runner.seedDownLeavesVolumeBehind("error-3");

    const outcome = await provisionAndRun(
      { runId: "error-3", composeFile: "x.yml", healthPollIntervalMs: 5 },
      undefined,
      async () => {
        throw new Error("boom");
      },
      { runner },
    );

    expect(outcome.status).toBe("error");
    expect((await verifyTornDown("error-3", runner)).tornDown).toBe(true);
  });
});
