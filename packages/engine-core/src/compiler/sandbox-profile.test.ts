import { describe, expect, it } from "vitest";
import {
  emitSandboxProfile,
  WORKTREE_WRITE_PLACEHOLDER,
  WORKER_TMP_WRITE_PLACEHOLDER,
} from "./sandbox-profile.js";
import { buildEnvelopeFixture } from "./envelope-fixture.js";
import { EnvelopePolicySchema, type EnvelopePolicy } from "@crabgic/contracts";
import {
  CONTROL_REPO_STATE_ROOT_DENY_PATH,
  CONTROL_REPO_CACHE_ROOT_DENY_PATH,
  SSH_DENY_PATH,
  AWS_DENY_PATH,
} from "./xdg-default-paths.js";

/**
 * `emitSandboxProfile` tests (roadmap/03-envelope-compiler-engine-
 * adapter.md work item 3). Failing-first fixture: "asserting the sandbox
 * block's `denyRead` includes control-repo, journal, `~/.ssh`, `~/.aws`,
 * and `failIfUnavailable: true`."
 */
describe("emitSandboxProfile — mandatory denyRead (roadmap/03 work item 3 failing-first fixture)", () => {
  it("denyRead includes control-repo state+cache root, ~/.ssh, ~/.aws", () => {
    const profile = emitSandboxProfile(buildEnvelopeFixture());
    expect(profile.filesystem.denyRead).toEqual(
      expect.arrayContaining([
        CONTROL_REPO_STATE_ROOT_DENY_PATH,
        CONTROL_REPO_CACHE_ROOT_DENY_PATH,
        SSH_DENY_PATH,
        AWS_DENY_PATH,
      ]),
    );
  });

  it("failIfUnavailable is always true", () => {
    expect(emitSandboxProfile(buildEnvelopeFixture()).failIfUnavailable).toBe(true);
  });

  it("denyRead is identical regardless of what the envelope authorizes", () => {
    const empty = emitSandboxProfile(buildEnvelopeFixture());
    const full = emitSandboxProfile(
      buildEnvelopeFixture({
        ownedPaths: ["packages/a/src"],
        networkDestinations: ["api.example.com"],
      }),
    );
    expect([...empty.filesystem.denyRead].sort()).toEqual([...full.filesystem.denyRead].sort());
  });
});

describe("emitSandboxProfile — fixed sandbox posture", () => {
  it("enabled is always true and allowUnsandboxedCommands is always false", () => {
    const profile = emitSandboxProfile(buildEnvelopeFixture());
    expect(profile.enabled).toBe(true);
    expect(profile.allowUnsandboxedCommands).toBe(false);
  });

  it("autoAllowBashIfSandboxed is always false — the SDK default is TRUE and would void the Bash allowlist (live finding, see sandbox-profile.ts)", () => {
    expect(emitSandboxProfile(buildEnvelopeFixture()).autoAllowBashIfSandboxed).toBe(false);
  });

  it("autoAllowBashIfSandboxed is false regardless of what the envelope authorizes", () => {
    expect(
      emitSandboxProfile(
        buildEnvelopeFixture({
          ownedPaths: ["packages/a/src"],
          commands: ["npm run test", "git status"],
          networkDestinations: ["api.example.com"],
          credentialReferences: ["CRABGIC_TOKEN_A"],
        }),
      ).autoAllowBashIfSandboxed,
    ).toBe(false);
  });

  it("network.allowAllUnixSockets is always true — the Linux/WSL2 UDS gate (docs/engine-baseline.md §6)", () => {
    expect(emitSandboxProfile(buildEnvelopeFixture()).network.allowAllUnixSockets).toBe(true);
  });

  it("never carries an allowUnixSockets field (macOS-only path allowlist, ignored on Linux — docs/engine-baseline.md §6)", () => {
    const profile = emitSandboxProfile(buildEnvelopeFixture());
    expect("allowUnixSockets" in profile.network).toBe(false);
  });

  it("network.allowLocalBinding is always false", () => {
    expect(emitSandboxProfile(buildEnvelopeFixture()).network.allowLocalBinding).toBe(false);
  });

  it("filesystem.allowWrite carries the worktree+tmp placeholder tokens (see README.md's placeholder-token convention)", () => {
    const profile = emitSandboxProfile(buildEnvelopeFixture());
    expect(profile.filesystem.allowWrite).toEqual([
      WORKTREE_WRITE_PLACEHOLDER,
      WORKER_TMP_WRITE_PLACEHOLDER,
    ]);
  });

  it("filesystem.denyWrite carves the worktree's own git internals back OUT of the whole-worktree allowWrite grant", () => {
    const profile = emitSandboxProfile(buildEnvelopeFixture());
    expect(profile.filesystem.denyWrite).toEqual(
      expect.arrayContaining([
        `${WORKTREE_WRITE_PLACEHOLDER}/.git`,
        `${WORKTREE_WRITE_PLACEHOLDER}/.git/**`,
      ]),
    );
  });

  it("filesystem.denyWrite mirrors every mandatory denyRead root, so an Edit allow rule can never merge write access into one", () => {
    const profile = emitSandboxProfile(buildEnvelopeFixture());
    expect(profile.filesystem.denyWrite).toEqual(
      expect.arrayContaining([
        CONTROL_REPO_STATE_ROOT_DENY_PATH,
        CONTROL_REPO_CACHE_ROOT_DENY_PATH,
        SSH_DENY_PATH,
        AWS_DENY_PATH,
      ]),
    );
  });

  it("filesystem.denyWrite is identical regardless of what the envelope authorizes", () => {
    const empty = emitSandboxProfile(buildEnvelopeFixture());
    const full = emitSandboxProfile(
      buildEnvelopeFixture({
        ownedPaths: ["packages/a/src"],
        commands: ["npm run build"],
        networkDestinations: ["api.example.com"],
      }),
    );
    expect([...empty.filesystem.denyWrite].sort()).toEqual([...full.filesystem.denyWrite].sort());
  });

  it("filesystem.allowWrite still grants the WHOLE worktree — narrowing it to owned paths would break every allowlisted command (see sandbox-profile.ts's justification)", () => {
    const profile = emitSandboxProfile(buildEnvelopeFixture({ ownedPaths: ["packages/a/src"] }));
    expect(profile.filesystem.allowWrite).toContain(WORKTREE_WRITE_PLACEHOLDER);
    expect(profile.filesystem.allowWrite).not.toContain(
      `${WORKTREE_WRITE_PLACEHOLDER}/packages/a/src`,
    );
  });
});

describe("emitSandboxProfile — envelope-driven fields", () => {
  it("network.allowedDomains comes only from envelope.networkDestinations", () => {
    const profile = emitSandboxProfile(
      buildEnvelopeFixture({ networkDestinations: ["api.example.com", "auth.example.com"] }),
    );
    expect(profile.network.allowedDomains).toEqual(["api.example.com", "auth.example.com"]);
  });

  it("network.allowedDomains is empty when the envelope grants no network destinations", () => {
    expect(emitSandboxProfile(buildEnvelopeFixture()).network.allowedDomains).toEqual([]);
  });

  it("credentials.envVars masks each credentialReference", () => {
    const profile = emitSandboxProfile(
      buildEnvelopeFixture({ credentialReferences: ["CRABGIC_TOKEN_A", "CRABGIC_TOKEN_B"] }),
    );
    expect(profile.credentials.envVars).toEqual([
      { name: "CRABGIC_TOKEN_A", mode: "mask" },
      { name: "CRABGIC_TOKEN_B", mode: "mask" },
    ]);
  });

  it("credentials.envVars is empty when the envelope references no credentials", () => {
    expect(emitSandboxProfile(buildEnvelopeFixture()).credentials.envVars).toEqual([]);
  });
});

describe("emitSandboxProfile — MINOR 4 regression: networkDestinations validation", () => {
  it.each(["*", "**"])("rejects the wildcard destination %s", (destination) => {
    expect(() =>
      emitSandboxProfile(buildEnvelopeFixture({ networkDestinations: [destination] })),
    ).toThrow();
  });

  it("rejects a destination carrying a URI scheme (validator's exact attack: 'http://evil')", () => {
    expect(() =>
      emitSandboxProfile(buildEnvelopeFixture({ networkDestinations: ["http://evil"] })),
    ).toThrow();
  });

  it("rejects a destination carrying a path/CIDR suffix (validator's exact attack: '0.0.0.0/0')", () => {
    expect(() =>
      emitSandboxProfile(buildEnvelopeFixture({ networkDestinations: ["0.0.0.0/0"] })),
    ).toThrow();
  });

  it("rejects a destination carrying a port (validator's exact attack: 'evil.com:443')", () => {
    expect(() =>
      emitSandboxProfile(buildEnvelopeFixture({ networkDestinations: ["evil.com:443"] })),
    ).toThrow();
  });

  it.each(["api.example.com", "example.com", "sub.domain.example.co.uk"])(
    "a concrete bare domain %s passes validation unchanged",
    (domain) => {
      expect(
        emitSandboxProfile(buildEnvelopeFixture({ networkDestinations: [domain] })).network
          .allowedDomains,
      ).toEqual([domain]);
    },
  );
});

describe("emitSandboxProfile — immutability", () => {
  it("does not mutate its input envelope", () => {
    const envelope = buildEnvelopeFixture({ networkDestinations: ["api.example.com"] });
    const snapshot = JSON.parse(JSON.stringify(envelope)) as unknown;
    emitSandboxProfile(envelope);
    expect(JSON.parse(JSON.stringify(envelope))).toEqual(snapshot);
  });
});

/**
 * Ledger Gap 18 part 5 — the policy as a COMPILER INPUT.
 *
 * Round 1's F1 is the reason this parameter exists. `allowWrite` is the whole
 * worktree by deliberate design, because the compiler's only inputs are one
 * envelope's four fields and build-output directories are "project-specific
 * and unknowable here". Owned-path scoping is left to the permission layer,
 * which sees TOOL CALLS and cannot see the syscalls of a process it spawned —
 * so an allow-listed `npm run test` running a test file the worker
 * legitimately wrote inside its owned path reaches the entire worktree. Under
 * a human gate that is bounded by someone reading the diff. Under a standing
 * approval it is not.
 *
 * What is unknowable to the compiler IS knowable to a human authoring a
 * policy once. These tests pin that narrowing.
 */
describe("emitSandboxProfile — narrowed by an EnvelopePolicy", () => {
  function policy(overrides: Partial<EnvelopePolicy> = {}): EnvelopePolicy {
    return EnvelopePolicySchema.parse({
      schemaVersion: 1,
      id: "11111111-1111-4111-8111-111111111111",
      createdAt: "2026-01-01T00:00:00.000Z",
      allowedPathPrefixes: ["src"],
      ...overrides,
    });
  }

  it("narrows allowWrite from the whole worktree to owned paths plus declared scratch", () => {
    const profile = emitSandboxProfile(
      buildEnvelopeFixture({ ownedPaths: ["src/login"] }),
      policy({ allowedWriteScratchPaths: ["dist", "coverage"] }),
    );

    expect(profile.filesystem.allowWrite).toEqual([
      `${WORKTREE_WRITE_PLACEHOLDER}/src/login`,
      `${WORKTREE_WRITE_PLACEHOLDER}/dist`,
      `${WORKTREE_WRITE_PLACEHOLDER}/coverage`,
      WORKER_TMP_WRITE_PLACEHOLDER,
    ]);
  });

  /** The bare worktree root must NOT survive the narrowing — that is the whole point. */
  it("no longer grants the worktree root itself", () => {
    const profile = emitSandboxProfile(
      buildEnvelopeFixture({ ownedPaths: ["src/login"] }),
      policy({ allowedWriteScratchPaths: ["dist"] }),
    );

    expect(profile.filesystem.allowWrite).not.toContain(WORKTREE_WRITE_PLACEHOLDER);
  });

  /**
   * The worker tmp dir stays unconditionally. It is outside the worktree, is
   * provisioned 0700 per worker, and is where the engine itself writes; taking
   * it away narrows nothing an attacker cares about and breaks the runtime.
   */
  it("keeps the worker tmp dir regardless of the policy", () => {
    const profile = emitSandboxProfile(buildEnvelopeFixture({ ownedPaths: [] }), policy());
    expect(profile.filesystem.allowWrite).toEqual([WORKER_TMP_WRITE_PLACEHOLDER]);
  });

  /**
   * Round 1's F4: `allowAllUnixSockets: true` was unconditional, so
   * `allowedNetworkDestinations: []` did not mean "no network" — a reachable
   * docker socket is host-root write, and SSH_AUTH_SOCK is not covered by the
   * `~/.ssh` read deny. Under a policy it becomes a declared grant.
   */
  it("closes unix sockets unless the policy declares them", () => {
    expect(emitSandboxProfile(buildEnvelopeFixture({}), policy()).network.allowAllUnixSockets).toBe(
      false,
    );
    expect(
      emitSandboxProfile(buildEnvelopeFixture({}), policy({ allowUnixSockets: true })).network
        .allowAllUnixSockets,
    ).toBe(true);
  });

  /** A malformed owned path or scratch path must not become a grant. */
  it.each(["/etc", "~/.ssh", "../escape", "src/*"])(
    "drops the unusable scratch path %j rather than emitting it",
    (bad) => {
      const profile = emitSandboxProfile(
        buildEnvelopeFixture({ ownedPaths: [] }),
        policy({ allowedWriteScratchPaths: [bad] }),
      );
      expect(profile.filesystem.allowWrite).toEqual([WORKER_TMP_WRITE_PLACEHOLDER]);
    },
  );

  it("de-duplicates an owned path that is also declared as scratch", () => {
    const profile = emitSandboxProfile(
      buildEnvelopeFixture({ ownedPaths: ["dist"] }),
      policy({ allowedWriteScratchPaths: ["dist"] }),
    );

    expect(profile.filesystem.allowWrite).toEqual([
      `${WORKTREE_WRITE_PLACEHOLDER}/dist`,
      WORKER_TMP_WRITE_PLACEHOLDER,
    ]);
  });

  /**
   * Omitting the policy keeps the pre-Gap-18 wide grant, deliberately and
   * visibly. It is the mode where a human reviews the resulting diff; the
   * standing-approval path must always pass a policy, and refuses to dispatch
   * without one rather than quietly compiling wide.
   */
  it("keeps the whole-worktree grant when NO policy is supplied", () => {
    const profile = emitSandboxProfile(buildEnvelopeFixture({ ownedPaths: ["src"] }));

    expect(profile.filesystem.allowWrite).toEqual([
      WORKTREE_WRITE_PLACEHOLDER,
      WORKER_TMP_WRITE_PLACEHOLDER,
    ]);
    expect(profile.network.allowAllUnixSockets).toBe(true);
  });

  /** The deny lists are mandatory and must survive narrowing untouched. */
  it("leaves the mandatory deny lists intact", () => {
    const narrowed = emitSandboxProfile(buildEnvelopeFixture({ ownedPaths: ["src"] }), policy());
    const wide = emitSandboxProfile(buildEnvelopeFixture({ ownedPaths: ["src"] }));

    expect(narrowed.filesystem.denyWrite).toEqual(wide.filesystem.denyWrite);
    expect(narrowed.filesystem.denyRead).toEqual(wide.filesystem.denyRead);
  });
});
