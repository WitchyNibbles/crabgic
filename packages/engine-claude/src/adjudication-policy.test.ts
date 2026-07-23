/**
 * roadmap/06-claude-engine-adapter.md work item 3's first failing test:
 * "a forged tool call outside the envelope must be denied and the denial
 * journaled before the engine sees a response — fails, no callback
 * implementation exists." This file captures that RED-then-GREEN history
 * (see docs/evidence/phase-06/wi3-adjudication-result.md) and covers every
 * rule grammar `createEnvelopeAdjudicationPolicy` supports, incl. a
 * fast-check property test asserting verdict agreement with
 * `@eo/testkit`'s independent permission-evaluator reference model.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import * as fc from "fast-check";
import { createJournalStore, type JournalStore } from "@eo/journal";
import { createAdjudicationBus, type AdjudicationPolicy } from "@eo/supervisor";
import type { PermissionProfile } from "@eo/engine-core";
import { GATEWAY_MCP_SERVER_NAME } from "@eo/contracts";
import { evaluatePermissionLayer } from "@eo/testkit";
import { createEnvelopeAdjudicationPolicy, UnparseableRuleError } from "./adjudication-policy.js";

const NO_OP_CONTEXT = { signal: new AbortController().signal };

function buildProfile(allow: readonly string[], deny: readonly string[]): PermissionProfile {
  return {
    defaultMode: "dontAsk",
    disableBypassPermissionsMode: "disable",
    allow: [...allow],
    deny: [...deny],
    ask: [],
  };
}

describe("createEnvelopeAdjudicationPolicy — construction-time rule validation (fail-fast)", () => {
  it("throws UnparseableRuleError for a rule that matches none of the four grammars (unbalanced parens)", () => {
    expect(() =>
      createEnvelopeAdjudicationPolicy({ permissions: buildProfile(["Bash(echo:*"], []) }),
    ).toThrow(UnparseableRuleError);
  });

  it("throws UnparseableRuleError for a path rule missing the mandatory '/**' glob suffix", () => {
    expect(() =>
      createEnvelopeAdjudicationPolicy({ permissions: buildProfile(["Edit(//abs/path)"], []) }),
    ).toThrow(UnparseableRuleError);
  });

  it("throws UnparseableRuleError for a garbage deny rule even when every allow rule is valid", () => {
    expect(() =>
      createEnvelopeAdjudicationPolicy({
        permissions: buildProfile(["Bash(echo:*)"], ["not a valid rule (has spaces and parens("]),
      }),
    ).toThrow(UnparseableRuleError);
  });

  it("does not throw for one example of each of the four valid grammars", () => {
    expect(() =>
      createEnvelopeAdjudicationPolicy({
        permissions: buildProfile(
          ["Agent", "Bash(echo:*)", "Edit(~/.ssh/**)", `mcp__${GATEWAY_MCP_SERVER_NAME}__*`],
          [],
        ),
      }),
    ).not.toThrow();
  });
});

describe("createEnvelopeAdjudicationPolicy — deny wins, unlisted denies by default", () => {
  it("an unlisted tool is denied (baseline §3: dontAsk auto-denies an unlisted tool)", async () => {
    const policy = createEnvelopeAdjudicationPolicy({ permissions: buildProfile([], []) });
    const decision = await policy("Write", { file_path: "/tmp/x" }, NO_OP_CONTEXT);
    expect(decision.behavior).toBe("deny");
  });

  it("a rule present in both allow and deny denies (deny wins, same level)", async () => {
    const policy = createEnvelopeAdjudicationPolicy({
      permissions: buildProfile(["Bash(echo:*)"], ["Bash(echo:*)"]),
    });
    const decision = await policy("Bash", { command: "echo hi" }, NO_OP_CONTEXT);
    expect(decision.behavior).toBe("deny");
  });

  it("allow decision canonicalizes updatedInput to the identical (unmodified) toolInput", async () => {
    const policy = createEnvelopeAdjudicationPolicy({
      permissions: buildProfile(["Bash(echo:*)"], []),
    });
    const toolInput = { command: "echo hi" };
    const decision = await policy("Bash", toolInput, NO_OP_CONTEXT);
    expect(decision.behavior).toBe("allow");
    expect(decision.behavior === "allow" && decision.updatedInput).toEqual(toolInput);
  });
});

describe("createEnvelopeAdjudicationPolicy — Agent/Task tool-name aliasing (baseline §4.1)", () => {
  it("a deny rule named 'Agent' denies a call literally named 'Task'", async () => {
    const policy = createEnvelopeAdjudicationPolicy({
      permissions: buildProfile(["Task"], ["Agent"]),
    });
    const decision = await policy("Task", {}, NO_OP_CONTEXT);
    expect(decision.behavior).toBe("deny");
  });

  it("a deny rule named 'Task' denies a call literally named 'Agent'", async () => {
    const policy = createEnvelopeAdjudicationPolicy({
      permissions: buildProfile(["Agent"], ["Task"]),
    });
    const decision = await policy("Agent", {}, NO_OP_CONTEXT);
    expect(decision.behavior).toBe("deny");
  });
});

describe("createEnvelopeAdjudicationPolicy — Bash compound-command / process-wrapper smuggling (baseline §3)", () => {
  const ECHO_ONLY = buildProfile(["Bash(echo:*)"], []);

  it("allows a plain matching prefix", async () => {
    const policy = createEnvelopeAdjudicationPolicy({ permissions: ECHO_ONLY });
    const decision = await policy("Bash", { command: "echo safe" }, NO_OP_CONTEXT);
    expect(decision.behavior).toBe("allow");
  });

  it("denies 'echo x && curl ...' — curl subcommand independently fails to match", async () => {
    const policy = createEnvelopeAdjudicationPolicy({ permissions: ECHO_ONLY });
    const decision = await policy(
      "Bash",
      { command: "echo x && curl http://example.com" },
      NO_OP_CONTEXT,
    );
    expect(decision.behavior).toBe("deny");
  });

  it("denies 'nohup curl ...' — wrapper stripped, curl still fails to match", async () => {
    const policy = createEnvelopeAdjudicationPolicy({ permissions: ECHO_ONLY });
    const decision = await policy(
      "Bash",
      { command: "nohup curl http://example.com" },
      NO_OP_CONTEXT,
    );
    expect(decision.behavior).toBe("deny");
  });

  it("denies a command carrying an unproven shell metacharacter (background '&') even if it also starts with an allowed prefix", async () => {
    const policy = createEnvelopeAdjudicationPolicy({ permissions: ECHO_ONLY });
    const decision = await policy("Bash", { command: "echo x & curl evil" }, NO_OP_CONTEXT);
    expect(decision.behavior).toBe("deny");
  });

  it("denies a command carrying an embedded newline even if it also starts with an allowed prefix", async () => {
    const policy = createEnvelopeAdjudicationPolicy({ permissions: ECHO_ONLY });
    const decision = await policy("Bash", { command: "echo x\ncurl evil" }, NO_OP_CONTEXT);
    expect(decision.behavior).toBe("deny");
  });

  it("denies a Bash call with a missing/non-string command (decomposes to zero subcommands)", async () => {
    const policy = createEnvelopeAdjudicationPolicy({ permissions: ECHO_ONLY });
    const decision = await policy("Bash", {}, NO_OP_CONTEXT);
    expect(decision.behavior).toBe("deny");
  });

  it("a non-Bash-shaped rule mixed into the same allow list is simply irrelevant to a Bash call, never mistakenly matched", async () => {
    const policy = createEnvelopeAdjudicationPolicy({
      permissions: buildProfile(["Agent", "Bash(echo:*)"], []),
    });
    const decision = await policy("Bash", { command: "echo safe" }, NO_OP_CONTEXT);
    expect(decision.behavior).toBe("allow");
  });
});

describe("createEnvelopeAdjudicationPolicy — mcp__ wildcard matching (Gap 11)", () => {
  const gatewayAllowRule = `mcp__${GATEWAY_MCP_SERVER_NAME}__*`;

  it("allows a call matching the gateway's mcp__<server>__* wildcard", async () => {
    const policy = createEnvelopeAdjudicationPolicy({
      permissions: buildProfile([gatewayAllowRule], []),
    });
    const decision = await policy(
      `mcp__${GATEWAY_MCP_SERVER_NAME}__result.submit`,
      {},
      NO_OP_CONTEXT,
    );
    expect(decision.behavior).toBe("allow");
  });

  it("denies a call to a DIFFERENT mcp server not covered by the scoped rule", async () => {
    const policy = createEnvelopeAdjudicationPolicy({
      permissions: buildProfile([gatewayAllowRule], []),
    });
    const decision = await policy("mcp__rogue_server__evil", {}, NO_OP_CONTEXT);
    expect(decision.behavior).toBe("deny");
  });
});

describe("createEnvelopeAdjudicationPolicy — '~/' and bare '/' anchored path rules", () => {
  // NOTE: `Read(~/**)` (an EMPTY base under the home anchor) is a genuine,
  // shared grammar-boundary edge case — stripping the mandatory trailing
  // `/**` glob suffix from the 4-character literal `~/**` leaves only `~`
  // (1 char), too short to still contain the 2-character `~/` anchor
  // prefix, so it degenerates into a worktree-relative-bucket literal
  // instead of a home-anchored one. `@eo/testkit`'s own
  // `classifyAnchoredString` has the IDENTICAL degeneration for this exact
  // input (verified directly: both implementations independently classify
  // the stripped `"~"` base as "//"-family, never as home-anchored) — this
  // is not a cross-model divergence, just a real limitation of the
  // empty-base spelling that engine-core's compiler never actually emits
  // (every real `~/`-anchored literal in this codebase has a non-empty
  // base, e.g. `~/.ssh/**`). These examples therefore use a realistic
  // non-empty broad-home literal instead.
  const broadHomeAllow = "Read(~/home-allow/**)";
  const sshDeny = "Read(~/.ssh/**)";

  it("denies a Read of a mandatory-sensitive '~/'-anchored deny path", async () => {
    const policy = createEnvelopeAdjudicationPolicy({
      permissions: buildProfile([broadHomeAllow], [sshDeny]),
    });
    const decision = await policy("Read", { file_path: "/home/user/.ssh/id_rsa" }, NO_OP_CONTEXT);
    expect(decision.behavior).toBe("deny");
  });

  it("allows a Read under a matching '/'-anchored allow when not under a '~/'-anchored denied suffix", async () => {
    // A '/'-anchored allow genuinely matches an absolute target (a
    // home-anchored allow does NOT widen to absolute targets — Finding 3),
    // while the '~/'-anchored ssh deny still widens (deny context) to catch
    // the sensitive suffix. This exercises the deny-side widening FALSE
    // branch (no `.ssh` segment in the target → the allow governs).
    const policy = createEnvelopeAdjudicationPolicy({
      permissions: buildProfile(["Read(/home/user/home-allow/**)"], [sshDeny]),
    });
    const decision = await policy(
      "Read",
      { file_path: "/home/user/home-allow/notes.txt" },
      NO_OP_CONTEXT,
    );
    expect(decision.behavior).toBe("allow");
  });

  it("an allow-only '~/'-anchored rule does NOT widen to an absolute target sharing only a mid-path segment (Finding 3: no false-ALLOW)", async () => {
    // `absoluteTargetContainsHomeSuffix` is safe as a false-DENY for deny
    // rules but would be a false-ALLOW if applied to allow rules: allow
    // `Read(~/.config/**)` must NOT match `/tmp/.config/evil` merely because
    // both contain a `.config` segment. The policy is an INDEPENDENT backstop
    // and must not assume the compiler only emits `~/` in deny position.
    const policy = createEnvelopeAdjudicationPolicy({
      permissions: buildProfile(["Read(~/.config/**)"], []),
    });
    const decision = await policy("Read", { file_path: "/tmp/.config/evil" }, NO_OP_CONTEXT);
    expect(decision.behavior).toBe("deny");
  });

  it("denies a target path that escapes the rule's base via '../' traversal", async () => {
    const policy = createEnvelopeAdjudicationPolicy({
      permissions: buildProfile(["Read(/home/user/home-allow/**)"], []),
    });
    const decision = await policy(
      "Read",
      { file_path: "/home/user/home-allow/../secret.txt" },
      NO_OP_CONTEXT,
    );
    expect(decision.behavior).toBe("deny");
  });

  it("supports a bare-relative (unanchored) path literal, per the grammar's own '/**'-suffix-only requirement", async () => {
    const policy = createEnvelopeAdjudicationPolicy({
      permissions: buildProfile(["Read(notes/**)"], []),
    });
    // A bare-relative rule has no real-world compiled equivalent in this
    // codebase (owned-path rules are always '//'-anchored) — this only
    // proves the parser/matcher accept the form the grammar itself allows.
    const decision = await policy("Read", { file_path: "notes/todo.txt" }, NO_OP_CONTEXT);
    expect(decision.behavior).toBe("allow");
  });

  it("a bare '/'-anchored rule with an empty base after the glob suffix ('Read(//**)') matches any absolute path", async () => {
    const policy = createEnvelopeAdjudicationPolicy({
      permissions: buildProfile(["Read(//**)"], []),
    });
    const decision = await policy("Read", { file_path: "/anything/at/all.txt" }, NO_OP_CONTEXT);
    expect(decision.behavior).toBe("allow");
  });
});

describe("createEnvelopeAdjudicationPolicy — '//'-anchored substituted-worktree paths (the anchor caveat, docs/engine-baseline.md §3)", () => {
  /**
   * After spawn-time placeholder substitution (README decision 6), an
   * owned-path allow rule compiled as `Edit(//<worktree>/pkg/foo/**)`
   * becomes `Edit(///abs/worktree/pkg/foo/**)` once `<worktree>` is
   * replaced with a real absolute path — three leading slashes total. This
   * describes exactly that shape directly (this policy's own binding
   * precondition), not the pre-substitution literal.
   */
  const worktree = "/home/eimi/wt";
  const allowRule = `Edit(//${worktree}/packages/foo/**)`;

  it("allows an Edit inside the substituted owned path (the leading-extra-slash anchor caveat)", async () => {
    const policy = createEnvelopeAdjudicationPolicy({ permissions: buildProfile([allowRule], []) });
    const decision = await policy(
      "Edit",
      { file_path: `${worktree}/packages/foo/bar.ts` },
      NO_OP_CONTEXT,
    );
    expect(decision.behavior).toBe("allow");
  });

  it("denies an Edit escaping the owned path (sibling directory outside the owned subtree)", async () => {
    const policy = createEnvelopeAdjudicationPolicy({ permissions: buildProfile([allowRule], []) });
    const decision = await policy(
      "Edit",
      { file_path: `${worktree}/packages/other/bar.ts` },
      NO_OP_CONTEXT,
    );
    expect(decision.behavior).toBe("deny");
  });

  it("denies an Edit into a similarly-prefixed SIBLING worktree directory (never a naive string-prefix match)", async () => {
    const policy = createEnvelopeAdjudicationPolicy({ permissions: buildProfile([allowRule], []) });
    const decision = await policy(
      "Edit",
      { file_path: `${worktree}-evil/packages/foo/bar.ts` },
      NO_OP_CONTEXT,
    );
    expect(decision.behavior).toBe("deny");
  });

  it("DOCUMENTS the expected divergence: @eo/testkit's reference evaluator denies this exact substituted rule (it only ever resolves the literal <worktree> placeholder token, per its own doc comment)", () => {
    const verdict = evaluatePermissionLayer(
      { allow: [allowRule], deny: [] },
      { toolName: "Edit", toolInput: { file_path: `${worktree}/packages/foo/bar.ts` } },
    );
    expect(verdict).toBe("deny");
  });
});

describe("createEnvelopeAdjudicationPolicy — fail-closed on runtime evaluation failure", () => {
  it("a hostile toolInput whose property access throws still resolves to deny, never allow", async () => {
    const policy = createEnvelopeAdjudicationPolicy({
      permissions: buildProfile(["Bash(echo:*)"], []),
    });
    const hostileToolInput = new Proxy(
      {},
      {
        get() {
          throw new Error("hostile getter");
        },
      },
    ) as Readonly<Record<string, unknown>>;
    const decision = await policy("Bash", hostileToolInput, NO_OP_CONTEXT);
    expect(decision.behavior).toBe("deny");
  });
});

describe("integration: createEnvelopeAdjudicationPolicy + supervisor's real createAdjudicationBus + a real temp-dir JournalStore", () => {
  let journalDir: string;
  let store: JournalStore;

  beforeEach(async () => {
    journalDir = await mkdtemp(join(tmpdir(), "eo-engine-claude-adjudication-"));
    store = createJournalStore({ journalDir });
  });

  afterEach(async () => {
    await rm(journalDir, { recursive: true, force: true });
  });

  it("roadmap/06 work item 3's first failing test: a forged tool call outside the envelope is denied AND the adjudication_decision entry is journaled before the decision returns", async () => {
    const policy = createEnvelopeAdjudicationPolicy({
      permissions: buildProfile(["Bash(echo:*)"], []),
    });
    const adjudicate = createAdjudicationBus({ journal: store, policy });

    const decision = await adjudicate("Bash", { command: "rm -rf /" }, NO_OP_CONTEXT);
    expect(decision.behavior).toBe("deny");

    // The bus journals BEFORE returning (adjudication-bus.ts's own
    // `await options.journal.appendEntry(...)` precedes its `return
    // decision;`) — by the time `await adjudicate(...)` above resolves,
    // the entry already exists.
    const entries: unknown[] = [];
    for await (const entry of store.queryEntries({ type: "adjudication_decision" })) {
      entries.push(entry);
    }
    expect(entries).toHaveLength(1);
  });

  it("a policy that throws resolves to deny via the bus's own fail-closed wrapper (roadmap/06 §Security)", async () => {
    const throwingPolicy: AdjudicationPolicy = async () => {
      throw new Error("policy crashed");
    };
    const adjudicate = createAdjudicationBus({ journal: store, policy: throwingPolicy });
    const decision = await adjudicate("Bash", { command: "echo hi" }, NO_OP_CONTEXT);
    expect(decision.behavior).toBe("deny");
  });

  it("a policy that never resolves (hangs) times out and resolves to deny via the bus's own bounded timeout", async () => {
    const hangingPolicy: AdjudicationPolicy = () =>
      new Promise(() => {
        // never resolves — simulates a hung bridge
      });
    const adjudicate = createAdjudicationBus({
      journal: store,
      policy: hangingPolicy,
      timeoutMs: 30,
    });
    const decision = await adjudicate("Bash", { command: "echo hi" }, NO_OP_CONTEXT);
    expect(decision.behavior).toBe("deny");
  });

  it("a real allowed decision from this policy is journaled and returned as allow through the real bus", async () => {
    const policy = createEnvelopeAdjudicationPolicy({
      permissions: buildProfile(["Bash(echo:*)"], []),
    });
    const adjudicate = createAdjudicationBus({ journal: store, policy });
    const decision = await adjudicate("Bash", { command: "echo hi" }, NO_OP_CONTEXT);
    expect(decision.behavior).toBe("allow");

    const entries: unknown[] = [];
    for await (const entry of store.queryEntries({ type: "adjudication_decision" })) {
      entries.push(entry);
    }
    expect(entries).toHaveLength(1);
  });
});

/**
 * PROPERTY TEST: verdict agreement with `@eo/testkit`'s independent
 * `evaluatePermissionLayer` reference model. Deliberately EXCLUDES the
 * `//`-anchored (spawn-time-substituted) owned-path rule family — see this
 * file's "the anchor caveat" describe block above and
 * `adjudication-policy.ts`'s own top-of-file doc comment for why that
 * exclusion is expected and documented, not a gap. Every other rule family
 * this module supports is covered here.
 */
describe("property test — verdict agreement with @eo/testkit's permission-evaluator reference model", () => {
  const TOOL_NAMES = [
    "Agent",
    "Task",
    "WebFetch",
    "WebSearch",
    "CronCreate",
    "Skill",
    "Foo",
    "Bar",
  ] as const;

  it("bare tool-name rules (incl. Agent/Task aliasing) agree across allow/deny combinations", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom(...TOOL_NAMES),
        fc.constantFrom(...TOOL_NAMES),
        fc.boolean(),
        fc.boolean(),
        async (ruleName, toolName, inAllow, inDeny) => {
          const allow = inAllow ? [ruleName] : [];
          const deny = inDeny ? [ruleName] : [];
          const expected = evaluatePermissionLayer({ allow, deny }, { toolName, toolInput: {} });
          const policy = createEnvelopeAdjudicationPolicy({
            permissions: buildProfile(allow, deny),
          });
          const decision = await policy(toolName, {}, NO_OP_CONTEXT);
          expect(decision.behavior).toBe(expected);
        },
      ),
      { numRuns: 2000 },
    );
  });

  const BASH_PREFIXES = [
    "echo",
    "ls",
    "git status",
    "npm run test",
    "curl",
    "cat",
    "cargo check",
  ] as const;
  const WRAPPERS = ["", "nohup ", "nice ", "timeout 10 "] as const;
  const EXTRAS = ["", " extra", " --flag"] as const;
  const JOINS = [" && ", " || ", " ; ", " | "] as const;

  it("Bash prefix rules, incl. compound-command and process-wrapper smuggling, agree", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom(...BASH_PREFIXES),
        fc.constantFrom(...BASH_PREFIXES),
        fc.constantFrom(...WRAPPERS),
        fc.constantFrom(...EXTRAS),
        fc.boolean(),
        fc.constantFrom(...JOINS),
        fc.constantFrom(...BASH_PREFIXES),
        fc.boolean(),
        fc.boolean(),
        async (
          rulePrefix,
          cmdPrefix,
          wrapper,
          extra,
          compound,
          joinToken,
          secondPrefix,
          inAllow,
          inDeny,
        ) => {
          const rule = `Bash(${rulePrefix}:*)`;
          const command = compound
            ? `${wrapper}${cmdPrefix}${extra}${joinToken}${secondPrefix}`
            : `${wrapper}${cmdPrefix}${extra}`;
          const allow = inAllow ? [rule] : [];
          const deny = inDeny ? [rule] : [];
          const toolInput = { command };
          const expected = evaluatePermissionLayer(
            { allow, deny },
            { toolName: "Bash", toolInput },
          );
          const policy = createEnvelopeAdjudicationPolicy({
            permissions: buildProfile(allow, deny),
          });
          const decision = await policy("Bash", toolInput, NO_OP_CONTEXT);
          expect(decision.behavior).toBe(expected);
        },
      ),
      { numRuns: 3000 },
    );
  });

  const MCP_SERVERS = [GATEWAY_MCP_SERVER_NAME, "other_server", "srv1"] as const;
  const MCP_TOOLS = ["search", "plan_create", "result.submit"] as const;

  it("mcp__ wildcard rules (scoped and blanket) agree", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom(...MCP_SERVERS),
        fc.constantFrom(...MCP_SERVERS),
        fc.constantFrom(...MCP_TOOLS),
        fc.boolean(),
        fc.boolean(),
        fc.boolean(),
        async (ruleServer, callServer, callTool, inAllow, inDeny, useWildcard) => {
          const rule = useWildcard ? "mcp__*" : `mcp__${ruleServer}__*`;
          const toolName = `mcp__${callServer}__${callTool}`;
          const allow = inAllow ? [rule] : [];
          const deny = inDeny ? [rule] : [];
          const expected = evaluatePermissionLayer({ allow, deny }, { toolName, toolInput: {} });
          const policy = createEnvelopeAdjudicationPolicy({
            permissions: buildProfile(allow, deny),
          });
          const decision = await policy(toolName, {}, NO_OP_CONTEXT);
          expect(decision.behavior).toBe(expected);
        },
      ),
      { numRuns: 2000 },
    );
  });

  const PATH_SEGMENTS = ["packages", "foo", "bar", "src", ".ssh", ".aws", "config"] as const;
  const ANCHORS = ["~/", "/"] as const;
  const PATH_TOOLS = ["Edit", "Write", "Read"] as const;

  it("'~/' and bare '/' anchored path rules agree (the '//'-anchored substituted family is deliberately excluded — see this file's dedicated describe block above)", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom(...PATH_TOOLS),
        fc.constantFrom(...ANCHORS),
        fc.array(fc.constantFrom(...PATH_SEGMENTS), { minLength: 1, maxLength: 3 }),
        fc.constantFrom(...ANCHORS),
        fc.array(fc.constantFrom(...PATH_SEGMENTS), { minLength: 0, maxLength: 3 }),
        fc.boolean(),
        fc.boolean(),
        fc.boolean(),
        async (
          tool,
          ruleAnchor,
          ruleSegments,
          targetAnchor,
          extraSegments,
          contained,
          inAllow,
          inDeny,
        ) => {
          // DELIBERATE DIVERGENCE (Finding 3): `@eo/testkit`'s reference
          // oracle widens a '~/'-anchored rule against a bare-absolute target
          // SYMMETRICALLY (allow and deny alike); this policy widens DENY-only,
          // so a '~/'-anchored ALLOW rule vs an absolute target does NOT match
          // (no false-ALLOW). The two models therefore intentionally disagree
          // for that one family — excluded here (like the '//'-anchored family
          // above) and covered instead by the dedicated example tests that
          // assert both the deny-side widening and the allow-side non-match.
          fc.pre(!(ruleAnchor === "~/" && targetAnchor === "/" && inAllow && !inDeny));
          const rule = `${tool}(${ruleAnchor}${ruleSegments.join("/")}/**)`;
          const targetSegments = contained ? [...ruleSegments, ...extraSegments] : extraSegments;
          const targetPath = `${targetAnchor}${targetSegments.join("/")}`;
          const allow = inAllow ? [rule] : [];
          const deny = inDeny ? [rule] : [];
          const toolInput = { file_path: targetPath };
          const expected = evaluatePermissionLayer({ allow, deny }, { toolName: tool, toolInput });
          const policy = createEnvelopeAdjudicationPolicy({
            permissions: buildProfile(allow, deny),
          });
          const decision = await policy(tool, toolInput, NO_OP_CONTEXT);
          expect(decision.behavior).toBe(expected);
        },
      ),
      { numRuns: 3000 },
    );
  });
});
