/**
 * Real (non-test) `InstallerDependencies` wiring — factored out of
 * `../bootstrap.ts` the same way that module already factors out the rest
 * of `CliDependencies`, so it stays independently unit-testable.
 */
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Readable, Writable } from "node:stream";
import type { InstallerDependencies } from "./types.js";
import type { DerivedPolicy } from "../policy/derive-policy.js";
import {
  resolveApprovalTerminal,
  type ApprovalTerminalVerdict,
} from "../approval/interactive-terminal.js";

/**
 * Resolves the directory holding the plugin's distributable assets — the
 * subagents, hooks, skills, `.mcp.json` and `.claude-plugin/marketplace.json`
 * that `install` copies into a project and `doctor` verifies.
 *
 * TWO LAYOUTS, AND THE PUBLISHED ONE COMES FIRST.
 *
 * In the published package the assets sit beside the bundle at
 * `<dist>/plugin`, copied there by `scripts/bundle-cli.mjs`. In this
 * monorepo they live in the `@crabgic/plugin` workspace package, reachable by
 * ordinary module resolution.
 *
 * This used to try only the second, on the stated assumption that it "works
 * identically whether `@crabgic/plugin` is a workspace symlink (dev) or a
 * real published dependency". That assumption was false in the only case
 * that matters: `@crabgic/plugin` is `private: true` and is never published,
 * so a real install has no such module. 1.0.0 shipped with `crabgic doctor`
 * failing in any consuming repo with `Cannot find module
 * '@crabgic/plugin/package.json'`, and `crabgic install` — the command an
 * operator installs this package FOR — equally dead.
 *
 * The published layout is checked first because it is the one real users
 * have; the workspace fallback keeps development and the e2e harnesses
 * working unchanged.
 */
export function resolvePluginSourceDir(fromUrl: string = import.meta.url): string {
  const bundled = join(dirname(fileURLToPath(fromUrl)), "plugin");
  if (existsSync(join(bundled, ".claude-plugin", "marketplace.json"))) return bundled;

  const require = createRequire(fromUrl);
  const packageJsonPath = require.resolve("@crabgic/plugin/package.json");
  return dirname(packageJsonPath);
}

/**
 * Reads one line of confirmation from `input`; resolves `true` only for an
 * exact (trimmed, case-insensitive) "yes" — the same convention
 * `../approval/prompt.ts` uses for its own human-only gate, including how it
 * settles.
 *
 * EOF terminates the final line and a bare EOF declines, because a stream that
 * has ended will never emit again: listening only for `data` left `install`
 * hanging on a prompt nobody could answer, exactly as the approval prompt did
 * before 2026-07-29. A stream error declines rather than crashing the install.
 */
function readYesConfirmation(input: Readable): Promise<boolean> {
  return new Promise((resolve) => {
    if (input.readableEnded || input.destroyed) {
      resolve(false);
      return;
    }
    let buffer = "";
    const isYes = (line: string): boolean => line.trim().toLowerCase() === "yes";
    const settle = (value: boolean): void => {
      input.off("data", onData);
      input.off("end", onEnd);
      input.off("close", onClose);
      input.off("error", onError);
      resolve(value);
    };
    function onData(chunk: Buffer | string): void {
      buffer += typeof chunk === "string" ? chunk : chunk.toString("utf8");
      if (buffer.includes("\n")) settle(isYes(buffer.split("\n")[0]!));
    }
    function onEnd(): void {
      settle(isYes(buffer));
    }
    function onClose(): void {
      // An abnormal teardown is not an answer.
      settle(false);
    }
    function onError(): void {
      settle(false);
    }
    input.on("data", onData);
    input.on("end", onEnd);
    input.on("close", onClose);
    input.on("error", onError);
  });
}

/** The real, interactive `confirmGitInit` — prompts on `output`, reads a line from `input`. Never runs `git init` itself; only decides whether `install` is allowed to. */
export function createRealConfirmGitInit(io: {
  readonly input: Readable;
  readonly output: Writable;
}): () => Promise<boolean> {
  return async () => {
    io.output.write(
      'This directory is not a git repository. Run "git init" so the Crabgic ' +
        'can track its own control repo/worktrees?\nType "yes" to proceed, anything else to abort: ',
    );
    return readYesConfirmation(io.input);
  };
}

/**
 * Renders a derived `EnvelopePolicy` in full and reads one line of
 * confirmation — the standing approval's only authoring moment (ledger Gap
 * 18; roadmap/10's install-time amendment).
 *
 * IT RENDERS EVERYTHING IT GRANTS. The prompt this design replaces showed a
 * bare hex digest and no envelope content whatsoever, which is a large part
 * of why replacing it is defensible at all. An owner confirming a STANDING
 * grant — one that covers every future run rather than a single change set —
 * must be able to read what it covers, so every dimension is printed,
 * including the ones that are empty. "Nothing" is the most important thing on
 * the list, and an omitted line reads as an oversight rather than a denial.
 *
 * AND IT ASKS WHO IS ANSWERING (2026-07-30, adversarial review). This is the
 * one place the standing policy is authored, so it is the one place Gap 18
 * part 3 — "the model can never widen the policy" — is actually enforceable in
 * code. It was a bare `process.stdin` read, so `echo yes | crabgic install`
 * from an agent's own shell authored the policy that decides what runs without
 * review; that was demonstrated during this session before it was fixed. The
 * same gate the approval prompt uses now guards it, and a non-human context
 * SKIPS authoring rather than writing a grant nobody read — everything else
 * `install` does still installs, because plugin and settings work is
 * legitimately automatable and a standing authorization is not.
 *
 * What this does NOT do, stated plainly because the docs used to overclaim it:
 * the policy file lives at the owner's own uid, so anything running as the
 * owner — including a manager session with file access — can edit it directly.
 * The policy is a boundary against WORKERS (sandboxed, no write to the state
 * root), not against a compromised session. See `docs/security-posture.md`.
 */
export function createRealConfirmPolicy(io: {
  readonly input: Readable;
  readonly output: Writable;
  /** Decides whether this process may author a standing grant at all. Defaults to the same gate `../approval/prompt.ts`'s callers use; injectable so tests never depend on the ambient terminal. */
  readonly resolveTerminal?: () => ApprovalTerminalVerdict;
}): (derived: DerivedPolicy) => Promise<boolean> {
  return async (derived) => {
    const terminal =
      io.resolveTerminal?.() ??
      resolveApprovalTerminal({ env: process.env, isTty: process.stdin.isTTY === true });
    if (!terminal.allowed) {
      io.output.write(
        `\nSkipping the standing authorization policy: ${terminal.reason}\n` +
          "Everything else was installed. Run `crabgic install` yourself in a terminal you\n" +
          "opened to author it, or write the policy file directly — until then every run\n" +
          "stops for approval instead of proceeding on a grant nobody read.\n",
      );
      return false;
    }

    const p = derived.policy;
    const list = (values: readonly string[]): string =>
      values.length === 0 ? "    (none)" : values.map((v) => `    ${v}`).join("\n");

    io.output.write(
      "\nThis project's standing authorization policy. Every run whose authority\n" +
        "fits inside it proceeds without asking you again; anything outside it\n" +
        "stops and reports.\n\n" +
        `  writable paths\n${list(p.allowedPathPrefixes)}\n\n` +
        `  build output it may also write\n${list(p.allowedWriteScratchPaths)}\n\n` +
        `  commands\n${list(p.allowedCommands)}\n\n` +
        `  network destinations\n${list(p.allowedNetworkDestinations)}\n\n` +
        `  credentials\n${list(p.allowedCredentialReferences)}\n\n` +
        `  external resources (Jira, Grafana)\n${list(p.allowedRemoteResourceReferences)}\n\n` +
        `  unix sockets: ${p.allowUnixSockets ? "allowed" : "denied"}\n\n` +
        "You can narrow or widen this later by editing the file directly. No worker\n" +
        "Crabgic runs can reach it — the sandbox keeps them out of this directory.\n" +
        "It is your own file at your own account, though, so treat it like your SSH\n" +
        "keys rather than like a vault.\n" +
        'Type "yes" to accept this policy, anything else to skip it: ',
    );
    return readYesConfirmation(io.input);
  };
}

export interface BuildRealInstallerDependenciesOverrides {
  readonly pluginSourceDir?: string;
  readonly confirmGitInit?: () => Promise<boolean>;
  /** Supplied by `../bootstrap.ts`, which is the only caller that knows the project's XDG paths. */
  readonly policy?: InstallerDependencies["policy"];
}

export function buildRealInstallerDependencies(
  targetDir: string,
  overrides: BuildRealInstallerDependenciesOverrides = {},
): InstallerDependencies {
  return {
    targetDir,
    pluginSourceDir: overrides.pluginSourceDir ?? resolvePluginSourceDir(),
    confirmGitInit:
      overrides.confirmGitInit ??
      createRealConfirmGitInit({ input: process.stdin, output: process.stdout }),
    // Only wired when the caller supplies it. `install` without a policy bag
    // still installs; its dispatches then refuse until a policy exists, which
    // is the correct fail-closed posture.
    ...(overrides.policy !== undefined ? { policy: overrides.policy } : {}),
  };
}
