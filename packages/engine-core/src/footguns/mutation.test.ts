import { describe, expect, it } from "vitest";
import { compileEnvelope } from "../compiler/compile-envelope.js";
import { buildEnvelopeFixture } from "../compiler/envelope-fixture.js";
import type { CompiledWorkerProfile } from "../compiler/compiled-worker-profile.js";
import {
  assertNoBlanketMcpDeny,
  assertMandatoryDenyReadPathsPresent,
  assertNoSpaceBeforeColonBashLiteral,
  assertAllOwnedPathAllowRulesAreWorktreeScoped,
  assertEditWriteDenyBackstopPresent,
  assertSandboxNeverAutoAllowsBash,
  assertSandboxDenyWritePathsPresent,
  assertNoFootguns,
  BlanketMcpDenyViolationError,
  MissingMandatoryDenyReadPathError,
  SpaceBeforeColonBashLiteralError,
  UnanchoredOwnedPathAllowError,
  MissingEditWriteDenyBackstopError,
  SandboxAutoAllowsBashError,
  MissingSandboxGitInternalsDenyWriteError,
} from "./invariants.js";

/**
 * Mutation suite (roadmap/03-envelope-compiler-engine-adapter.md work item
 * 4; §Test plan Security bullet: "mutation tests over deliberately broken
 * compiler variants — blanket `mcp__*` deny, dropped control-repo/`.ssh`/
 * `.aws` `denyRead`, space-before-colon `Bash` literal — each must be
 * caught by a failing test, not silently pass"). Each seeded variant
 * function below is exported from THIS TEST FILE ONLY (never from
 * `src/` production code) — it takes an already-correct
 * `CompiledWorkerProfile` (the real `compileEnvelope`'s own output) and
 * reintroduces exactly one seeded defect, proving `../footguns/
 * invariants.ts`'s corresponding assertion catches it. Full report:
 * docs/evidence/phase-03/wi4-mutation-report.txt.
 */

/** Seed 1: reintroduces the blanket `mcp__*` deny footgun. */
export function withBlanketMcpDenyBug(profile: CompiledWorkerProfile): CompiledWorkerProfile {
  return {
    ...profile,
    permissions: { ...profile.permissions, deny: [...profile.permissions.deny, "mcp__*"] },
  };
}

/** Seed 2: drops every mandatory sandbox denyRead path (control-repo state+cache root, ~/.ssh, ~/.aws). */
export function withDroppedMandatoryDenyReadPathsBug(
  profile: CompiledWorkerProfile,
): CompiledWorkerProfile {
  return {
    ...profile,
    sandbox: {
      ...profile.sandbox,
      filesystem: { ...profile.sandbox.filesystem, denyRead: [] },
    },
  };
}

/** Seed 3: reintroduces a space-before-colon Bash literal (interface-ledger Gap 12). */
export function withSpaceBeforeColonBashLiteralBug(
  profile: CompiledWorkerProfile,
): CompiledWorkerProfile {
  return {
    ...profile,
    permissions: {
      ...profile.permissions,
      allow: profile.permissions.allow.map((rule) =>
        rule === "Bash(git status:*)" ? "Bash(git status :*)" : rule,
      ),
    },
  };
}

/**
 * Seed 4 (phase-03 security-fix round, CRITICAL 1): reintroduces the
 * pre-fix compiler variant that skips owned-path validation and worktree
 * anchoring entirely — emits a raw, unanchored `Edit(//${path}/**)` allow
 * rule straight from a hostile path, exactly as the validator's original
 * finding reproduced (`ownedPaths:["etc/cron.d"]` -> `Edit(//etc/cron.d/**)`
 * -> `/etc/cron.d/**`, an absolute system grant).
 */
export function withRawUnanchoredOwnedPathBug(
  profile: CompiledWorkerProfile,
): CompiledWorkerProfile {
  return {
    ...profile,
    permissions: {
      ...profile.permissions,
      allow: [...profile.permissions.allow, "Edit(//etc/cron.d/**)", "Write(//etc/cron.d/**)"],
    },
  };
}

/**
 * Seed 5 (phase-03 security-fix round, CRITICAL 1): drops the Edit/Write
 * deny backstop entirely — the pre-fix compiler variant that had no
 * Edit/Write denies at all (only `Read(...)` denies for the sensitive
 * roots, and no `.git` backstop whatsoever).
 */
export function withDroppedEditWriteDenyBackstopBug(
  profile: CompiledWorkerProfile,
): CompiledWorkerProfile {
  return {
    ...profile,
    permissions: {
      ...profile.permissions,
      deny: profile.permissions.deny.filter(
        (rule) => !rule.startsWith("Edit(") && !rule.startsWith("Write("),
      ),
    },
  };
}

/**
 * Seed 6 (phase-06 sandbox-containment security-fix round): reintroduces the
 * pre-fix sandbox profile, which simply never set
 * `autoAllowBashIfSandboxed` at all. The SDK's own default for that key is
 * TRUE, so an ABSENT key is not a neutral state — it auto-allows `Bash`
 * whenever the sandbox is enabled and voids the compiled four-literal Bash
 * allowlist. Modelled here exactly as the defect appeared: the property
 * deleted, not set to `true`.
 */
export function withAbsentAutoAllowBashKeyBug(
  profile: CompiledWorkerProfile,
): CompiledWorkerProfile {
  const { autoAllowBashIfSandboxed: _dropped, ...sandboxWithoutKey } = profile.sandbox;
  return { ...profile, sandbox: sandboxWithoutKey as CompiledWorkerProfile["sandbox"] };
}

/** Seed 7 (same round): the same key present but flipped back to the unsafe SDK default. */
export function withAutoAllowBashEnabledBug(profile: CompiledWorkerProfile): CompiledWorkerProfile {
  return {
    ...profile,
    sandbox: {
      ...profile.sandbox,
      autoAllowBashIfSandboxed: true as unknown as false,
    },
  };
}

/**
 * Seed 8 (same round): drops the sandbox `denyWrite` carve-out, leaving
 * `filesystem.allowWrite`'s whole-worktree grant covering the worktree's own
 * git internals — i.e. `.git/hooks/*` and `.git/config` writable from a
 * sandboxed shell, which is HOST code execution outside the sandbox the next
 * time the supervisor runs git.
 */
export function withDroppedSandboxDenyWriteBug(
  profile: CompiledWorkerProfile,
): CompiledWorkerProfile {
  return {
    ...profile,
    sandbox: {
      ...profile.sandbox,
      filesystem: { ...profile.sandbox.filesystem, denyWrite: [] },
    },
  };
}

const envelope = buildEnvelopeFixture({
  ownedPaths: ["packages/a/src"],
  commands: ["git status", "git diff"],
});
const baseline = compileEnvelope(envelope);

describe("mutation suite — seed 1: blanket mcp__* deny", () => {
  it("the real compiler's own output never trips assertNoBlanketMcpDeny", () => {
    expect(() => assertNoBlanketMcpDeny(baseline)).not.toThrow();
  });

  it("the seeded variant IS caught", () => {
    expect(() => assertNoBlanketMcpDeny(withBlanketMcpDenyBug(baseline))).toThrow(
      BlanketMcpDenyViolationError,
    );
  });
});

describe("mutation suite — seed 2: dropped mandatory denyRead paths", () => {
  it("the real compiler's own output never trips assertMandatoryDenyReadPathsPresent", () => {
    expect(() => assertMandatoryDenyReadPathsPresent(baseline)).not.toThrow();
  });

  it("the seeded variant IS caught", () => {
    expect(() =>
      assertMandatoryDenyReadPathsPresent(withDroppedMandatoryDenyReadPathsBug(baseline)),
    ).toThrow(MissingMandatoryDenyReadPathError);
  });
});

describe("mutation suite — seed 3: space-before-colon Bash literal", () => {
  it("the real compiler's own output never trips assertNoSpaceBeforeColonBashLiteral", () => {
    expect(() => assertNoSpaceBeforeColonBashLiteral(baseline)).not.toThrow();
  });

  it("the seeded variant IS caught", () => {
    expect(() =>
      assertNoSpaceBeforeColonBashLiteral(withSpaceBeforeColonBashLiteralBug(baseline)),
    ).toThrow(SpaceBeforeColonBashLiteralError);
  });
});

describe("mutation suite — seed 4: raw unanchored owned-path allow rule (CRITICAL 1)", () => {
  it("the real compiler's own output never trips assertAllOwnedPathAllowRulesAreWorktreeScoped", () => {
    expect(() => assertAllOwnedPathAllowRulesAreWorktreeScoped(baseline)).not.toThrow();
  });

  it("the seeded variant IS caught", () => {
    expect(() =>
      assertAllOwnedPathAllowRulesAreWorktreeScoped(withRawUnanchoredOwnedPathBug(baseline)),
    ).toThrow(UnanchoredOwnedPathAllowError);
  });
});

describe("mutation suite — seed 5: dropped Edit/Write deny backstop (CRITICAL 1)", () => {
  it("the real compiler's own output never trips assertEditWriteDenyBackstopPresent", () => {
    expect(() => assertEditWriteDenyBackstopPresent(baseline)).not.toThrow();
  });

  it("the seeded variant IS caught", () => {
    expect(() =>
      assertEditWriteDenyBackstopPresent(withDroppedEditWriteDenyBackstopBug(baseline)),
    ).toThrow(MissingEditWriteDenyBackstopError);
  });
});

describe("mutation suite — seeds 6+7: sandbox auto-allows Bash (phase-06 containment fix)", () => {
  it("the real compiler's own output never trips assertSandboxNeverAutoAllowsBash", () => {
    expect(() => assertSandboxNeverAutoAllowsBash(baseline)).not.toThrow();
  });

  it("the ABSENT-key variant IS caught (the SDK default is true, so absence is not neutral)", () => {
    expect(() => assertSandboxNeverAutoAllowsBash(withAbsentAutoAllowBashKeyBug(baseline))).toThrow(
      SandboxAutoAllowsBashError,
    );
  });

  it("the explicitly-true variant IS caught", () => {
    expect(() => assertSandboxNeverAutoAllowsBash(withAutoAllowBashEnabledBug(baseline))).toThrow(
      SandboxAutoAllowsBashError,
    );
  });
});

describe("mutation suite — seed 8: dropped sandbox denyWrite carve-out (phase-06 containment fix)", () => {
  it("the real compiler's own output never trips assertSandboxDenyWritePathsPresent", () => {
    expect(() => assertSandboxDenyWritePathsPresent(baseline)).not.toThrow();
  });

  it("the seeded variant IS caught", () => {
    expect(() =>
      assertSandboxDenyWritePathsPresent(withDroppedSandboxDenyWriteBug(baseline)),
    ).toThrow(MissingSandboxGitInternalsDenyWriteError);
  });
});

describe("assertNoFootguns — runs every check together", () => {
  it("never throws against the real compiler's own output", () => {
    expect(() => assertNoFootguns(baseline)).not.toThrow();
  });

  it("catches each of the eight seeded variants in turn", () => {
    expect(() => assertNoFootguns(withAbsentAutoAllowBashKeyBug(baseline))).toThrow(
      SandboxAutoAllowsBashError,
    );
    expect(() => assertNoFootguns(withAutoAllowBashEnabledBug(baseline))).toThrow(
      SandboxAutoAllowsBashError,
    );
    expect(() => assertNoFootguns(withDroppedSandboxDenyWriteBug(baseline))).toThrow(
      MissingSandboxGitInternalsDenyWriteError,
    );
    expect(() => assertNoFootguns(withBlanketMcpDenyBug(baseline))).toThrow(
      BlanketMcpDenyViolationError,
    );
    expect(() => assertNoFootguns(withDroppedMandatoryDenyReadPathsBug(baseline))).toThrow(
      MissingMandatoryDenyReadPathError,
    );
    expect(() => assertNoFootguns(withSpaceBeforeColonBashLiteralBug(baseline))).toThrow(
      SpaceBeforeColonBashLiteralError,
    );
    expect(() => assertNoFootguns(withRawUnanchoredOwnedPathBug(baseline))).toThrow(
      UnanchoredOwnedPathAllowError,
    );
    expect(() => assertNoFootguns(withDroppedEditWriteDenyBackstopBug(baseline))).toThrow(
      MissingEditWriteDenyBackstopError,
    );
  });
});
