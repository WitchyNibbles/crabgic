#!/usr/bin/env node
// Asserts the publishable tarball contains what it should and nothing it
// shouldn't. Run with:
//   node scripts/check-published-tarball.mjs
//
// WHY THIS EXISTS (2026-07-25): `packages/cli` (the one package intended for
// publication — see docs/release-notes-prep.md) declared `files: ["dist"]`,
// and because the TypeScript build deliberately compiles `*.test.ts` too (so
// tests are type-checked under the same strict settings as source), every
// compiled test landed in the tarball. That was 252 of 514 files — 49% of the
// package, ~600 kB unpacked — shipped to consumers who can never run them.
//
// Nothing caught it: `e2e/release`'s packRunner compares tarball BYTES for
// reproducibility but never inspects the file list. This guard does.
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

/** The package that actually gets published; every other workspace is `private: true`. */
const PUBLISHABLE_PACKAGE_DIR = fileURLToPath(new URL("../packages/cli", import.meta.url));

/** Paths that must be present — the module entry, the CLI binary, and the supervisor daemon binary. */
const REQUIRED_PATHS = [
  "package.json",
  "dist/index.js",
  "dist/index.d.ts",
  "dist/bin.js",
  "dist/bin/supervisord.js",
];

/** Anything matching these must NOT ship. */
const FORBIDDEN_PATTERNS = [
  { label: "compiled test files", test: (p) => /(^|\/)[^/]*\.test\.[^/]+$/.test(p) },
  { label: "test-support fixtures", test: (p) => p.includes("/test-support/") },
  { label: "TypeScript sources", test: (p) => p.endsWith(".ts") && !p.endsWith(".d.ts") },
];

function packFileList() {
  const raw = execFileSync("npm", ["pack", "--dry-run", "--json"], {
    encoding: "utf8",
    cwd: PUBLISHABLE_PACKAGE_DIR,
    stdio: ["ignore", "pipe", "ignore"],
    maxBuffer: 32 * 1024 * 1024,
  });
  const [tarball] = JSON.parse(raw);
  if (tarball === undefined || !Array.isArray(tarball.files)) {
    throw new Error("check-published-tarball: could not read `npm pack --json` output");
  }
  return { paths: tarball.files.map((file) => file.path), unpackedSize: tarball.unpackedSize };
}

const { paths, unpackedSize } = packFileList();
const problems = [];

for (const required of REQUIRED_PATHS) {
  if (!paths.includes(required)) {
    problems.push(`MISSING required path: ${required}`);
  }
}

for (const { label, test } of FORBIDDEN_PATTERNS) {
  const offenders = paths.filter((path) => test(path));
  if (offenders.length > 0) {
    problems.push(
      `${offenders.length} ${label} would be published, e.g.: ${offenders.slice(0, 3).join(", ")}`,
    );
  }
}

if (problems.length > 0) {
  console.error("check-published-tarball: FAIL");
  for (const problem of problems) console.error(`  - ${problem}`);
  console.error(
    "\nFix by adjusting the `files` field in the offending package.json " +
      '(negation patterns work: "!dist/**/*.test.*").',
  );
  process.exit(1);
}

console.log(
  `check-published-tarball: PASS — ${paths.length} files, ` +
    `${Math.round(unpackedSize / 1024)} kB unpacked, no tests/sources included.`,
);
