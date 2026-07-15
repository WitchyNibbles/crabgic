#!/usr/bin/env node
// Phase 01, work item 7 — `engine-pin-lint`.
//
// Fails if any workspace package.json declares a `^`/`~`/range specifier
// for `@anthropic-ai/claude-agent-sdk` (or any other declared
// engine-bundling dependency, see ENGINE_BUNDLING_DEPENDENCIES below)
// instead of an exact, pinned semver version. This is the build-time
// "which SDK version is bundled" pin (adaptation §0's reproducible-bundled-
// engine decision) — distinct from and complementary to 06's runtime
// host-engine-version range gate.
//
// Usage:
//   node scripts/check-engine-pin.mjs                 # scans packages/*/package.json
//   node scripts/check-engine-pin.mjs <file> [<file>...]  # scans exact files (fixtures)
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { globSync } from "node:fs";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

// The set of dependencies subject to the exact-pin policy. Only the engine
// dependency itself (and any future engine-bundling dependency) is covered
// by this HARD rule — ordinary devDependencies are pinned by repo
// convention, not by this check.
const ENGINE_BUNDLING_DEPENDENCIES = ["@anthropic-ai/claude-agent-sdk"];

const DEPENDENCY_FIELDS = [
  "dependencies",
  "devDependencies",
  "peerDependencies",
  "optionalDependencies",
];

// An acceptable pin is an exact semver: MAJOR.MINOR.PATCH with optional
// prerelease/build metadata, and nothing else — no `^`, `~`, `>=`, `<=`,
// `>`, `<`, `*`, `x`, `||`, whitespace ranges, "latest", tags, or
// protocol specifiers (e.g. `workspace:*`, `npm:`, `git+https://`).
const EXACT_SEMVER = /^\d+\.\d+\.\d+(-[0-9A-Za-z-.]+)?(\+[0-9A-Za-z-.]+)?$/;

function findTargets(argv) {
  if (argv.length > 0) {
    return argv;
  }
  return globSync("packages/*/package.json", { cwd: root }).map((p) => path.join(root, p));
}

function checkManifest(filePath) {
  const raw = readFileSync(filePath, "utf8");
  let manifest;
  try {
    manifest = JSON.parse(raw);
  } catch (err) {
    return [`${filePath}: could not parse as JSON (${err.message})`];
  }

  const violations = [];
  for (const field of DEPENDENCY_FIELDS) {
    const deps = manifest[field];
    if (!deps || typeof deps !== "object") continue;
    for (const depName of ENGINE_BUNDLING_DEPENDENCIES) {
      if (!(depName in deps)) continue;
      const specifier = deps[depName];
      if (!EXACT_SEMVER.test(specifier)) {
        violations.push(
          `${filePath}: ${field}["${depName}"] = "${specifier}" is not an exact pin ` +
            `(no ^/~/range/wildcard/tag allowed — engine-bundling dependencies must be pinned exactly)`,
        );
      }
    }
  }
  return violations;
}

const targets = findTargets(process.argv.slice(2));

if (targets.length === 0) {
  console.log("engine-pin-lint: no package.json manifests found to check.");
  process.exit(0);
}

let allViolations = [];
for (const target of targets) {
  const violations = checkManifest(target);
  allViolations = allViolations.concat(violations);
}

if (allViolations.length > 0) {
  console.error("engine-pin-lint: FAIL");
  for (const v of allViolations) {
    console.error(`  - ${v}`);
  }
  process.exit(1);
}

console.log(
  `engine-pin-lint: PASS — checked ${targets.length} manifest(s), ` +
    `no range-specified engine-bundling dependency found ` +
    `(watched: ${ENGINE_BUNDLING_DEPENDENCIES.join(", ")}).`,
);
