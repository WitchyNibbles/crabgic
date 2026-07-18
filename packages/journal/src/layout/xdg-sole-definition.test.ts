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
 * DETECTION RULE: flags a PRODUCTION source file (`.ts`, NOT `.test.ts`)
 * OUTSIDE `packages/journal/src` only when it contains BOTH (a) the product
 * namespace literal `"engineering-orchestrator"` AND (b) an actual READ of
 * `process.env.XDG_STATE_HOME`/`process.env.XDG_CACHE_HOME` (dot- or
 * bracket-access). Reading the XDG env var itself and then building a
 * `.../engineering-orchestrator/<hash>/...` path IS the reimplementation
 * this exit criterion cares about — precisely "reimplements the root
 * instead of importing it." Requiring an actual env-var READ (not a mere
 * textual MENTION of the variable name) is what makes the rule faithful:
 * a downstream package that correctly IMPORTS `resolveStateRoot`/
 * `resolveCacheRoot`/`readXdgEnvFromProcess` from `@eo/journal` and only
 * composes its own subpaths (as 05's `xdg-supervisor-layout.ts` and 07's
 * `layout.ts` do) still MENTIONS `$XDG_STATE_HOME` in its own doc comments
 * and re-exports, but never reads the env var itself — it must NOT be
 * flagged. `.test.ts` files are excluded outright: a test legitimately
 * constructs `XdgEnv` fixtures and may set `process.env.XDG_*` to exercise
 * override behavior; that is fixture setup, not a production reimplementation
 * of the root.
 *
 * (History: the original rule matched any textual MENTION of the env-var
 * names, which false-positived on 05/07's correct importers — doc comments
 * and test fixtures — once those downstream packages landed. Tightened
 * 2026-07-18 to an actual env-var READ in production source; the synthetic
 * sanity fixture below still fires, so the check retains its teeth.)
 *
 * DOCUMENTED SEAM (allowlist): `packages/engine-core` legitimately emits
 * DOCUMENTED, TILDE-ANCHORED DEFAULT literals
 * (`~/.local/state/engineering-orchestrator/**`,
 * `~/.cache/engineering-orchestrator/**`) in its compiled capability-deny
 * lists — phase 03 (engine-core) has no dependency edge to phase 04
 * (journal) per the roadmap graph, so it cannot import
 * `resolveStateRoot`/`resolveCacheRoot` and instead hardcodes the XDG
 * spec's own unset-env-var defaults. Those literals are STATIC STRINGS with
 * NO `process.env.XDG_*` read, so under the READ-based rule they are not
 * flagged even without an allowlist entry. The explicit entry remains as a
 * defensive escape hatch (and to document the seam); each entry must carry
 * an inline rationale and is kept honest by the last test below.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, "..", "..", "..", "..");
const PACKAGES_DIR = join(REPO_ROOT, "packages");

/** Every entry MUST carry an inline rationale comment — see file-level doc comment's "DOCUMENTED SEAM" section. */
const XDG_ALLOWLISTED_RELATIVE_PATHS: readonly string[] = [
  // packages/engine-core/src/compiler/xdg-default-paths.ts: confirmed by
  // direct read (2026-07-18) — this file's ONLY XDG-related runtime values
  // are `~`-anchored literal fallbacks with NO `process.env.XDG_*` read
  // anywhere in the file. Under the READ-based rule it would not be flagged
  // regardless; the entry documents the phase-03->phase-04 no-import-edge seam
  // (roadmap/03, interface-ledger Gap 14).
  "packages/engine-core/src/compiler/xdg-default-paths.ts",
];

const NAMESPACE_LITERAL = "engineering-orchestrator";
/**
 * An actual READ of the XDG env vars: `process.env.XDG_STATE_HOME`,
 * `process.env["XDG_CACHE_HOME"]`, etc. A file that only names the variable
 * in prose, a re-export, or an `XdgEnv` object-literal key does NOT match.
 */
const XDG_ENV_READ_PATTERN = /process\.env(?:\s*\[\s*["'`]|\.)\s*(?:XDG_STATE_HOME|XDG_CACHE_HOME)/;

function listProductionTsFilesRecursive(dir: string): string[] {
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
      out.push(...listProductionTsFilesRecursive(full));
    } else if (entry.isFile() && entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) {
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
      for (const file of listProductionTsFilesRecursive(srcDir)) {
        const rel = relative(REPO_ROOT, file);
        if (XDG_ALLOWLISTED_RELATIVE_PATHS.includes(rel)) continue;

        const content = readFileSync(file, "utf8");
        const hasNamespaceLiteral = content.includes(NAMESPACE_LITERAL);
        const readsXdgEnv = XDG_ENV_READ_PATTERN.test(content);
        if (hasNamespaceLiteral && readsXdgEnv) {
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
    const readsXdgEnv = XDG_ENV_READ_PATTERN.test(fakeReimplementation);
    expect(hasNamespaceLiteral && readsXdgEnv).toBe(true);
  });

  it("sanity: a correct importer that only MENTIONS the env var (doc comment, re-export, XdgEnv fixture key) is NOT flagged", () => {
    // The exact shape 05/07's layout modules take: import the resolver from
    // @eo/journal, mention `$XDG_STATE_HOME` in prose, never read the env var.
    const correctImporter = `
      import { resolveStateRoot, type XdgEnv } from "@eo/journal";
      // nests under 04's pinned $XDG_STATE_HOME/engineering-orchestrator/<hash>/ root
      export const fixture: XdgEnv = { HOME: "/h", XDG_STATE_HOME: "/s" };
      export function dir(env: XdgEnv, h: string) { return resolveStateRoot(env, h); }
    `;
    const hasNamespaceLiteral = correctImporter.includes(NAMESPACE_LITERAL);
    const readsXdgEnv = XDG_ENV_READ_PATTERN.test(correctImporter);
    expect(hasNamespaceLiteral && readsXdgEnv).toBe(false);
  });

  it("sanity: a tilde-anchored literal default with no XDG env-var read does NOT trigger the check (the engine-core seam)", () => {
    const tildeDefault = `export const DEFAULT_STATE_DENY_ROOT = "~/.local/state/engineering-orchestrator/**";`;
    const hasNamespaceLiteral = tildeDefault.includes(NAMESPACE_LITERAL);
    const readsXdgEnv = XDG_ENV_READ_PATTERN.test(tildeDefault);
    expect(hasNamespaceLiteral && readsXdgEnv).toBe(false);
  });

  it("keeps every allowlisted file honest: none of them actually reads process.env.XDG_STATE_HOME/XDG_CACHE_HOME (only mentions the names in prose/literals)", () => {
    // Guards the allowlist itself against silently covering a REAL future
    // reimplementation slipped into an already-allowlisted file — an
    // allowlist entry is only valid for a file with NO env-var READ, only
    // a literal/prose mention of the variable names.
    for (const rel of XDG_ALLOWLISTED_RELATIVE_PATHS) {
      const content = readFileSync(join(REPO_ROOT, rel), "utf8");
      expect(
        XDG_ENV_READ_PATTERN.test(content),
        `allowlisted file "${rel}" now reads XDG env vars directly — remove it from the allowlist and let the check flag it`,
      ).toBe(false);
    }
  });
});
