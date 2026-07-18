import { describe, expect, it } from "vitest";
import {
  resolveSupervisorDir,
  resolveSupervisorRegistriesDir,
  resolveSupervisorRuntimeDir,
  resolveSupervisorSocketPath,
  SUPERVISOR_RUN_SUBDIR,
  SUPERVISOR_SOCKET_FILE_NAME,
  SUPERVISOR_STATE_SUBDIR,
} from "./xdg-supervisor-layout.js";

const ENV = { HOME: "/home/tester", XDG_STATE_HOME: "/home/tester/.local/state" };
const HASH = "abc123hash";

describe("xdg-supervisor-layout", () => {
  it("nests supervisor/ as a sibling under 04's pinned state root, never a second root", () => {
    const dir = resolveSupervisorDir(ENV, HASH);
    expect(dir).toBe(
      `/home/tester/.local/state/engineering-orchestrator/${HASH}/${SUPERVISOR_STATE_SUBDIR}`,
    );
  });

  it("nests the runtime dir under supervisor/run/", () => {
    const dir = resolveSupervisorRuntimeDir(ENV, HASH);
    expect(dir).toBe(
      `/home/tester/.local/state/engineering-orchestrator/${HASH}/${SUPERVISOR_STATE_SUBDIR}/${SUPERVISOR_RUN_SUBDIR}`,
    );
  });

  it("resolves the socket path inside the runtime dir", () => {
    const socketPath = resolveSupervisorSocketPath(ENV, HASH);
    expect(socketPath).toBe(
      `${resolveSupervisorRuntimeDir(ENV, HASH)}/${SUPERVISOR_SOCKET_FILE_NAME}`,
    );
  });

  it("resolves a distinct registries dir, still under the same supervisor/ sibling", () => {
    const dir = resolveSupervisorRegistriesDir(ENV, HASH);
    expect(dir.startsWith(resolveSupervisorDir(ENV, HASH))).toBe(true);
    expect(dir).not.toBe(resolveSupervisorRuntimeDir(ENV, HASH));
  });

  it("falls back to $HOME/.local/state when XDG_STATE_HOME is unset, matching 04's own default", () => {
    const dir = resolveSupervisorDir({ HOME: "/home/tester" }, HASH);
    expect(dir).toBe(`/home/tester/.local/state/engineering-orchestrator/${HASH}/supervisor`);
  });
});
