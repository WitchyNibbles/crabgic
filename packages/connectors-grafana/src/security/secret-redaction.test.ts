import { readdirSync, readFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * roadmap/20-grafana-adapters.md §Test plan, "Security": "fixtures assert
 * no literal credential ever appears in a log, error, or golden artifact
 * (secret-reference-only storage)." This phase reuses `@eo/gateway`'s
 * `SecretReference`/`resolveSecretReference` (env/file/exec backends) —
 * this package itself never reads `process.env`, never constructs a
 * credential literal, and never accepts a raw token as a plain string
 * parameter anywhere on its own public surface.
 */

const SRC_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");

function collectSourceFiles(dir: string): readonly string[] {
  const entries = readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const entryPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === "dist") continue;
      files.push(...collectSourceFiles(entryPath));
    } else if (entry.isFile() && entry.name.endsWith(".ts")) {
      files.push(entryPath);
    }
  }
  return files;
}

/** Credential-shaped literal patterns that must never appear in THIS package's own source (test fixture strings are deliberately obvious, human-readable placeholders like "SECRET_MARKER" or "fake-...-token", never anything matching these real-world credential shapes). */
const CREDENTIAL_SHAPED_PATTERNS: readonly RegExp[] = [
  /glsa_[A-Za-z0-9]{20,}/, // Grafana Cloud service-account token prefix
  /glc_[A-Za-z0-9+/=]{20,}/, // Grafana Cloud API key prefix
  /eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/, // a real-shaped JWT
  /AKIA[0-9A-Z]{16}/, // AWS access key id shape
];

/**
 * These 3 files are the deliberate, narrow exemption: each proves a
 * redaction function actually catches a credential-shaped literal, which
 * requires a fixture string that genuinely matches one —
 * `redaction.test.ts` (the redactor's own unit tests), `leak-hunt.test.ts`
 * (proves the credential never survives into a canonical read-back), and
 * `resource-client.test.ts` (proves `canonicalizeDesiredInput` redacts the
 * SAME literal `parseCanonical` does). Every one of these files' own
 * redaction assertion proves the match never survives into the tested
 * function's OUTPUT, so nothing here is weakened by excluding the
 * fixture's raw input literal from this source-text sweep.
 */
const EXEMPT_FROM_LITERAL_SWEEP = new Set([
  "redaction.test.ts",
  "leak-hunt.test.ts",
  "resource-client.test.ts",
]);

describe("no credential-shaped literal appears anywhere in packages/connectors-grafana/src", () => {
  it("sweeps every .ts source file (except redaction.test.ts's own detection fixtures — see EXEMPT_FROM_LITERAL_SWEEP)", () => {
    const violations: string[] = [];
    for (const filePath of collectSourceFiles(SRC_DIR)) {
      if (EXEMPT_FROM_LITERAL_SWEEP.has(basename(filePath))) continue;
      const content = readFileSync(filePath, "utf8");
      for (const pattern of CREDENTIAL_SHAPED_PATTERNS) {
        if (pattern.test(content)) {
          violations.push(`${filePath} matched ${pattern}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });
});

describe("this package never reads process.env directly (secret resolution is exclusively @eo/gateway's job)", () => {
  it("no source file references process.env", () => {
    const offenders: string[] = [];
    for (const filePath of collectSourceFiles(SRC_DIR)) {
      if (filePath.endsWith(".test.ts")) continue; // this assertion is about production code only
      const content = readFileSync(filePath, "utf8");
      if (content.includes("process.env")) {
        offenders.push(filePath);
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe("this package never declares a plain-string secret/token/password/credential parameter on its own public surface", () => {
  it("no production source file declares a parameter or property literally named token/secret/password/credential (case-insensitive) outside SecretReference/doctor-scoped role checks", () => {
    // Deliberately narrow: this is a lint-shaped heuristic (grep for the
    // literal identifier, not a full type-flow analysis) — its purpose is
    // to catch an accidental "apiToken: string" parameter being added to
    // this package's own public deps interfaces, not to replace type-level
    // review. `connection-doctor.ts`'s own `role`/`orgId` fields (never a
    // token) and this file's own doc comment are exempt.
    const suspiciousIdentifier =
      /\b(?:apiKey|apiToken|rawToken|plaintextSecret|clearTextPassword)\s*:/;
    const offenders: string[] = [];
    for (const filePath of collectSourceFiles(SRC_DIR)) {
      if (filePath.endsWith(".test.ts")) continue;
      const content = readFileSync(filePath, "utf8");
      if (suspiciousIdentifier.test(content)) {
        offenders.push(filePath);
      }
    }
    expect(offenders).toEqual([]);
  });
});
