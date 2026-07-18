import { describe, expect, it } from "vitest";
import {
  compileEnvelope,
  STANDARD_IMPLEMENTATION_ENVELOPE,
  type EngineEvent,
  type EngineResultEvent,
} from "@eo/engine-core";
import { WorkerResultSchema } from "@eo/contracts";
import { buildTaskPacket } from "../fixtures/task-packet.js";
import { createIdProvider } from "../providers/id-provider.js";
import { alwaysAllowAdjudicate } from "./adjudication-layer.js";
import { buildFakeEngineScript } from "./scripted-trace.js";
import { FakeEngineAdapter } from "./fake-engine-adapter.js";
import { toWorkerResult } from "./engine-result-to-worker-result.js";

/**
 * Exit criterion 5 (roadmap/03-envelope-compiler-engine-adapter.md):
 * "Demo test: spawn fake worker -> attempt a smuggled command
 * (`allowed-cmd && curl ...`) -> observe denial -> receive a structured
 * `WorkerResult`-shaped failure — runs green in CI with no `claude` binary
 * installed." `FakeEngineAdapter` never spawns a subprocess or shells out
 * to any binary anywhere in this package — this test is green by
 * construction regardless of whether a `claude` CLI/SDK is present.
 */
describe("exit criterion 5 — smuggled-command demo", () => {
  it("spawn -> smuggled command -> observed denial -> structured WorkerResult-shaped failure", async () => {
    // STANDARD_IMPLEMENTATION_ENVELOPE authorizes `npm run test` among the
    // four doc-confirmed literals (@eo/engine-core canonical envelope).
    const profile = compileEnvelope(STANDARD_IMPLEMENTATION_ENVELOPE);
    const smuggledCommand = "npm run test && curl http://example.com";
    const script = buildFakeEngineScript({
      toolCalls: [{ toolName: "Bash", toolInput: { command: smuggledCommand } }],
    });
    const adapter = new FakeEngineAdapter(script);
    const handle = adapter.spawn(buildTaskPacket(), profile, alwaysAllowAdjudicate);

    const events: EngineEvent[] = [];
    for await (const event of handle.events) events.push(event);

    // Observe denial: the smuggled call never surfaces as an executed toolUse event.
    expect(events.some((event) => event.type === "toolUse")).toBe(false);

    const resultEvent = events.find((event): event is EngineResultEvent => event.type === "result");
    expect(resultEvent).toBeDefined();
    expect(resultEvent?.permissionDenials).toEqual([
      { toolName: "Bash", toolInput: { command: smuggledCommand } },
    ]);

    // Receive a structured WorkerResult-shaped failure.
    const ids = createIdProvider(0);
    const workerResult = toWorkerResult(resultEvent!, ids.next(), ids.next());
    expect(() => WorkerResultSchema.parse(workerResult)).not.toThrow();
    expect(workerResult.outcome).toBe("failed");
    expect(workerResult.diagnostics[0]).toContain("curl");
  });
});
