import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { buildProjectProfile } from "@eo/testkit";
import { NoBenchmarkCommandError } from "../errors.js";
import {
  createGenericCommandAdapter,
  resolveDeclaredBenchmarkCommand,
} from "./generic-command-adapter.js";

/** Conformance fixture for the generic-command adapter — roadmap/15 §Work items 3: "one conformance fixture per adapter type." */
describe("generic-command adapter", () => {
  it("resolveDeclaredBenchmarkCommand resolves the named ecosystem's benchmarkCommand", () => {
    const profile = buildProjectProfile({
      ecosystems: [
        {
          ecosystem: "node",
          packagePath: ".",
          testCommands: { unit: "npm test" },
          benchmarkCommand: "npm run bench",
        },
      ],
    });
    expect(resolveDeclaredBenchmarkCommand(profile, "node")).toBe("npm run bench");
  });

  it("resolveDeclaredBenchmarkCommand falls back to the first ecosystem carrying a benchmarkCommand when none is named", () => {
    const profile = buildProjectProfile({
      ecosystems: [
        { ecosystem: "node", packagePath: ".", testCommands: { unit: "npm test" } },
        {
          ecosystem: "go",
          packagePath: "./svc",
          testCommands: { unit: "go test" },
          benchmarkCommand: "go test -bench=.",
        },
      ],
    });
    expect(resolveDeclaredBenchmarkCommand(profile)).toBe("go test -bench=.");
  });

  it("throws NoBenchmarkCommandError when nothing is declared", () => {
    const profile = buildProjectProfile();
    expect(() => resolveDeclaredBenchmarkCommand(profile)).toThrow(NoBenchmarkCommandError);
  });

  it("throws NoBenchmarkCommandError for a named ecosystem with no declared command", () => {
    const profile = buildProjectProfile();
    expect(() => resolveDeclaredBenchmarkCommand(profile, "node")).toThrow(NoBenchmarkCommandError);
  });

  it("runs the resolved command and returns a schema-valid ResourceCaptureArtifact", async () => {
    const profile = buildProjectProfile({
      ecosystems: [
        {
          ecosystem: "node",
          packagePath: ".",
          testCommands: { unit: "npm test" },
          benchmarkCommand: 'node -e "process.exit(0)"',
        },
      ],
    });
    const adapter = createGenericCommandAdapter({ profile, ecosystem: "node" });
    expect(adapter.name).toBe("generic-command");
    const artifact = await adapter.run({ cwd: tmpdir() });
    expect(artifact.command).toBe('node -e "process.exit(0)"');
    expect(artifact.exitCode).toBe(0);
  }, 15000);
});
