import { describe, expect, it } from "vitest";
import { buildTaskPacket, buildWorkerResult } from "@eo/testkit";
import {
  allowAllAdjudicate,
  buildMinimalCompiledProfile,
} from "../test-support/minimal-compiled-profile.js";
import { buildReproducerFixture, replayReproducer } from "./reproducer-harness.js";

const OBSERVATION_ID = "11111111-1111-4111-8111-111111111111";

describe("buildReproducerFixture", () => {
  it("wraps a FakeEngineScript, correlated to the observation id", () => {
    const fixture = buildReproducerFixture({
      observationId: OBSERVATION_ID,
      failingScript: { failure: { kind: "schemaViolation" } },
    });
    expect(fixture.observationId).toBe(OBSERVATION_ID);
    expect(fixture.script.failure).toEqual({ kind: "schemaViolation" });
  });

  it("defaults to a neutral, non-failing script when no overrides are given", () => {
    const fixture = buildReproducerFixture({ observationId: OBSERVATION_ID });
    expect(fixture.script.failure).toBeUndefined();
  });
});

describe("replayReproducer", () => {
  it("replays a schema-violating fixture and reports schemaViolation — proving the failure genuinely reproduces", async () => {
    const fixture = buildReproducerFixture({
      observationId: OBSERVATION_ID,
      failingScript: { failure: { kind: "schemaViolation" } },
    });
    const validation = await replayReproducer({
      fixture,
      packet: buildTaskPacket(),
      profile: buildMinimalCompiledProfile(),
      adjudicate: allowAllAdjudicate,
    });
    expect(validation.kind).toBe("schemaViolation");
  });

  it("replays a healthy fixture and reports valid — the harness itself is not biased toward always-fail", async () => {
    const fixture = buildReproducerFixture({
      observationId: OBSERVATION_ID,
      failingScript: { structuredOutput: buildWorkerResult({ outcome: "succeeded" }) },
    });
    const validation = await replayReproducer({
      fixture,
      packet: buildTaskPacket(),
      profile: buildMinimalCompiledProfile(),
      adjudicate: allowAllAdjudicate,
    });
    expect(validation.kind).toBe("valid");
  });
});
