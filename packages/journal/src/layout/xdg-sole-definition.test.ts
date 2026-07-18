import { readdirSync, readFileSync, type Dirent } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * roadmap/04-journal-idempotency-leases.md exit criterion 11:
 * "`$XDG_STATE_HOME`/`$XDG_CACHE_HOME` engineering-orchestrator roots are
 * defined exactly once in this package — evidence: repo-wide lint/grep CI
 * check fails if another package reimplements the root instead of
 * importing it." This is that check, run as a normal vitest test (this
 * repo has no separate custom-lint-script mechanism outside vitest/eslint,
 * so a test IS this repo's "CI check" form — matching the precedent
 * `packages/contracts/src/gateway/server-name.test.ts`'s own sole-
 * definition-site scanner sets for `GATEWAY_MCP_SERVER_NAME`, per
 * docs/evidence/phase-02/README.md).
 *
 * DETECTION RULE: flags a file OUTSIDE `packages/journal/src` only when it
 * contains BOTH (a) the product namespace literal `"engineering-
 * orchestrator"` AND (b) a reference to `XDG_STATE_HOME`/`XDG_CACHE_HOME`
 * (env-var-based root derivation — the actual reimplementation risk this
 * exit criterion cares about: a package that reads the XDG env vars itself
 * and builds its own `.../engineering-orchestrator/<hash>/...` path rather
 * than importing `resolveStateRoot`/`resolveCacheRoot`/etc. from this
 * package). Requiring BOTH conditions (not just the namespace literal
 * alone) deliberately allowlists any package that merely REFERENCES the
 * product name for unrelated reasons (e.g. a display string, a package
 * description) without touching XDG env-var resolution at all.
 *
 * DOCUMENTED SEAM (allowlist, per this worker's brief): `packages/engine-
 * core` is being built concurrently by another worker and legitimately
 * emits DOCUMENTED, TILDE-ANCHORED DEFAULT literals
 * (`~/.local/state/engineering-orchestrator/**`,
 * `~/.cache/engineering-orchestrator/**`) in its compiled capability-deny
 * lists — phase 03 (engine-core) cannot import phase 04 (journal) per the
 * roadmap's own dependency graph (03 has no edge to/from 04), so it cannot
 * literally import `resolveStateRoot`/`resolveCacheRoot` even if it wanted
 * to; an orchestrator-settled seam, not a violation this check should
 * catch. Those literals are STATIC STRINGS (no `process.env.XDG_*` read
 * anywhere near them) — under this check's AND-based detection rule they
 * would not match condition (b) and so would not be flagged even with no
 * explicit allowlist entry. `XDG_ALLOWLISTED_RELATIVE_PATHS` exists as a
 * defensive, explicit escape hatch anyway (e.g. for a doc comment in
 * engine-core that happens to mention `$XDG_STATE_HOME` in prose while
 * explaining why its literal mirrors that variable's own spec default) —
 * entries here must each carry a one-line rationale in the array itself.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, "..", "..", "..", "..");
const PACKAGES_DIR = join(REPO_ROOT, "packages");

/** Every entry MUST carry an inline rationale comment — see file-level doc comment's "DOCUMENTED SEAM" section. */
const XDG_ALLOWLISTED_RELATIVE_PATHS: readonly string[] = [
  // packages/engine-core/src/compiler/xdg-default-paths.ts: confirmed by
  // direct read (2026-07-18) — this file's ONLY XDG-related runtime values
  // are `~`-anchored literal fallbacks
  // (CONTROL_REPO_STATE_ROOT_DENY_PATH = "~/.local/state/engineering-
  // orchestrator/**", CONTROL_REPO_CACHE_ROOT_DENY_PATH =
  // "~/.cache/engineering-orchestrator/**") with NO `process.env.XDG_*`
  // read anywhere in the file — it is not a reimplementation of env-var-
  // based root resolution at all. It matches this check's AND-rule only
  // because its own doc comment DISCUSSES `$XDG_STATE_HOME`/
  // `$XDG_CACHE_HOME` in PROSE while explaining exactly why it deliberately
  // does NOT resolve them (the documented phase 03 -> phase 04 import-edge
  // seam roadmap/03 and interface-ledger Gap 14 both record: phase 03
  // cannot depend on `@eo/journal`, so it hardcodes the XDG spec's own
  // documented unset-env-var defaults instead of reading the env vars).
  "packages/engine-core/src/compiler/xdg-default-paths.ts",
];

const NAMESPACE_LITERAL = "engineering-orchestrator";
const XDG_ENV_VAR_PATTERN = /XDG_STATE_HOME|XDG_CACHE_HOME/;

function listTsFilesRecursive(dir: string): string[] {
  let entries: Dirent[];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const entry of entries) {
    if (entry.name === "node_modules" || entry.name === "dist") continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...listTsFilesRecursive(full));
    } else if (entry.isFile() && entry.name.endsWith(".ts")) {
      out.push(full);
    }
  }
  return out;
}

describe("XDG root sole-definition-site check (roadmap/04 exit criterion 11)", () => {
  it("no package outside packages/journal/src reimplements env-var-based XDG state/cache root resolution", () => {
    const packageEntries = readdirSync(PACKAGES_DIR, { withFileTypes: true }).filter(
      (entry) => entry.isDirectory() && entry.name !== "journal",
    );

    const violations: string[] = [];
    for (const pkg of packageEntries) {
      const srcDir = join(PACKAGES_DIR, pkg.name, "src");
      for (const file of listTsFilesRecursive(srcDir)) {
        const rel = relative(REPO_ROOT, file);
        if (XDG_ALLOWLISTED_RELATIVE_PATHS.includes(rel)) continue;

        const content = readFileSync(file, "utf8");
        const hasNamespaceLiteral = content.includes(NAMESPACE_LITERAL);
        const hasEnvVarDerivation = XDG_ENV_VAR_PATTERN.test(content);
        if (hasNamespaceLiteral && hasEnvVarDerivation) {
          violations.push(rel);
        }
      }
    }

    expect(
      violations,
      `packages/journal/src/layout/xdg-layout.ts is the sole definition site for the XDG state/cache roots — the following file(s) outside packages/journal appear to reimplement env-var-based root resolution instead of importing it: ${violations.join(", ")}`,
    ).toEqual([]);
  });

  it("sanity: this check's own detection rule actually fires against a synthetic reimplementation fixture", () => {
    // Guards against the check silently becoming a no-op (e.g. a future
    // edit accidentally weakening the regex/condition to always pass).
    const fakeReimplementation = `
      const stateHome = process.env.XDG_STATE_HOME ?? join(home, ".local", "state");
      const root = join(stateHome, "engineering-orchestrator", projectHash);
    `;
    const hasNamespaceLiteral = fakeReimplementation.includes(NAMESPACE_LITERAL);
    const hasEnvVarDerivation = XDG_ENV_VAR_PATTERN.test(fakeReimplementation);
    expect(hasNamespaceLiteral && hasEnvVarDerivation).toBe(true);
  });

  it("sanity: a tilde-anchored literal default with no XDG env-var reference does NOT trigger the check (the engine-core seam)", () => {
    const tildeDefault = `export const DEFAULT_STATE_DENY_ROOT = "~/.local/state/engineering-orchestrator/**";`;
    const hasNamespaceLiteral = tildeDefault.includes(NAMESPACE_LITERAL);
    const hasEnvVarDerivation = XDG_ENV_VAR_PATTERN.test(tildeDefault);
    expect(hasNamespaceLiteral && hasEnvVarDerivation).toBe(false);
  });

  it("keeps every allowlisted file honest: none of them actually reads process.env.XDG_STATE_HOME/XDG_CACHE_HOME (only mentions the names in prose/literals)", () => {
    // Guards the allowlist itself against silently covering a REAL future
    // reimplementation slipped into an already-allowlisted file — an
    // allowlist entry is only valid for a file with NO env-var READ, only
    // a literal/prose mention of the variable names.
    const ENV_READ_PATTERN = /process\.env(?:\s*\[\s*["'`]|\.)\s*(?:XDG_STATE_HOME|XDG_CACHE_HOME)/;
    for (const rel of XDG_ALLOWLISTED_RELATIVE_PATHS) {
      const content = readFileSync(join(REPO_ROOT, rel), "utf8");
      expect(
        ENV_READ_PATTERN.test(content),
        `allowlisted file "${rel}" now reads XDG env vars directly — remove it from the allowlist and let the check flag it`,
      ).toBe(false);
    }
  });
});
