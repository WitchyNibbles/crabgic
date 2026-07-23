/// <reference types="node" />
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { GATEWAY_MCP_SERVER_NAME } from "@eo/contracts";
import {
  CANONICAL_ENVELOPE_CASES,
  compileEnvelope,
  BlanketMcpDenyViolationError,
  type CompiledWorkerProfile,
} from "@eo/engine-core";
import { buildWorkerEnv } from "./auth.js";
import {
  PlaceholderSubstitutionError,
  assembleWorkerOptions,
  substituteWorktreePlaceholders,
  type AssembleWorkerOptionsInput,
} from "./options-assembler.js";

/**
 * `options-assembler` (roadmap/06-claude-engine-adapter.md §In scope work
 * item 1, §Test plan "worker-profile assembler"; README design decisions
 * 5/6/9). Pure: no fs/process.env reads inside the module under test —
 * this test file itself may (and does) read fixture files from disk, that
 * is a test-harness concern, not the module's.
 */

const STANDARD_IMPLEMENTATION_CASE = CANONICAL_ENVELOPE_CASES.find(
  (envelopeCase) => envelopeCase.name === "standard-implementation",
);
if (STANDARD_IMPLEMENTATION_CASE === undefined) {
  throw new Error(
    "standard-implementation canonical envelope case not found in CANONICAL_ENVELOPE_CASES",
  );
}
const FIXTURE_PROFILE = compileEnvelope(STANDARD_IMPLEMENTATION_CASE.envelope);

describe("substituteWorktreePlaceholders", () => {
  it("leaves no <worktree>/<worker-tmp> placeholder substrings anywhere in the returned profile", () => {
    const result = substituteWorktreePlaceholders(
      FIXTURE_PROFILE,
      "/fixture/worktree",
      "/fixture/worker-tmp",
    );
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("<worktree>");
    expect(serialized).not.toContain("<worker-tmp>");
  });

  it("substitutes the sandbox filesystem allowWrite placeholders with the real absolute paths", () => {
    const result = substituteWorktreePlaceholders(
      FIXTURE_PROFILE,
      "/fixture/worktree",
      "/fixture/worker-tmp",
    );
    expect(result.sandbox.filesystem.allowWrite).toEqual([
      "/fixture/worktree",
      "/fixture/worker-tmp",
    ]);
  });

  it("substitutes the placeholder embedded inside owned-path Edit/Write allow rules", () => {
    const result = substituteWorktreePlaceholders(
      FIXTURE_PROFILE,
      "/fixture/worktree",
      "/fixture/worker-tmp",
    );
    const ownedPathRule = result.permissions.allow.find((rule) => rule.startsWith("Edit("));
    expect(ownedPathRule).toBeDefined();
    expect(ownedPathRule).toContain("/fixture/worktree");
  });

  it("does not mutate the input profile (immutability)", () => {
    const before = JSON.stringify(FIXTURE_PROFILE);
    substituteWorktreePlaceholders(FIXTURE_PROFILE, "/fixture/worktree", "/fixture/worker-tmp");
    expect(JSON.stringify(FIXTURE_PROFILE)).toBe(before);
  });

  it("keeps sdkOptions.allowedTools/disallowedTools consistent with the substituted permissions (one compiled decision)", () => {
    const result = substituteWorktreePlaceholders(
      FIXTURE_PROFILE,
      "/fixture/worktree",
      "/fixture/worker-tmp",
    );
    expect(result.sdkOptions.allowedTools).toEqual(result.permissions.allow);
    expect(result.sdkOptions.disallowedTools).toEqual(result.permissions.deny);
  });

  it("calls engine-core's assertNoFootguns on the PRE-substitution (placeholder-form) profile", () => {
    const brokenProfile: CompiledWorkerProfile = {
      ...FIXTURE_PROFILE,
      permissions: { ...FIXTURE_PROFILE.permissions, deny: ["mcp__*"] },
    };
    expect(() =>
      substituteWorktreePlaceholders(brokenProfile, "/fixture/worktree", "/fixture/worker-tmp"),
    ).toThrow(BlanketMcpDenyViolationError);
  });

  it("rejects a relative worktreePath", () => {
    expect(() =>
      substituteWorktreePlaceholders(FIXTURE_PROFILE, "fixture/worktree", "/fixture/worker-tmp"),
    ).toThrow(PlaceholderSubstitutionError);
  });

  it("rejects a worktreePath containing '..'", () => {
    expect(() =>
      substituteWorktreePlaceholders(FIXTURE_PROFILE, "/fixture/../etc", "/fixture/worker-tmp"),
    ).toThrow(PlaceholderSubstitutionError);
  });

  it("rejects a worktreePath containing '~' (even when otherwise absolute)", () => {
    expect(() =>
      substituteWorktreePlaceholders(FIXTURE_PROFILE, "/fixture/~worktree", "/fixture/worker-tmp"),
    ).toThrow(PlaceholderSubstitutionError);
  });

  it("rejects a worktreePath containing glob metacharacters", () => {
    expect(() =>
      substituteWorktreePlaceholders(FIXTURE_PROFILE, "/fixture/*", "/fixture/worker-tmp"),
    ).toThrow(PlaceholderSubstitutionError);
  });

  it("rejects a relative workerTmp", () => {
    expect(() =>
      substituteWorktreePlaceholders(FIXTURE_PROFILE, "/fixture/worktree", "worker-tmp"),
    ).toThrow(PlaceholderSubstitutionError);
  });

  it("rejects a worktreePath bearing an injected placeholder token '<worker-tmp>' (Finding 4: scope-corruption / sequential-substitution defense)", () => {
    // A '/valid/<worker-tmp>/wt' worktreePath, injected into the profile as
    // the '<worktree>' replacement, would otherwise have its embedded
    // '<worker-tmp>' token expanded by a later substitution pass.
    expect(() =>
      substituteWorktreePlaceholders(
        FIXTURE_PROFILE,
        "/valid/<worker-tmp>/wt",
        "/fixture/worker-tmp",
      ),
    ).toThrow(PlaceholderSubstitutionError);
  });

  it("rejects a workerTmp containing '<' or '>' metacharacters (Finding 4)", () => {
    expect(() =>
      substituteWorktreePlaceholders(FIXTURE_PROFILE, "/fixture/worktree", "/tmp/<worktree>"),
    ).toThrow(PlaceholderSubstitutionError);
  });

  it("rejects the filesystem-root worktreePath '/' (Finding 4: root-write / minimum-depth defense)", () => {
    expect(() =>
      substituteWorktreePlaceholders(FIXTURE_PROFILE, "/", "/fixture/worker-tmp"),
    ).toThrow(PlaceholderSubstitutionError);
  });

  it("rejects a single-segment worktreePath '/x' (minimum depth is >= 2 non-empty segments — Finding 4)", () => {
    expect(() =>
      substituteWorktreePlaceholders(FIXTURE_PROFILE, "/x", "/fixture/worker-tmp"),
    ).toThrow(PlaceholderSubstitutionError);
  });

  it("rejects a single-segment workerTmp '/tmp' (minimum depth is >= 2 non-empty segments — Finding 4)", () => {
    expect(() =>
      substituteWorktreePlaceholders(FIXTURE_PROFILE, "/fixture/worktree", "/tmp"),
    ).toThrow(PlaceholderSubstitutionError);
  });

  it("Finding 4 anchor regression: valid inputs still produce the exact '///'-anchored owned-path rule (single simultaneous pass, byte-identical)", () => {
    const result = substituteWorktreePlaceholders(
      FIXTURE_PROFILE,
      "/fixture/worktree",
      "/fixture/worker-tmp",
    );
    const ownedPathRule = result.permissions.allow.find((rule) => rule.startsWith("Edit("));
    // The '//<worktree>/...' template + absolute '/fixture/worktree' yields the
    // documented triple-slash anchor form — unchanged by the single-pass fix.
    expect(ownedPathRule).toContain("(///fixture/worktree/");
  });
});

function fixedInput(overrides?: Partial<AssembleWorkerOptionsInput>): AssembleWorkerOptionsInput {
  return {
    profile: FIXTURE_PROFILE,
    worktreePath: "/fixture/worktree",
    workerTmp: "/fixture/worker-tmp",
    env: buildWorkerEnv({
      hostPath: "/usr/bin:/bin",
      provisioning: {
        HOME: "/fixture/home",
        TMP: "/fixture/tmp",
        CLAUDE_CONFIG_DIR: "/fixture/claude-config",
      },
      authEnv: { CLAUDE_CODE_OAUTH_TOKEN: "token-fixture-value" },
    }),
    session: { mode: "assign", sessionId: "00000000-0000-4000-8000-000000000000" },
    rolePreamble: "fixture role preamble",
    maxTurns: 8,
    resultSchema: { type: "object" },
    ...overrides,
  };
}

describe("assembleWorkerOptions", () => {
  it("sets cwd to worktreePath", () => {
    const options = assembleWorkerOptions(fixedInput());
    expect(options.cwd).toBe("/fixture/worktree");
  });

  it("sets env to exactly the passed-in buildWorkerEnv output", () => {
    const input = fixedInput();
    const options = assembleWorkerOptions(input);
    expect(options.env).toEqual(input.env);
  });

  it("sets sessionId (never resume) for an 'assign' session spec", () => {
    const options = assembleWorkerOptions(fixedInput());
    expect(options.sessionId).toBe("00000000-0000-4000-8000-000000000000");
    expect(options.resume).toBeUndefined();
  });

  it("sets resume (+ forkSession) and never sessionId for a 'resume' session spec", () => {
    const options = assembleWorkerOptions(
      fixedInput({
        session: {
          mode: "resume",
          sessionRef: "11111111-1111-4111-8111-111111111111",
          forkSession: true,
        },
      }),
    );
    expect(options.resume).toBe("11111111-1111-4111-8111-111111111111");
    expect(options.forkSession).toBe(true);
    expect(options.sessionId).toBeUndefined();
  });

  it("omits forkSession for a 'resume' session spec that doesn't request a fork", () => {
    const options = assembleWorkerOptions(
      fixedInput({
        session: { mode: "resume", sessionRef: "11111111-1111-4111-8111-111111111111" },
      }),
    );
    expect(options.resume).toBe("11111111-1111-4111-8111-111111111111");
    expect("forkSession" in options).toBe(false);
  });

  it("always passes settingSources: [] explicitly (§10 risk 3)", () => {
    const options = assembleWorkerOptions(fixedInput());
    expect(options.settingSources).toEqual([]);
  });

  it("always sets permissionMode to 'dontAsk'", () => {
    const options = assembleWorkerOptions(fixedInput());
    expect(options.permissionMode).toBe("dontAsk");
  });

  it("derives allowedTools/disallowedTools from the substituted profile.sdkOptions", () => {
    const options = assembleWorkerOptions(fixedInput());
    const substituted = substituteWorktreePlaceholders(
      FIXTURE_PROFILE,
      "/fixture/worktree",
      "/fixture/worker-tmp",
    );
    expect(options.allowedTools).toEqual(substituted.sdkOptions.allowedTools);
    expect(options.disallowedTools).toEqual(substituted.sdkOptions.disallowedTools);
  });

  it("always sets strictMcpConfig to true", () => {
    const options = assembleWorkerOptions(fixedInput());
    expect(options.strictMcpConfig).toBe(true);
  });

  it("keys mcpServers by GATEWAY_MCP_SERVER_NAME with the default external stdio process", () => {
    const options = assembleWorkerOptions(fixedInput());
    expect(options.mcpServers).toEqual({
      [GATEWAY_MCP_SERVER_NAME]: {
        type: "stdio",
        command: "engineering-orchestrator",
        args: ["gateway", "mcp"],
      },
    });
  });

  it("honors a gatewayServerOverride, replacing only the entry value", () => {
    const override = { type: "stdio", command: "stub", args: [] } as const;
    const options = assembleWorkerOptions(fixedInput({ gatewayServerOverride: override }));
    expect(options.mcpServers).toEqual({ [GATEWAY_MCP_SERVER_NAME]: override });
  });

  it("passes a fully-substituted WorkerSettingsJson as `settings`", () => {
    const options = assembleWorkerOptions(fixedInput());
    expect(JSON.stringify(options.settings)).not.toContain("<worktree>");
    expect(JSON.stringify(options.settings)).not.toContain("<worker-tmp>");
  });

  it("passes a fully-substituted sandbox settings object, allowAllUnixSockets as boolean (baseline §6)", () => {
    const options = assembleWorkerOptions(fixedInput());
    expect(options.sandbox?.network?.allowAllUnixSockets).toBe(true);
    expect(options.sandbox?.filesystem?.allowWrite).toEqual([
      "/fixture/worktree",
      "/fixture/worker-tmp",
    ]);
  });

  it("sets systemPrompt to the claude_code preset with the role preamble appended", () => {
    const options = assembleWorkerOptions(fixedInput());
    expect(options.systemPrompt).toEqual({
      type: "preset",
      preset: "claude_code",
      append: "fixture role preamble",
    });
  });

  it("omits `append` when no rolePreamble is supplied", () => {
    const { rolePreamble: _rolePreamble, ...rest } = fixedInput();
    const options = assembleWorkerOptions(rest);
    expect(options.systemPrompt).toEqual({ type: "preset", preset: "claude_code" });
  });

  it("resolves model to the balanced default when omitted", () => {
    const options = assembleWorkerOptions(fixedInput());
    expect(options.model).toBe("sonnet");
  });

  it("passes through an explicit model override", () => {
    const options = assembleWorkerOptions(fixedInput({ model: "opus" }));
    expect(options.model).toBe("opus");
  });

  it("passes maxTurns through verbatim", () => {
    const options = assembleWorkerOptions(fixedInput());
    expect(options.maxTurns).toBe(8);
  });

  it("sets outputFormat to json_schema with the packet's resultSchema", () => {
    const options = assembleWorkerOptions(fixedInput());
    expect(options.outputFormat).toEqual({ type: "json_schema", schema: { type: "object" } });
  });

  it("always sets includePartialMessages to true", () => {
    const options = assembleWorkerOptions(fixedInput());
    expect(options.includePartialMessages).toBe(true);
  });

  it("omits optional adapter passthroughs (canUseTool/hooks/abortController/pathToClaudeCodeExecutable) when not supplied", () => {
    const options = assembleWorkerOptions(fixedInput());
    expect("canUseTool" in options).toBe(false);
    expect("hooks" in options).toBe(false);
    expect("abortController" in options).toBe(false);
    expect("pathToClaudeCodeExecutable" in options).toBe(false);
  });

  it("includes optional adapter passthroughs verbatim when supplied", () => {
    const canUseTool: AssembleWorkerOptionsInput["canUseTool"] = async (_name, _input) => ({
      behavior: "allow",
      updatedInput: {},
    });
    const hooks: AssembleWorkerOptionsInput["hooks"] = { PreToolUse: [] };
    const abortController = new AbortController();
    const options = assembleWorkerOptions(
      fixedInput({
        canUseTool,
        hooks,
        abortController,
        pathToClaudeCodeExecutable: "/fixture/bin/claude",
      }),
    );
    expect(options.canUseTool).toBe(canUseTool);
    expect(options.hooks).toBe(hooks);
    expect(options.abortController).toBe(abortController);
    expect(options.pathToClaudeCodeExecutable).toBe("/fixture/bin/claude");
  });
});

/**
 * GOLDEN TEST (roadmap/06 work item 1: "assemble options for each of 03's
 * three golden canonical envelopes and diff against a golden SDK-call
 * fixture that does not exist yet"). Deterministic JSON projection:
 * functions/AbortController instances excluded, keys recursively sorted,
 * 2-space indent, trailing newline — mirrors
 * `packages/engine-core/src/goldens/generate-golden-artifacts.ts`'s own
 * `JSON.stringify(value, null, 2)` + trailing-newline convention, widened
 * with key-sorting because `Options`' field-construction order (this
 * module's own object literal) is not itself the fixture's source of
 * truth the way engine-core's fixed schema-field order is.
 */
function canonicalizeForGolden(value: unknown): unknown {
  if (typeof value === "function" || value instanceof AbortController) {
    return undefined;
  }
  if (Array.isArray(value)) {
    return value.map((item) => canonicalizeForGolden(item));
  }
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const sortedKeys = Object.keys(record).sort();
    const result: Record<string, unknown> = {};
    for (const key of sortedKeys) {
      const child = record[key];
      if (typeof child === "function" || child instanceof AbortController) continue;
      result[key] = canonicalizeForGolden(child);
    }
    return result;
  }
  return value;
}

function serializeGolden(value: unknown): string {
  return `${JSON.stringify(canonicalizeForGolden(value), null, 2)}\n`;
}

const GOLDENS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "goldens");

const GOLDEN_FIXED_INPUT: Omit<AssembleWorkerOptionsInput, "profile"> = {
  worktreePath: "/fixture/worktree",
  workerTmp: "/fixture/worker-tmp",
  env: buildWorkerEnv({
    hostPath: "/usr/bin:/bin",
    provisioning: {
      HOME: "/fixture/home",
      TMP: "/fixture/tmp",
      CLAUDE_CONFIG_DIR: "/fixture/claude-config",
    },
    authEnv: { CLAUDE_CODE_OAUTH_TOKEN: "token-fixture-value" },
  }),
  session: { mode: "assign", sessionId: "00000000-0000-4000-8000-000000000000" },
  rolePreamble: "fixture role preamble",
  maxTurns: 8,
  resultSchema: { type: "object" },
};

describe("golden SDK-call fixtures — byte-stability against committed goldens", () => {
  for (const { name, envelope } of CANONICAL_ENVELOPE_CASES) {
    it(`${name}.sdk-call.json is byte-identical to the committed golden`, () => {
      const profile = compileEnvelope(envelope);
      const options = assembleWorkerOptions({ ...GOLDEN_FIXED_INPUT, profile });
      const content = serializeGolden(options);
      const committed = readFileSync(join(GOLDENS_DIR, `${name}.sdk-call.json`), "utf8");
      expect(content).toBe(committed);
    });
  }

  it("produces byte-identical output across two consecutive in-memory generations", () => {
    for (const { envelope } of CANONICAL_ENVELOPE_CASES) {
      const profile = compileEnvelope(envelope);
      const first = serializeGolden(assembleWorkerOptions({ ...GOLDEN_FIXED_INPUT, profile }));
      const second = serializeGolden(assembleWorkerOptions({ ...GOLDEN_FIXED_INPUT, profile }));
      expect(second).toBe(first);
    }
  });
});
