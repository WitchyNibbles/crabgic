/// <reference types="node" />
import { existsSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { GATEWAY_MCP_SERVER_NAME } from "./server-name.js";

/**
 * `GATEWAY_MCP_SERVER_NAME` tests (roadmap/02 work item 7; interface-
 * ledger Gap 11). Two things are proven here:
 *  1. The golden value: the literal is exactly `"crabgic_gateway"`.
 *  2. The sole-definition-site exit criterion: a read-only, deterministic
 *     scan of every TRACKED file under `packages/` — the scope the
 *     criterion names — proves the literal `"crabgic_gateway"` appears
 *     nowhere outside `ALLOWLIST`, whose every non-definition entry names
 *     a test proving that occurrence is DERIVED from the constant.
 */

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const LITERAL = "crabgic_gateway";

/**
 * The sole-definition-site allowlist.
 *
 * Every entry carries a REASON, and every non-definition reason names the
 * test that proves the file is derived from `GATEWAY_MCP_SERVER_NAME`
 * rather than hand-typed. Those named files are asserted to exist, so
 * deleting a derivation test breaks this scan instead of silently leaving
 * an unjustified exemption behind — an allowlist nobody checks is how a
 * sole-definition-site scan goes vacuous.
 */
interface AllowlistEntry {
  /** Why this file may contain the literal. */
  readonly reason: string;
  /**
   * The file that proves this occurrence is DERIVED from the constant.
   * `undefined` only for the definition site itself and for prose.
   */
  readonly derivedBy?: string;
}

const ALLOWLIST = new Map<string, AllowlistEntry>([
  [
    join("packages", "contracts", "src", "gateway", "server-name.ts"),
    { reason: "the definition site itself" },
  ],
  [
    join("packages", "contracts", "src", "gateway", "server-name.test.ts"),
    { reason: "this golden-value test, which necessarily quotes the literal" },
  ],
  // Generated artifacts. Each is regenerated from the constant by the
  // named test, so the literal in them is derived output, not a second
  // declaration.
  ...(
    [
      "network-granted.sdk-call.json",
      "read-only.sdk-call.json",
      "standard-implementation.sdk-call.json",
    ] as const
  ).map(
    (name) =>
      [
        join("packages", "engine-claude", "goldens", name),
        {
          reason: "generated golden artifact",
          derivedBy: join(
            "packages",
            "engine-core",
            "src",
            "goldens",
            "generate-golden-artifacts.test.ts",
          ),
        },
      ] as const,
  ),
  ...(
    [
      "network-granted.sdk-options.json",
      "network-granted.settings.json",
      "read-only.sdk-options.json",
      "read-only.settings.json",
      "standard-implementation.sdk-options.json",
      "standard-implementation.settings.json",
    ] as const
  ).map(
    (name) =>
      [
        join("packages", "engine-core", "goldens", name),
        {
          reason: "generated golden artifact",
          derivedBy: join(
            "packages",
            "engine-core",
            "src",
            "goldens",
            "generate-golden-artifacts.test.ts",
          ),
        },
      ] as const,
  ),
  // The shipped plugin's project-scope MCP manifest. Hand-written JSON, so
  // it cannot import the constant — instead it is pinned byte-for-byte
  // against `buildGatewayMcpServerEntry()` by the named test, which is what
  // converts it from "a second hand-typed literal" into "provably derived".
  [
    join("packages", "plugin", ".mcp.json"),
    {
      reason: "shipped plugin MCP manifest, pinned against the constant",
      derivedBy: join("packages", "cli", "src", "installer", "mcp-entry.golden.test.ts"),
    },
  ],
  // Prose. Not a definition site and not executable; naming the wire value
  // in documentation is the point of the documentation.
  [
    join("packages", "engine-claude", "README.md"),
    { reason: "documentation naming the wire value" },
  ],
  [
    join("packages", "engine-claude", "src", "live", "fixtures", "stub-mcp-server.mjs"),
    { reason: "doc comment recording a live observation" },
  ],
]);

/**
 * Every TRACKED file under `packages/`, as repo-relative paths.
 *
 * `git ls-files` rather than a directory walk, deliberately. The criterion
 * is about what this repository CONTAINS, and a walk of the working tree
 * would also sweep up build output and untracked scratch files — which is
 * both noisy and, for `dist/`, guaranteed to contain the literal as
 * compiled output. It also removes the need to maintain a skip list.
 *
 * The previous implementation walked `packages/<pkg>/src/**\/*.ts` only,
 * which is narrower than the `packages/*` the criterion names: a hand-typed
 * literal in `packages/plugin/.mcp.json` sat outside it and the scan
 * reported clean.
 *
 * Binary-ish extensions are skipped — reading them as utf8 would be
 * meaningless, and none can carry a source-level declaration.
 */
const BINARY_EXTENSIONS = [".png", ".jpg", ".jpeg", ".gif", ".pdf", ".zip", ".gz", ".ico", ".woff"];

function trackedFilesUnderPackages(): readonly string[] {
  const stdout = execFileSync("git", ["ls-files", "-z", "--", "packages"], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  return stdout
    .split("\0")
    .filter((line) => line.length > 0)
    .filter((line) => !BINARY_EXTENSIONS.some((ext) => line.endsWith(ext)))
    .map((line) => join(...line.split("/")));
}

describe("GATEWAY_MCP_SERVER_NAME", () => {
  it('is the literal "crabgic_gateway" (golden value, interface-ledger Gap 11)', () => {
    expect(GATEWAY_MCP_SERVER_NAME).toBe("crabgic_gateway");
  });

  it("is the sole definition site of the literal under packages/ (exit criterion)", () => {
    const scanned = trackedFilesUnderPackages();

    // Anti-vacuity floor. A broken walk that scans nothing would otherwise
    // "prove" the absence. The repo has well over a thousand tracked files
    // under packages/; 500 is a floor, not an estimate.
    expect(scanned.length).toBeGreaterThan(500);

    const violations: Array<{ file: string; occurrences: number }> = [];
    let allowlistedHits = 0;

    for (const relPath of scanned) {
      const content = readFileSync(join(REPO_ROOT, relPath), "utf8");
      const occurrences = content.split(LITERAL).length - 1;
      if (occurrences === 0) continue;
      if (ALLOWLIST.has(relPath)) {
        allowlistedHits += 1;
        continue;
      }
      violations.push({ file: relPath, occurrences });
    }

    expect(violations).toEqual([]);

    // Second anti-vacuity floor, in the other direction: the scan must
    // actually be reading file CONTENT. If it were reading nothing, the
    // definition site itself would not be found either.
    expect(allowlistedHits).toBeGreaterThanOrEqual(ALLOWLIST.size);
  });

  it("scans the non-.ts, non-src files the previous scope silently skipped", () => {
    // Regression pin for the scope defect this scan was widened to fix. The
    // earlier walk covered only `packages/*/src/**/*.ts`, so the shipped
    // plugin manifest — a hand-typed `.mcp.json` outside any `src/` — was
    // invisible to a check whose criterion says `packages/*`. If any of
    // these three shapes stops being scanned, the widening has been undone.
    const scanned = new Set(trackedFilesUnderPackages());
    expect(scanned.has(join("packages", "plugin", ".mcp.json"))).toBe(true);
    expect(scanned.has(join("packages", "engine-claude", "README.md"))).toBe(true);
    expect(
      scanned.has(
        join("packages", "engine-claude", "src", "live", "fixtures", "stub-mcp-server.mjs"),
      ),
    ).toBe(true);
  });

  it("every allowlisted derived file names a derivation test that exists", () => {
    let checkedDerivations = 0;
    for (const [path, entry] of ALLOWLIST) {
      expect(entry.reason.length).toBeGreaterThan(0);
      if (entry.derivedBy === undefined) continue;
      checkedDerivations += 1;
      expect(
        existsSync(join(REPO_ROOT, entry.derivedBy)),
        `${path} is allowlisted as derived by ${entry.derivedBy}, which does not exist`,
      ).toBe(true);
    }
    // Anti-vacuity: the loop must have checked something.
    expect(checkedDerivations).toBeGreaterThanOrEqual(10);
  });
});
