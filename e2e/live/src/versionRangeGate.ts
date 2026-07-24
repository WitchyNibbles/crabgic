import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";
import {
  ACCEPTED_ENGINE_VERSION_RANGE,
  assertEngineVersionAccepted,
  EngineVersionRejectedError,
  TESTED_ENGINE_VERSION,
  type EngineVersionRange,
} from "@eo/engine-claude";

const execFile = promisify(execFileCb);

/**
 * Pinned-range gate wiring — roadmap/23-release-hardening.md work item 7:
 * "assert the live `claude --version` is within `docs/engine-baseline.md`'s
 * accepted range using `@eo/engine-claude`'s version-gate (now
 * 2.1.207-2.1.218)." This module never re-derives the range or the
 * comparison logic — both are `@eo/engine-claude`'s own (`./version-gate.
 * ts`, re-exported from that package's public barrel) — it only wires an
 * injectable "how do we get the live version string" probe onto that
 * existing gate, so this harness can assert against whatever `claude` is
 * actually on the release host's `PATH`.
 */

/** A version-probe result: either a version string was read, or the probe itself failed (binary missing, non-zero exit, unparsable stdout) — kept distinct from a version that parsed fine but is out of range. */
export type VersionProbeResult =
  | { readonly ok: true; readonly rawOutput: string; readonly version: string }
  | { readonly ok: false; readonly reason: string };

export type VersionProbeFn = () => Promise<VersionProbeResult>;

/** Extracts a `<major>.<minor>.<patch>` triple from `claude --version`'s stdout, e.g. `"2.1.218 (Claude Code)"` -> `"2.1.218"`. */
const VERSION_IN_OUTPUT_PATTERN = /(\d+\.\d+\.\d+)/;

export function parseClaudeVersionOutput(rawOutput: string): string | undefined {
  const match = VERSION_IN_OUTPUT_PATTERN.exec(rawOutput);
  return match?.[1];
}

/**
 * Builds a real, host-spawning probe. Injectable `binary`/`args` (both
 * default to the real `claude --version`) so tests can exercise this
 * probe's own failure branches against a REAL, deliberately-wrong binary —
 * a genuine integration proof, never a mock — the same "injectable seam,
 * real subprocess either way" convention `ProcessProbeFn` already
 * establishes elsewhere in this repo. Needs no auth/network/subscription —
 * a bare version query — so `realClaudeVersionProbe` below is safe to run
 * unconditionally (never gated behind `EO_LIVE`), the same way the sandbox
 * self-test's `bwrap --version` presence check is safe.
 */
export function createClaudeVersionProbe(
  binary = "claude",
  args: readonly string[] = ["--version"],
): VersionProbeFn {
  return async () => {
    try {
      const { stdout } = await execFile(binary, [...args]);
      const version = parseClaudeVersionOutput(stdout);
      if (version === undefined) {
        return { ok: false, reason: `could not parse a version triple out of: ${stdout.trim()}` };
      }
      return { ok: true, rawOutput: stdout.trim(), version };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, reason: `"${binary} ${args.join(" ")}" failed to run: ${message}` };
    }
  };
}

export const realClaudeVersionProbe: VersionProbeFn = createClaudeVersionProbe();

export type PinnedRangeVerdict =
  | { readonly status: "in-range"; readonly version: string; readonly range: EngineVersionRange }
  | {
      readonly status: "out-of-range";
      readonly version: string;
      readonly range: EngineVersionRange;
    }
  | { readonly status: "malformed"; readonly version: string }
  | { readonly status: "probe-failed"; readonly reason: string };

/**
 * Runs `probe`, then feeds a successfully-read version string through
 * `@eo/engine-claude`'s `assertEngineVersionAccepted` — NEVER throws;
 * every outcome (probe failure, malformed version, out-of-range version,
 * in-range version) is a distinct, inspectable `PinnedRangeVerdict` member,
 * matching this harness's own release-gate reporting shape (a doctor-style
 * check, not a bare assertion).
 */
export async function checkPinnedRange(
  probe: VersionProbeFn,
  /** Injectable so a test can prove the defensive re-throw branch below (any non-`EngineVersionRejectedError` failure must propagate, never be swallowed) without needing a real, otherwise-unreachable engine-internal error. Defaults to the real `@eo/engine-claude` gate. */
  assertVersionAccepted: (version: string) => void = assertEngineVersionAccepted,
): Promise<PinnedRangeVerdict> {
  const probed = await probe();
  if (!probed.ok) {
    return { status: "probe-failed", reason: probed.reason };
  }
  try {
    assertVersionAccepted(probed.version);
    return { status: "in-range", version: probed.version, range: ACCEPTED_ENGINE_VERSION_RANGE };
  } catch (err) {
    if (err instanceof EngineVersionRejectedError) {
      if (err.reason === "malformed") {
        return { status: "malformed", version: probed.version };
      }
      return { status: "out-of-range", version: probed.version, range: err.acceptedRange };
    }
    throw err;
  }
}

/** Re-exported for callers/tests that want to cite the tested/pinned point version alongside a `checkPinnedRange` verdict without importing `@eo/engine-claude` directly. */
export { ACCEPTED_ENGINE_VERSION_RANGE, TESTED_ENGINE_VERSION };
