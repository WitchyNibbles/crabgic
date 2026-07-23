/**
 * Secret-reference resolver — roadmap/16-gateway-core.md §In scope,
 * `ExternalConnection` store bullet: "secret references only (env, file
 * 0600, exec backends; extensible) — never a literal credential in
 * worker- or manager-reachable state." Work item 1.
 *
 * This module resolves a `SecretReference` (02's `SecretReferenceSchema`,
 * a discriminated union over `backend`) to the live secret VALUE — the
 * only place in this package permitted to produce that value. Callers
 * (the mutation pipeline, the HTTP client) must never persist, log, or
 * echo the resolved value back into any response, error, or journal
 * entry — see `ConnectorError`'s own redaction discipline (`@eo/contracts`)
 * for the sibling guarantee on the read side.
 *
 * `file` backend requires the file to be exactly mode `0600` (owner
 * read/write only) — a looser mode (e.g. group/world readable) is refused
 * before the file is even opened, never silently tolerated.
 */

import { readFile, stat } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { SecretReference } from "@eo/contracts";

const execFileAsync = promisify(execFile);

/** File-mode bits (lower 9 bits) that must be exactly `0600` for the `file` backend. */
const REQUIRED_FILE_MODE = 0o600;
const FILE_MODE_MASK = 0o777;

export class SecretResolutionError extends Error {
  readonly backend: SecretReference["backend"];

  constructor(backend: SecretReference["backend"], message: string) {
    super(`secret-reference-resolver (${backend}): ${message}`);
    this.name = "SecretResolutionError";
    this.backend = backend;
    Object.freeze(this);
  }
}

async function resolveEnv(ref: Extract<SecretReference, { backend: "env" }>): Promise<string> {
  const value = process.env[ref.variable];
  if (value === undefined || value.length === 0) {
    throw new SecretResolutionError(
      "env",
      `environment variable "${ref.variable}" is unset or empty`,
    );
  }
  return value;
}

async function resolveFile(ref: Extract<SecretReference, { backend: "file" }>): Promise<string> {
  let fileStat;
  try {
    fileStat = await stat(ref.path);
  } catch (err) {
    throw new SecretResolutionError(
      "file",
      `cannot stat "${ref.path}": ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const actualMode = fileStat.mode & FILE_MODE_MASK;
  if (actualMode !== REQUIRED_FILE_MODE) {
    throw new SecretResolutionError(
      "file",
      `refusing to read "${ref.path}": mode must be 0600, found ${actualMode.toString(8)}`,
    );
  }

  const raw = await readFile(ref.path, "utf8");
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    throw new SecretResolutionError("file", `"${ref.path}" is empty`);
  }
  return trimmed;
}

async function resolveExec(ref: Extract<SecretReference, { backend: "exec" }>): Promise<string> {
  let stdout: string;
  try {
    const result = await execFileAsync(ref.command, ref.args ? [...ref.args] : [], {
      timeout: 10_000,
      maxBuffer: 64 * 1024,
    });
    stdout = result.stdout;
  } catch (err) {
    // Never echo the raw child-process error (may embed stderr containing
    // secret material or provider diagnostics) — only a generic summary.
    throw new SecretResolutionError(
      "exec",
      `command "${ref.command}" failed: ${err instanceof Error ? err.message.split("\n")[0] : "unknown error"}`,
    );
  }
  const trimmed = stdout.trim();
  if (trimmed.length === 0) {
    throw new SecretResolutionError("exec", `command "${ref.command}" produced no output`);
  }
  return trimmed;
}

/**
 * Resolves a `SecretReference` to its live value. Extensible by
 * construction (a switch over the discriminant) — a 4th backend is a
 * coordinated schema change in `@eo/contracts` plus one new branch here,
 * per this schema's own doc comment.
 */
export async function resolveSecretReference(ref: SecretReference): Promise<string> {
  switch (ref.backend) {
    case "env":
      return resolveEnv(ref);
    case "file":
      return resolveFile(ref);
    case "exec":
      return resolveExec(ref);
    /* c8 ignore next 2 -- exhaustiveness guard; SecretReference is a closed union */
    default: {
      const _exhaustive: never = ref;
      throw new SecretResolutionError(
        (_exhaustive as SecretReference).backend,
        "unknown secret-reference backend",
      );
    }
  }
}
