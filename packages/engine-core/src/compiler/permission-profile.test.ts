import { describe, expect, it } from "vitest";
import { GATEWAY_MCP_SERVER_NAME } from "@eo/contracts";
import { emitPermissionProfile } from "./permission-profile.js";
import { buildEnvelopeFixture } from "./envelope-fixture.js";
import {
  CONTROL_REPO_STATE_ROOT_DENY_PATH,
  CONTROL_REPO_CACHE_ROOT_DENY_PATH,
  SSH_DENY_PATH,
  AWS_DENY_PATH,
} from "./xdg-default-paths.js";

/**
 * `emitPermissionProfile` tests (roadmap/03-envelope-compiler-engine-
 * adapter.md work item 2). Failing-first fixture: "asserting
 * `permissions.allow` contains only the four doc-confirmed `Bash(...)`
 * literals, the owned-path `Edit`/`Write` entries, and
 * `mcp__${GATEWAY_MCP_SERVER_NAME}__*`, with `defaultMode: "dontAsk"` and
 * `disableBypassPermissionsMode: "disable"`."
 */
describe("emitPermissionProfile — allow emission (roadmap/03 work item 2 failing-first fixture)", () => {
  it("a minimal envelope's allow list contains only the mandatory gateway allow entry", () => {
    const profile = emitPermissionProfile(buildEnvelopeFixture());
    expect(profile.allow).toEqual([`mcp__${GATEWAY_MCP_SERVER_NAME}__*`]);
  });

  it("defaultMode is dontAsk and disableBypassPermissionsMode is disable", () => {
    const profile = emitPermissionProfile(buildEnvelopeFixture());
    expect(profile.defaultMode).toBe("dontAsk");
    expect(profile.disableBypassPermissionsMode).toBe("disable");
  });

  it("ask is always empty (adaptation §4.1's compiled shape)", () => {
    expect(emitPermissionProfile(buildEnvelopeFixture()).ask).toEqual([]);
  });

  it("emits Edit/Write allow entries for each owned path, '//<worktree>'-anchored (CRITICAL 1 fix)", () => {
    const profile = emitPermissionProfile(
      buildEnvelopeFixture({ ownedPaths: ["packages/a/src", "packages/b/src"] }),
    );
    expect(profile.allow).toEqual(
      expect.arrayContaining([
        "Edit(//<worktree>/packages/a/src/**)",
        "Write(//<worktree>/packages/a/src/**)",
        "Edit(//<worktree>/packages/b/src/**)",
        "Write(//<worktree>/packages/b/src/**)",
      ]),
    );
  });

  it("emits exactly the four doc-confirmed Bash literals when all four are authorized, and no others", () => {
    const profile = emitPermissionProfile(
      buildEnvelopeFixture({
        commands: ["npm run test", "npm run build", "git status", "git diff"],
      }),
    );
    const bashRules = profile.allow.filter((r) => r.startsWith("Bash("));
    expect([...bashRules].sort()).toEqual(
      [
        "Bash(git diff:*)",
        "Bash(git status:*)",
        "Bash(npm run build:*)",
        "Bash(npm run test:*)",
      ].sort(),
    );
  });

  it("emits only the authorized subset when the envelope authorizes fewer than four", () => {
    const profile = emitPermissionProfile(buildEnvelopeFixture({ commands: ["git status"] }));
    expect(profile.allow.filter((r) => r.startsWith("Bash("))).toEqual(["Bash(git status:*)"]);
  });

  it("never emits a Bash rule for a command the envelope did not authorize", () => {
    const profile = emitPermissionProfile(buildEnvelopeFixture({ commands: ["npm run lint"] }));
    expect(profile.allow.filter((r) => r.startsWith("Bash("))).toEqual([]);
  });

  it("the allow list contains ONLY owned-path Edit/Write, the authorized Bash literals, and the gateway allow — nothing else (roadmap/03 work item 2 exit criterion)", () => {
    const profile = emitPermissionProfile(
      buildEnvelopeFixture({
        ownedPaths: ["packages/a/src"],
        commands: ["npm run test", "git status"],
      }),
    );
    expect([...profile.allow].sort()).toEqual(
      [
        "Edit(//<worktree>/packages/a/src/**)",
        "Write(//<worktree>/packages/a/src/**)",
        "Bash(npm run test:*)",
        "Bash(git status:*)",
        `mcp__${GATEWAY_MCP_SERVER_NAME}__*`,
      ].sort(),
    );
  });

  it("never allows Read/Grep/Glob unconditionally (see README.md's deviation-from-Appendix-B note)", () => {
    const profile = emitPermissionProfile(
      buildEnvelopeFixture({ ownedPaths: ["x"], commands: ["git status"] }),
    );
    expect(profile.allow).not.toContain("Read");
    expect(profile.allow).not.toContain("Grep");
    expect(profile.allow).not.toContain("Glob");
  });
});

describe("emitPermissionProfile — mandatory deny emission", () => {
  it("mandatory tool/command denies are always present, regardless of envelope content", () => {
    const profile = emitPermissionProfile(buildEnvelopeFixture());
    expect(profile.deny).toEqual(
      expect.arrayContaining([
        "Agent",
        "WebFetch",
        "WebSearch",
        "Bash(git push:*)",
        "Bash(curl:*)",
        "Bash(wget:*)",
      ]),
    );
  });

  it("mandatory path denies (control-repo state+cache root, ~/.ssh, ~/.aws) are always present", () => {
    const profile = emitPermissionProfile(buildEnvelopeFixture());
    expect(profile.deny).toEqual(
      expect.arrayContaining([
        `Read(${CONTROL_REPO_STATE_ROOT_DENY_PATH})`,
        `Read(${CONTROL_REPO_CACHE_ROOT_DENY_PATH})`,
        `Read(${SSH_DENY_PATH})`,
        `Read(${AWS_DENY_PATH})`,
      ]),
    );
  });

  it("never emits a blanket mcp__* deny (Appendix B's own footgun warning)", () => {
    expect(emitPermissionProfile(buildEnvelopeFixture()).deny).not.toContain("mcp__*");
  });

  it("mandatory denies are identical regardless of what the envelope authorizes", () => {
    const empty = emitPermissionProfile(buildEnvelopeFixture());
    const full = emitPermissionProfile(
      buildEnvelopeFixture({
        ownedPaths: ["packages/a/src"],
        commands: ["npm run test", "npm run build", "git status", "git diff"],
        networkDestinations: ["api.example.com"],
        credentialReferences: ["EO_TOKEN"],
      }),
    );
    expect([...empty.deny].sort()).toEqual([...full.deny].sort());
  });

  it("mandatory Edit/Write deny backstops exist for every sensitive path root (CRITICAL 1 fix, defect 2)", () => {
    const profile = emitPermissionProfile(buildEnvelopeFixture());
    expect(profile.deny).toEqual(
      expect.arrayContaining([
        `Edit(${CONTROL_REPO_STATE_ROOT_DENY_PATH})`,
        `Write(${CONTROL_REPO_STATE_ROOT_DENY_PATH})`,
        `Edit(${CONTROL_REPO_CACHE_ROOT_DENY_PATH})`,
        `Write(${CONTROL_REPO_CACHE_ROOT_DENY_PATH})`,
        `Edit(${SSH_DENY_PATH})`,
        `Write(${SSH_DENY_PATH})`,
        `Edit(${AWS_DENY_PATH})`,
        `Write(${AWS_DENY_PATH})`,
      ]),
    );
  });

  it("mandatory Edit/Write deny backstop protects the worktree's own .git internals (CRITICAL 1 fix, mirrors Appendix B's dropped Edit(//abs/path/worktree/.git/**) deny)", () => {
    const profile = emitPermissionProfile(buildEnvelopeFixture());
    expect(profile.deny).toEqual(
      expect.arrayContaining(["Edit(//<worktree>/.git/**)", "Write(//<worktree>/.git/**)"]),
    );
  });
});

describe("emitPermissionProfile — CRITICAL 1 regression: owned-path escape via unanchored '//' emission", () => {
  it("an owned path that looks like a system directory does not compile to a literal filesystem-root grant (validator's exact attack: ownedPaths ['etc/cron.d'])", () => {
    // `//` is the FILESYSTEM-ROOT anchor (adaptation §4.1: '//abs/path/**
    // (filesystem root)'), so a raw, unanchored `Edit(//etc/cron.d/**)` IS
    // `/etc/cron.d/**` — an absolute system grant from an innocuous-looking
    // relative owned path.
    const profile = emitPermissionProfile(buildEnvelopeFixture({ ownedPaths: ["etc/cron.d"] }));
    expect(profile.allow).not.toContain("Edit(//etc/cron.d/**)");
    expect(profile.allow).not.toContain("Write(//etc/cron.d/**)");
  });

  it("an absolute-spelled owned path is rejected outright, never silently compiled", () => {
    expect(() =>
      emitPermissionProfile(buildEnvelopeFixture({ ownedPaths: ["/etc/cron.d"] })),
    ).toThrow();
  });

  it("a home-anchored owned path ('~/.ssh') is rejected outright, never compiled into a plausible-looking allow rule", () => {
    expect(() => emitPermissionProfile(buildEnvelopeFixture({ ownedPaths: ["~/.ssh"] }))).toThrow();
  });

  it("owned-path allow rules always carry a worktree-anchor placeholder token phase 06 can substitute", () => {
    const profile = emitPermissionProfile(buildEnvelopeFixture({ ownedPaths: ["packages/a/src"] }));
    const pathRules = profile.allow.filter((r) => r.startsWith("Edit(") || r.startsWith("Write("));
    expect(pathRules.length).toBeGreaterThan(0);
    for (const rule of pathRules) {
      expect(rule).toMatch(/^(Edit|Write)\(\/\/<worktree>\//);
    }
  });
});

describe("emitPermissionProfile — immutability", () => {
  it("does not mutate its input envelope", () => {
    const envelope = buildEnvelopeFixture({
      ownedPaths: ["packages/a/src"],
      commands: ["git status"],
    });
    const snapshot = JSON.parse(JSON.stringify(envelope)) as unknown;
    emitPermissionProfile(envelope);
    expect(JSON.parse(JSON.stringify(envelope))).toEqual(snapshot);
  });
});
