import { describe, expect, it } from "vitest";
import {
  resolveDevCasesDir,
  resolveGraderDir,
  resolveHeldOutCasesDir,
  resolveLearningDir,
  resolveRegistryDir,
} from "./layout.js";

const env = { HOME: "/home/tester" };
const projectHash = "abc123";

describe("learning layout — nests under 04's pinned state root", () => {
  it("resolveLearningDir nests directly under the state root", () => {
    expect(resolveLearningDir(env, projectHash)).toBe(
      "/home/tester/.local/state/engineering-orchestrator/abc123/learning",
    );
  });

  it("resolveRegistryDir/resolveGraderDir are disjoint siblings under learning/", () => {
    const registryDir = resolveRegistryDir(env, projectHash);
    const graderDir = resolveGraderDir(env, projectHash);
    expect(registryDir).not.toBe(graderDir);
    expect(registryDir.startsWith(resolveLearningDir(env, projectHash))).toBe(true);
    expect(graderDir.startsWith(resolveLearningDir(env, projectHash))).toBe(true);
  });

  it("resolveDevCasesDir/resolveHeldOutCasesDir are disjoint siblings under grader/", () => {
    const devDir = resolveDevCasesDir(env, projectHash);
    const heldOutDir = resolveHeldOutCasesDir(env, projectHash);
    expect(devDir).not.toBe(heldOutDir);
    expect(devDir.startsWith(resolveGraderDir(env, projectHash))).toBe(true);
    expect(heldOutDir.startsWith(resolveGraderDir(env, projectHash))).toBe(true);
  });
});
