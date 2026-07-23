/**
 * roadmap/09-cli-and-doctor.md — adversarial-review fix (2026-07-24),
 * finding #5: "doctor auth probe is a constant-fail stub in the shipped
 * binary." This suite proves the REAL dependency-wiring function
 * (`buildRealCliDependencies`, what `bin.ts` actually calls) wires a real,
 * non-constant-fail `resolveAuthState` by default — scoped to the same
 * `HOME` the rest of the wiring resolves against — and that its "valid"
 * branch genuinely fires given a real auth signal, not just that an
 * injected fake can be made to say so.
 */
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildRealCliDependencies } from "./bootstrap.js";

let home: string;

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "eo-bootstrap-"));
});

afterEach(async () => {
  await rm(home, { recursive: true, force: true });
});

describe("buildRealCliDependencies", () => {
  it("wires a real (non-constant-fail) resolveAuthState by default: 'missing' with nothing planted, 'valid' once a real credential file is planted under the same HOME", async () => {
    const deps = buildRealCliDependencies({ xdgEnv: { HOME: home }, projectHash: "boot-hash" });
    expect(deps.resolveAuthState).toBeDefined();

    // Nothing planted yet — the real (non-stub) resolver genuinely computes "missing".
    expect(await deps.resolveAuthState!()).toBe("missing");

    // Plant a real, correctly-permissioned handoff file under the SAME HOME
    // this dependency bag was built against, then re-derive dependencies
    // the same way — the "valid" branch of the ACTUAL default wiring now
    // genuinely fires, proving it isn't hardcoded to any fixed verdict.
    await mkdir(join(home, ".claude"), { recursive: true });
    const tokenPath = join(home, ".claude", ".eo-oauth-token");
    await writeFile(tokenPath, "fixture-token-value\n", "utf8");
    await chmod(tokenPath, 0o600);

    const depsAfterPlanting = buildRealCliDependencies({
      xdgEnv: { HOME: home },
      projectHash: "boot-hash",
    });
    expect(await depsAfterPlanting.resolveAuthState!()).toBe("valid");
  });

  it("honors an explicit resolveAuthState override", async () => {
    const deps = buildRealCliDependencies({
      xdgEnv: { HOME: home },
      projectHash: "boot-hash-2",
      resolveAuthState: async () => "valid",
    });
    expect(await deps.resolveAuthState!()).toBe("valid");
  });

  it("derives projectHash/journal/connectClient from the supplied xdgEnv when no override is given", () => {
    const deps = buildRealCliDependencies({ xdgEnv: { HOME: home } });
    expect(deps.projectHash).toBeDefined();
    expect(deps.journal).toBeDefined();
    expect(typeof deps.connectClient).toBe("function");
  });
});
