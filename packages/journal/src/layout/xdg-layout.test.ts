import { describe, expect, it } from "vitest";
import {
  ENGINEERING_ORCHESTRATOR_DIR_NAME,
  readXdgEnvFromProcess,
  resolveCacheRoot,
  resolveJournalDir,
  resolveJournalSegmentsDir,
  resolveJournalSnapshotsDir,
  resolveLeasesDir,
  resolveStateRoot,
  resolveXdgCacheHome,
  resolveXdgStateHome,
  type XdgEnv,
} from "./xdg-layout.js";

const HASH = "abc123deadbeef";

describe("xdg-layout", () => {
  it("falls back to ~/.local/state and ~/.cache when XDG_* are unset", () => {
    const env: XdgEnv = { HOME: "/home/eimi" };
    expect(resolveXdgStateHome(env)).toBe("/home/eimi/.local/state");
    expect(resolveXdgCacheHome(env)).toBe("/home/eimi/.cache");
  });

  it("honors explicit XDG_STATE_HOME / XDG_CACHE_HOME overrides", () => {
    const env: XdgEnv = {
      HOME: "/home/eimi",
      XDG_STATE_HOME: "/custom/state",
      XDG_CACHE_HOME: "/custom/cache",
    };
    expect(resolveXdgStateHome(env)).toBe("/custom/state");
    expect(resolveXdgCacheHome(env)).toBe("/custom/cache");
  });

  it("pins the state root at $XDG_STATE_HOME/engineering-orchestrator/<project-hash>/", () => {
    const env: XdgEnv = { HOME: "/home/eimi", XDG_STATE_HOME: "/state" };
    expect(resolveStateRoot(env, HASH)).toBe(`/state/${ENGINEERING_ORCHESTRATOR_DIR_NAME}/${HASH}`);
  });

  it("pins the cache root at $XDG_CACHE_HOME/engineering-orchestrator/<project-hash>/ (Gap 14)", () => {
    const env: XdgEnv = { HOME: "/home/eimi", XDG_CACHE_HOME: "/cache" };
    expect(resolveCacheRoot(env, HASH)).toBe(`/cache/${ENGINEERING_ORCHESTRATOR_DIR_NAME}/${HASH}`);
  });

  it("nests journal/, journal/segments/, journal/snapshots/, and leases/ under the state root", () => {
    const env: XdgEnv = { HOME: "/home/eimi", XDG_STATE_HOME: "/state" };
    const root = resolveStateRoot(env, HASH);
    expect(resolveJournalDir(env, HASH)).toBe(`${root}/journal`);
    expect(resolveJournalSegmentsDir(env, HASH)).toBe(`${root}/journal/segments`);
    expect(resolveJournalSnapshotsDir(env, HASH)).toBe(`${root}/journal/snapshots`);
    expect(resolveLeasesDir(env, HASH)).toBe(`${root}/leases`);
  });

  it("keeps <project-hash> immediately under engineering-orchestrator/, subpaths nested beneath it (Gap 14 path-segment order)", () => {
    const env: XdgEnv = { HOME: "/home/eimi", XDG_CACHE_HOME: "/cache" };
    const cacheRoot = resolveCacheRoot(env, HASH);
    // 07's git-control/ and 12's capability-store/ nest AFTER the hash segment, never before it.
    expect(`${cacheRoot}/git-control`).toBe(
      `/cache/${ENGINEERING_ORCHESTRATOR_DIR_NAME}/${HASH}/git-control`,
    );
  });

  it("is a pure function of its explicit env parameter — same input, same output, no ambient process.env influence", () => {
    const originalStateHome = process.env.XDG_STATE_HOME;
    process.env.XDG_STATE_HOME = "/should-not-be-read";
    try {
      const env: XdgEnv = { HOME: "/home/eimi", XDG_STATE_HOME: "/explicit" };
      expect(resolveStateRoot(env, HASH)).toBe(
        `/explicit/${ENGINEERING_ORCHESTRATOR_DIR_NAME}/${HASH}`,
      );
    } finally {
      if (originalStateHome === undefined) delete process.env.XDG_STATE_HOME;
      else process.env.XDG_STATE_HOME = originalStateHome;
    }
  });
});

describe("readXdgEnvFromProcess — the one impure boundary function", () => {
  function withEnv(overrides: Record<string, string | undefined>, run: () => void): void {
    const originals = new Map<string, string | undefined>();
    for (const key of Object.keys(overrides)) {
      originals.set(key, process.env[key]);
      const value = overrides[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    try {
      run();
    } finally {
      for (const [key, original] of originals) {
        if (original === undefined) delete process.env[key];
        else process.env[key] = original;
      }
    }
  }

  it("reads HOME/XDG_STATE_HOME/XDG_CACHE_HOME from process.env when all are set", () => {
    withEnv({ HOME: "/home/eimi", XDG_STATE_HOME: "/state", XDG_CACHE_HOME: "/cache" }, () => {
      expect(readXdgEnvFromProcess()).toEqual({
        HOME: "/home/eimi",
        XDG_STATE_HOME: "/state",
        XDG_CACHE_HOME: "/cache",
      });
    });
  });

  it("omits XDG_STATE_HOME/XDG_CACHE_HOME entirely (not undefined-valued) when unset", () => {
    withEnv({ HOME: "/home/eimi", XDG_STATE_HOME: undefined, XDG_CACHE_HOME: undefined }, () => {
      const env = readXdgEnvFromProcess();
      expect(env).toEqual({ HOME: "/home/eimi" });
      expect("XDG_STATE_HOME" in env).toBe(false);
    });
  });

  it("throws when HOME is unset", () => {
    withEnv({ HOME: undefined }, () => {
      expect(() => readXdgEnvFromProcess()).toThrow(/HOME is not set/);
    });
  });

  it("throws when HOME is an empty string", () => {
    withEnv({ HOME: "" }, () => {
      expect(() => readXdgEnvFromProcess()).toThrow(/HOME is not set/);
    });
  });
});
