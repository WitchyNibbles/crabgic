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
import { readFileSync } from "node:fs";
import { join, posix } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

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
  // `tsc -b`'s incremental build STATE. `bundle-cli.mjs` deliberately keeps it
  // on disk between builds (it is what makes rebuilds incremental), and
  // `files: ["dist"]` swept it into the tarball as a side effect: 199 kB,
  // 15% of the published package, of no use whatsoever to a consumer. Worse,
  // it is the one file that differs between two builds of identical sources
  // in different environments, so shipping it makes the published artifact
  // non-reproducible — directly undermining roadmap/23's reproducible-build
  // criterion. Shipped in 1.0.0 through 1.1.1.
  { label: "incremental build state", test: (p) => p.endsWith(".tsbuildinfo") },
];

// ---------------------------------------------------------------------------
// EVERY DECLARED `bin` TARGET MUST SURVIVE NPM'S OWN NORMALIZER UNCHANGED.
//
// WHY THIS EXISTS (2026-08-07). The v1.6.0 publish log carried two lines of the
// form `"bin[crabgic]" script name dist/bin.js was invalid and removed`. Nothing
// was removed — measured three ways: `npm view crabgic@1.6.0 bin`,
// `@1.5.0` and `@1.0.0` all return both keys; the shipped tarballs' own
// `package/package.json` carries both; and `package-lock.json` independently
// records npm's normalized form. The message is an upstream mislabel:
// `@npmcli/package-json/lib/normalize.js` (npm 11.16.0, lines 65-72) pushes that
// string when the NORMALIZED target differs from the written one, interpolates
// the NEW value as the thing that "was invalid", and assigns it on the very next
// line. What triggered it here was the leading `./` on both targets.
//
// The narrow fix — dropping the `./` — is a two-line manifest edit, and asserting
// the literal `"dist/bin.js"` back would be a tautology over a value one line
// away (verification-playbook vacuity pattern #1). So the assertion here is the
// GENERAL invariant instead: a declared target that npm's normalizer rewrites is
// a target npm will emit that warning for, whichever key it belongs to and
// whenever it is added. That is a tripwire; the literal is not.
//
// NOT a claim that anything is broken. Both forms install identically. This
// guards the publish log staying legible, which is the channel a real "removed"
// would have to be noticed on.
// ---------------------------------------------------------------------------

/**
 * npm's `unixifyPath`, transcribed from
 * `@npmcli/package-json/lib/normalize.js:127-129` (npm 11.16.0).
 *
 * NOTE FOR A LATER AUDITOR: that path is OUTSIDE this repository — it is the
 * globally-installed npm's own bundled dependency, not a file here. It is
 * transcribed rather than imported because this script must run with nothing
 * but the workspace install, and `@npmcli/package-json` is not a dependency of
 * this repository at any depth it could rely on.
 */
export function unixifyPath(ref) {
  return ref.replace(/\\|:/g, "/");
}

/**
 * npm's `secureAndUnixifyPath`, transcribed from
 * `@npmcli/package-json/lib/normalize.js:131-134` (npm 11.16.0). Returns the
 * form npm will actually store for a declared `bin` target.
 *
 * npm calls the platform `path.join`; this uses `posix.join` explicitly. On
 * every runner this repository builds on the two are the same function, and on
 * a Windows host the platform join would introduce backslashes that
 * `unixifyPath` has just finished removing — so posix is both deterministic and
 * the behaviour npm means. Recorded because it is a deliberate divergence in
 * the transcription, not an oversight.
 */
export function secureAndUnixifyPath(ref) {
  const secured = unixifyPath(posix.join(".", posix.join("/", unixifyPath(ref))));
  return secured.startsWith("./") ? "" : secured;
}

/**
 * Every `bin` entry whose declared target npm's normalizer would rewrite, as
 * `{ key, declared, normalized }`. Empty for a manifest npm leaves alone.
 *
 * A non-string or absent `bin` yields `[]` — npm has its own handling for those
 * shapes and this check makes no claim about them.
 */
export function nonNormalizedBinTargets(manifest) {
  const bin = manifest?.bin;
  if (typeof bin !== "object" || bin === null || Array.isArray(bin)) return [];
  const offenders = [];
  for (const [key, declared] of Object.entries(bin)) {
    if (typeof declared !== "string") continue;
    const normalized = secureAndUnixifyPath(declared);
    if (normalized !== declared) offenders.push({ key, declared, normalized });
  }
  return offenders;
}

/** Reads the publishable package's manifest — the one whose `bin` map npm normalizes at publish. */
export function readPublishableManifest(packageDir = PUBLISHABLE_PACKAGE_DIR) {
  return JSON.parse(readFileSync(join(packageDir, "package.json"), "utf8"));
}

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

function runTarballChecks() {
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

  for (const { key, declared, normalized } of nonNormalizedBinTargets(readPublishableManifest())) {
    problems.push(
      `bin[${key}] declares ${JSON.stringify(declared)}, which npm's own normalizer rewrites ` +
        `to ${JSON.stringify(normalized)} — publish will log ` +
        `\`"bin[${key}]" script name ${normalized} was invalid and removed\` (nothing is actually ` +
        `removed; the message is an upstream mislabel). Declare the normalized form.`,
    );
  }

  if (problems.length > 0) {
    console.error("check-published-tarball: FAIL");
    for (const problem of problems) console.error(`  - ${problem}`);
    console.error(
      "\nFix by adjusting the `files` field in the offending package.json " +
        '(negation patterns work: "!dist/**/*.test.*").',
    );
    return 1;
  }

  console.log(
    `check-published-tarball: PASS — ${paths.length} files, ` +
      `${Math.round(unpackedSize / 1024)} kB unpacked, no tests/sources included, ` +
      `every declared bin target already in npm's normalized form.`,
  );
  return 0;
}

/* c8 ignore start — entry point; the exported checks above are what the suite drives. */
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(runTarballChecks());
}
/* c8 ignore stop */
