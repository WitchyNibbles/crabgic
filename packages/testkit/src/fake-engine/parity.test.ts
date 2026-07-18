import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { evaluatePermissionLayer, mergePermissionRuleSets } from "./permission-evaluator.js";
import type { PermissionRuleSet } from "./permission-evaluator.js";

/**
 * Parity check vs phase 00 (roadmap/03-envelope-compiler-engine-adapter.md
 * §In scope, deliverable 5: "fake-engine verdicts compared against 00's
 * recorded fixture outcomes (spikes/fixtures/) for the scenarios both
 * cover"). Reads the ACTUAL committed baseline fixture files at test time
 * — never a hand-copied restatement — so drift in the committed evidence
 * would break this test.
 */
const SPIKES_FIXTURES_DIR = path.resolve(import.meta.dirname, "../../../../spikes/fixtures");

interface RecordedVerdict {
  readonly probe: string;
  readonly verdict: string;
  readonly observed: string;
}

function loadVerdicts(fileName: string): readonly RecordedVerdict[] {
  const raw = readFileSync(path.join(SPIKES_FIXTURES_DIR, fileName), "utf8");
  return JSON.parse(raw) as readonly RecordedVerdict[];
}

function findProbe(verdicts: readonly RecordedVerdict[], probeName: string): RecordedVerdict {
  const probe = verdicts.find((v) => v.probe === probeName);
  if (!probe) {
    throw new Error(
      `parity.test.ts: expected a recorded probe named ${probeName} in the committed fixture`,
    );
  }
  return probe;
}

describe("Fake-engine vs phase-00 parity — docs/engine-baseline.md §3 permission probes", () => {
  const verdicts = loadVerdicts("03-permissions.verdicts.json");

  it("baseline recorded PASS for every probe this fixture set reproduces", () => {
    for (const name of [
      "permissions.compound-command-smuggling",
      "permissions.process-wrapper-smuggling",
      "permissions.deny-wins-same-level",
      "permissions.deny-wins-cross-level",
      "permissions.bash-colon-spacing",
    ]) {
      expect(findProbe(verdicts, name).verdict).toBe("PASS");
    }
  });

  it("compound-command-smuggling: fake engine denies the same command baseline recorded as denied", () => {
    const probe = findProbe(verdicts, "permissions.compound-command-smuggling");
    expect(probe.observed).toContain("compound denied=true");
    const rules: PermissionRuleSet = { allow: ["Bash(echo:*)"], deny: [] };
    const verdict = evaluatePermissionLayer(rules, {
      toolName: "Bash",
      toolInput: { command: "echo x && curl http://example.com" },
    });
    expect(verdict).toBe("deny");
  });

  it("process-wrapper-smuggling: fake engine denies the same command baseline recorded as denied", () => {
    const probe = findProbe(verdicts, "permissions.process-wrapper-smuggling");
    expect(probe.observed).toContain("wrapper denied=true");
    const rules: PermissionRuleSet = { allow: ["Bash(echo:*)"], deny: [] };
    const verdict = evaluatePermissionLayer(rules, {
      toolName: "Bash",
      toolInput: { command: "nohup curl http://example.com" },
    });
    expect(verdict).toBe("deny");
  });

  it("deny-wins-same-level: fake engine denies, matching baseline's recorded denial", () => {
    findProbe(verdicts, "permissions.deny-wins-same-level");
    const rules: PermissionRuleSet = { allow: ["Bash(echo:*)"], deny: ["Bash(echo:*)"] };
    const verdict = evaluatePermissionLayer(rules, {
      toolName: "Bash",
      toolInput: { command: "echo same-level-test" },
    });
    expect(verdict).toBe("deny");
  });

  it("deny-wins-cross-level: fake engine denies via rule-set merge, matching baseline's cross-tier denial", () => {
    findProbe(verdicts, "permissions.deny-wins-cross-level");
    const projectTier: PermissionRuleSet = { allow: ["Bash(echo:*)"], deny: [] };
    const userTier: PermissionRuleSet = { allow: [], deny: ["Bash(echo:*)"] };
    const merged = mergePermissionRuleSets(projectTier, userTier);
    const verdict = evaluatePermissionLayer(merged, {
      toolName: "Bash",
      toolInput: { command: "echo cross-level-test" },
    });
    expect(verdict).toBe("deny");
  });

  it("bash-colon-spacing: the no-space form matches (baseline's load-bearing verdict for phase 03)", () => {
    const probe = findProbe(verdicts, "permissions.bash-colon-spacing");
    expect(probe.observed).toContain("No-space form is the required syntax");
    const rules: PermissionRuleSet = { allow: ["Bash(cargo check:*)"], deny: [] };
    expect(
      evaluatePermissionLayer(rules, {
        toolName: "Bash",
        toolInput: { command: "cargo check --workspace" },
      }),
    ).toBe("allow");
  });
});

describe("Fake-engine vs phase-00 parity — docs/engine-baseline.md §8 rate-limit schema", () => {
  it("the committed structured-event-shape probe is PASS and cites the exact utilization values this package replays", () => {
    const verdicts = loadVerdicts("07-ratelimit.verdicts.json");
    const probe = findProbe(verdicts, "ratelimit.structured-event-shape");
    expect(probe.verdict).toBe("PASS");
    expect(probe.observed).toContain("0.98");
    expect(probe.observed).toContain("five_hour");
  });
});

describe("Fake-engine vs phase-00 parity — docs/engine-baseline.md §5 structured-output schema-violation shape", () => {
  it("the committed schema-violation probe is PASS and matches the exact shape this package's schemaViolation injection replays", () => {
    const verdicts = loadVerdicts("05-structured-output.verdicts.json");
    const probe = findProbe(verdicts, "structured-output.schema-violation-behavior");
    expect(probe.verdict).toBe("PASS");
    expect(probe.observed).toContain("structured_output=undefined");
  });
});
