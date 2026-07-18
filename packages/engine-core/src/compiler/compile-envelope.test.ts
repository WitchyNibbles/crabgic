import { describe, expect, it } from "vitest";
import { compileEnvelope } from "./compile-envelope.js";
import { buildEnvelopeFixture } from "./envelope-fixture.js";
import { CompiledWorkerProfileSchema } from "./compiled-worker-profile.js";

/**
 * `compileEnvelope` integration tests (roadmap/03-envelope-compiler-
 * engine-adapter.md §Goal, work items 2/3).
 */
describe("compileEnvelope", () => {
  it("returns a CompiledWorkerProfile that validates against its own schema", () => {
    const compiled = compileEnvelope(buildEnvelopeFixture());
    expect(CompiledWorkerProfileSchema.safeParse(compiled).success).toBe(true);
  });

  it("is pure — the same envelope compiles to a deep-equal profile on every call", () => {
    const envelope = buildEnvelopeFixture({ ownedPaths: ["packages/a/src"] });
    expect(compileEnvelope(envelope)).toEqual(compileEnvelope(envelope));
  });

  it("does not mutate its input envelope", () => {
    const envelope = buildEnvelopeFixture({
      ownedPaths: ["packages/a/src"],
      commands: ["git status"],
    });
    const snapshot = JSON.parse(JSON.stringify(envelope)) as unknown;
    compileEnvelope(envelope);
    expect(JSON.parse(JSON.stringify(envelope))).toEqual(snapshot);
  });

  it("settingsJson.permissions/sandbox equal the top-level compiled permissions/sandbox", () => {
    const compiled = compileEnvelope(buildEnvelopeFixture());
    expect(compiled.settingsJson.permissions).toEqual(compiled.permissions);
    expect(compiled.settingsJson.sandbox).toEqual(compiled.sandbox);
  });

  it("sdkOptions.allowedTools/disallowedTools mirror permissions.allow/deny exactly", () => {
    const compiled = compileEnvelope(
      buildEnvelopeFixture({ ownedPaths: ["x"], commands: ["git diff"] }),
    );
    expect(compiled.sdkOptions.allowedTools).toEqual(compiled.permissions.allow);
    expect(compiled.sdkOptions.disallowedTools).toEqual(compiled.permissions.deny);
  });
});
