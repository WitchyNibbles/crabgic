import { describe, expect, it } from "vitest";
import {
  emitSandboxProfile,
  WORKTREE_WRITE_PLACEHOLDER,
  WORKER_TMP_WRITE_PLACEHOLDER,
} from "./sandbox-profile.js";
import { buildEnvelopeFixture } from "./envelope-fixture.js";
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
      buildEnvelopeFixture({ credentialReferences: ["EO_TOKEN_A", "EO_TOKEN_B"] }),
    );
    expect(profile.credentials.envVars).toEqual([
      { name: "EO_TOKEN_A", mode: "mask" },
      { name: "EO_TOKEN_B", mode: "mask" },
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
