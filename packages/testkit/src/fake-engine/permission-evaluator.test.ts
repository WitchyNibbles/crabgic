import { describe, expect, it } from "vitest";
import { GATEWAY_MCP_SERVER_NAME } from "@eo/contracts";
import {
  evaluatePermissionLayer,
  mergePermissionRuleSets,
  permissionProfileToRuleSet,
  type PermissionRuleSet,
} from "./permission-evaluator.js";

/**
 * Layer 2 (permissions) — roadmap/03-envelope-compiler-engine-adapter.md
 * §In scope "Fake engine" bullet: "a permission-rule evaluator ...
 * asserting exactly the baseline-recorded verdicts." Every scenario below
 * cites the docs/engine-baseline.md §3 probe it reproduces.
 */
const ECHO_ONLY: PermissionRuleSet = { allow: ["Bash(echo:*)"], deny: [] };

describe("evaluatePermissionLayer — dontAsk default-deny", () => {
  it("denies an unlisted tool (baseline: 'dontAsk auto-denies an unlisted tool (Write)')", () => {
    const rules: PermissionRuleSet = { allow: [], deny: [] };
    expect(
      evaluatePermissionLayer(rules, { toolName: "Write", toolInput: { file_path: "/tmp/x" } }),
    ).toBe("deny");
  });

  it("allows a Bash command matching an allow-listed prefix", () => {
    expect(
      evaluatePermissionLayer(ECHO_ONLY, { toolName: "Bash", toolInput: { command: "echo safe" } }),
    ).toBe("allow");
  });

  it("denies a Bash call with a missing/non-string command (decomposes to zero subcommands)", () => {
    const verdict = evaluatePermissionLayer(ECHO_ONLY, { toolName: "Bash", toolInput: {} });
    expect(verdict).toBe("deny");
  });
});

describe("evaluatePermissionLayer — compound-command and process-wrapper smuggling (baseline §3)", () => {
  it("denies 'echo x && curl ...' — curl subcommand independently fails to match", () => {
    const verdict = evaluatePermissionLayer(ECHO_ONLY, {
      toolName: "Bash",
      toolInput: { command: "echo x && curl http://example.com" },
    });
    expect(verdict).toBe("deny");
  });

  it("denies 'nohup curl ...' — wrapper stripped, curl still fails to match", () => {
    const verdict = evaluatePermissionLayer(ECHO_ONLY, {
      toolName: "Bash",
      toolInput: { command: "nohup curl http://example.com" },
    });
    expect(verdict).toBe("deny");
  });

  it("the un-smuggled control command (echo alone) still allows", () => {
    const verdict = evaluatePermissionLayer(ECHO_ONLY, {
      toolName: "Bash",
      toolInput: { command: "echo safe" },
    });
    expect(verdict).toBe("allow");
  });
});

describe("evaluatePermissionLayer — deny-wins (baseline §3)", () => {
  it("same-level: a rule present in both allow and deny is denied", () => {
    const rules: PermissionRuleSet = { allow: ["Bash(echo:*)"], deny: ["Bash(echo:*)"] };
    const verdict = evaluatePermissionLayer(rules, {
      toolName: "Bash",
      toolInput: { command: "echo same-level-test" },
    });
    expect(verdict).toBe("deny");
  });

  it("cross-level: merging a project-tier allow with a user-tier deny for the same rule still denies", () => {
    const projectTier: PermissionRuleSet = { allow: ["Bash(echo:*)"], deny: [] };
    const userTier: PermissionRuleSet = { allow: [], deny: ["Bash(echo:*)"] };
    const merged = mergePermissionRuleSets(projectTier, userTier);
    const verdict = evaluatePermissionLayer(merged, {
      toolName: "Bash",
      toolInput: { command: "echo cross-level-test" },
    });
    expect(verdict).toBe("deny");
  });
});

describe("evaluatePermissionLayer — Edit/Write path matching (baseline §3 'edit-outside-allowed-path')", () => {
  const rules: PermissionRuleSet = {
    allow: ["Edit(//packages/example/src/**)", "Write(//packages/example/src/**)"],
    deny: [],
  };

  it("allows an Edit inside the owned path", () => {
    expect(
      evaluatePermissionLayer(rules, {
        toolName: "Edit",
        toolInput: { file_path: "packages/example/src/foo.ts" },
      }),
    ).toBe("allow");
  });

  it("denies an Edit outside the owned path", () => {
    expect(
      evaluatePermissionLayer(rules, {
        toolName: "Edit",
        toolInput: { file_path: "packages/other/src/foo.ts" },
      }),
    ).toBe("deny");
  });

  it("denies a relative traversal escape out of the owned path", () => {
    expect(
      evaluatePermissionLayer(rules, {
        toolName: "Edit",
        toolInput: { file_path: "packages/example/src/../../../etc/passwd" },
      }),
    ).toBe("deny");
  });

  it("denies an absolute-path escape attempt", () => {
    expect(
      evaluatePermissionLayer(rules, { toolName: "Edit", toolInput: { file_path: "/etc/passwd" } }),
    ).toBe("deny");
  });

  it("an explicit path deny rule wins over a matching path allow rule (deny-wins)", () => {
    const denyingRules: PermissionRuleSet = {
      allow: ["Edit(//packages/example/src/**)"],
      deny: ["Edit(//packages/example/src/**)"],
    };
    expect(
      evaluatePermissionLayer(denyingRules, {
        toolName: "Edit",
        toolInput: { file_path: "packages/example/src/foo.ts" },
      }),
    ).toBe("deny");
  });
});

describe("evaluatePermissionLayer — generic bare tool-name rules (non-Bash/Edit/Write/Read/mcp__)", () => {
  it("allows a call matching an exact tool-name allow rule", () => {
    const rules: PermissionRuleSet = { allow: ["CustomTool"], deny: [] };
    expect(evaluatePermissionLayer(rules, { toolName: "CustomTool", toolInput: {} })).toBe("allow");
  });

  it("denies an unlisted generic tool call by default (dontAsk default-deny)", () => {
    const rules: PermissionRuleSet = { allow: [], deny: [] };
    expect(evaluatePermissionLayer(rules, { toolName: "CustomTool", toolInput: {} })).toBe("deny");
  });
});

describe("evaluatePermissionLayer — Agent/Task alias (baseline §4: deny 'Agent' removes the 'Task' tool literal)", () => {
  it("a deny:['Agent'] ruleset denies a call to the live 'Task' tool literal", () => {
    const rules: PermissionRuleSet = { allow: [], deny: ["Agent"] };
    expect(evaluatePermissionLayer(rules, { toolName: "Task", toolInput: {} })).toBe("deny");
  });
});

describe("evaluatePermissionLayer — mcp__ tool names and the blanket-deny footgun (adaptation Appendix B)", () => {
  it("allows a gateway tool call matching the server-scoped allow entry", () => {
    const rules: PermissionRuleSet = { allow: [`mcp__${GATEWAY_MCP_SERVER_NAME}__*`], deny: [] };
    expect(
      evaluatePermissionLayer(rules, {
        toolName: `mcp__${GATEWAY_MCP_SERVER_NAME}__search`,
        toolInput: {},
      }),
    ).toBe("allow");
  });

  it("a blanket mcp__* deny shadows the specific gateway allow (deny wins) — the footgun scenario", () => {
    const rules: PermissionRuleSet = {
      allow: [`mcp__${GATEWAY_MCP_SERVER_NAME}__*`],
      deny: ["mcp__*"],
    };
    expect(
      evaluatePermissionLayer(rules, {
        toolName: `mcp__${GATEWAY_MCP_SERVER_NAME}__search`,
        toolInput: {},
      }),
    ).toBe("deny");
  });
});

describe("evaluatePermissionLayer — MAJOR 2 regression: shell-metacharacter smuggling must deny, not allow", () => {
  const GIT_STATUS_ONLY: PermissionRuleSet = { allow: ["Bash(git status:*)"], deny: [] };

  it("'git status & curl evil' (single '&' background operator, not split by the compound-operator regex) must deny", () => {
    // Validator's exact attack: the compound splitter only recognizes
    // &&/||/;/| — a lone '&' leaves the whole string as ONE segment, which
    // .startsWith("git status ") — an unmatched trailing command smuggled
    // through as if it were part of the allowed prefix.
    expect(
      evaluatePermissionLayer(GIT_STATUS_ONLY, {
        toolName: "Bash",
        toolInput: { command: "git status & curl evil" },
      }),
    ).toBe("deny");
  });

  it("'git status $(curl evil)' (command substitution) must deny", () => {
    expect(
      evaluatePermissionLayer(GIT_STATUS_ONLY, {
        toolName: "Bash",
        toolInput: { command: "git status $(curl evil)" },
      }),
    ).toBe("deny");
  });

  it("'git status `curl evil`' (backtick command substitution) must deny", () => {
    expect(
      evaluatePermissionLayer(GIT_STATUS_ONLY, {
        toolName: "Bash",
        toolInput: { command: "git status `curl evil`" },
      }),
    ).toBe("deny");
  });

  it("'git status ${IFS}curl evil' (parameter expansion) must deny", () => {
    expect(
      evaluatePermissionLayer(GIT_STATUS_ONLY, {
        toolName: "Bash",
        toolInput: { command: "git status ${IFS}curl evil" },
      }),
    ).toBe("deny");
  });

  it("an embedded newline must deny", () => {
    expect(
      evaluatePermissionLayer(GIT_STATUS_ONLY, {
        toolName: "Bash",
        toolInput: { command: "git status\ncurl evil" },
      }),
    ).toBe("deny");
  });

  it("a redirect ('>') must deny", () => {
    expect(
      evaluatePermissionLayer(GIT_STATUS_ONLY, {
        toolName: "Bash",
        toolInput: { command: "git status > /etc/cron.d/evil" },
      }),
    ).toBe("deny");
  });

  it("the un-smuggled control command alone still allows (metacharacter denial does not over-block)", () => {
    expect(
      evaluatePermissionLayer(GIT_STATUS_ONLY, {
        toolName: "Bash",
        toolInput: { command: "git status" },
      }),
    ).toBe("allow");
  });
});

describe("mergePermissionRuleSets", () => {
  it("unions allow/deny arrays across every ruleset given, preserving order", () => {
    const merged = mergePermissionRuleSets(
      { allow: ["a"], deny: ["b"] },
      { allow: ["c"], deny: ["d"] },
    );
    expect(merged).toEqual({ allow: ["a", "c"], deny: ["b", "d"] });
  });

  it("merging zero rulesets yields an empty ruleset", () => {
    expect(mergePermissionRuleSets()).toEqual({ allow: [], deny: [] });
  });
});

describe("permissionProfileToRuleSet", () => {
  it("projects a PermissionProfile-shaped object down to just allow/deny", () => {
    const profile = {
      defaultMode: "dontAsk" as const,
      disableBypassPermissionsMode: "disable" as const,
      allow: ["x"],
      deny: ["y"],
      ask: [],
    };
    expect(permissionProfileToRuleSet(profile)).toEqual({ allow: ["x"], deny: ["y"] });
  });
});
