/**
 * Auth probe — roadmap/09-cli-and-doctor.md §Doctor checks: "auth probe
 * (subscription token valid, value never printed)." §Test plan, Security:
 * "doctor's auth probe prints only a validity verdict, never the resolved
 * token value." The injectable `resolveAuthState` seam never returns the
 * raw token to this check's own `run()` — only a boolean validity verdict
 * — so there is no code path here that could ever place a token value into
 * a `DoctorFinding.evidence` string.
 *
 * ADVERSARIAL-REVIEW FIX (2026-07-24): `bin.ts` never supplied a real
 * `resolveAuthState` to `CliDependencies`, so `run-doctor.ts`'s default
 * (`() => Promise.resolve("missing")`) meant the shipped `doctor` command
 * always reported this check FAILED, even on an authenticated host.
 * `createRealAuthStateResolver` below is the real probe, checking exactly
 * the two paths `docs/engine-baseline.md` §1 records — never resolving to
 * (or printing) the token/credential bytes themselves, only a classified
 * verdict.
 */
import { readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { DoctorCheck, DoctorFinding } from "../framework.js";

export type AuthState = "valid" | "missing" | "invalid";

export type AuthProbeFn = () => Promise<AuthState>;

/** The real probe: true auth resolution happens inside `resolve` and this function receives back ONLY the classified state — never the token bytes themselves, by construction (the function signature has no return path for it). */
export function createRealAuthProbe(resolve: () => Promise<AuthState>): AuthProbeFn {
  return resolve;
}

type SecretFileState = "valid" | "invalid" | "absent";

/**
 * Checks one candidate secret file (`.eo-oauth-token` / `.credentials.json`):
 * absent → `"absent"` (try the next candidate); present with the wrong mode
 * (not `0600`) → `"invalid"` (a real misconfiguration, not merely "missing");
 * present, `0600`, non-empty (and, when `requireJson`, JSON-parseable) →
 * `"valid"`. Never returns or logs the file's own content — only reads it
 * far enough to classify.
 */
async function checkSecretFile(
  path: string,
  requireJson: boolean,
): Promise<SecretFileState> {
  let mode: number;
  try {
    const st = await stat(path);
    mode = st.mode & 0o777;
  } catch {
    return "absent";
  }
  if (mode !== 0o600) return "invalid";

  let content: string;
  try {
    content = await readFile(path, "utf8");
  } catch {
    return "invalid";
  }
  if (content.trim().length === 0) return "invalid";
  if (requireJson) {
    try {
      JSON.parse(content);
    } catch {
      return "invalid";
    }
  }
  return "valid";
}

export interface RealAuthStateResolverOptions {
  /** Injectable for tests — defaults to `process.env`. */
  readonly env?: Readonly<Record<string, string | undefined>>;
  /** Injectable for tests — defaults to `os.homedir()`. */
  readonly homeDir?: string;
}

/**
 * The real, filesystem/env-probing auth resolver — checks, in priority
 * order (`docs/engine-baseline.md` §1): `CLAUDE_CODE_OAUTH_TOKEN` env var;
 * `~/.claude/.eo-oauth-token` (mode-checked, per the baseline's own
 * "mode-checked, read at runtime, never written to any committed file");
 * `~/.claude/.credentials.json` (mode-checked, JSON-parseable). Resolves
 * `"missing"` only when none of the three are present at all;
 * `"invalid"` when a candidate exists but fails its mode/content check.
 */
export function createRealAuthStateResolver(
  options: RealAuthStateResolverOptions = {},
): AuthProbeFn {
  const env = options.env ?? process.env;
  const home = options.homeDir ?? homedir();

  return async () => {
    const tokenEnv = env.CLAUDE_CODE_OAUTH_TOKEN;
    if (typeof tokenEnv === "string" && tokenEnv.trim().length > 0) {
      return "valid";
    }

    const tokenFileState = await checkSecretFile(join(home, ".claude", ".eo-oauth-token"), false);
    if (tokenFileState !== "absent") return tokenFileState;

    const credentialsState = await checkSecretFile(
      join(home, ".claude", ".credentials.json"),
      true,
    );
    if (credentialsState !== "absent") return credentialsState;

    return "missing";
  };
}

export interface AuthProbeOptions {
  readonly probe: AuthProbeFn;
}

const CHECK_ID = "auth.probe";

export function createAuthProbeCheck(options: AuthProbeOptions): DoctorCheck {
  return {
    id: CHECK_ID,
    severity: "error",
    async run(): Promise<DoctorFinding> {
      const state = await options.probe();
      if (state === "valid") {
        return { id: CHECK_ID, severity: "error", passed: true, evidence: "subscription auth is valid" };
      }
      if (state === "missing") {
        return {
          id: CHECK_ID,
          severity: "error",
          passed: false,
          evidence: "no subscription auth was found",
          repairStep: "run `claude setup-token` or set CLAUDE_CODE_OAUTH_TOKEN",
        };
      }
      return {
        id: CHECK_ID,
        severity: "error",
        passed: false,
        evidence: "subscription auth is present but invalid",
        repairStep: "re-authenticate via `claude setup-token`",
      };
    },
  };
}
