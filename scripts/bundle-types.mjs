// Generates the published package's self-contained type declarations.
//
// WHY BUNDLED DECLARATIONS. `packages/cli` is published alone; the 16
// workspace packages it is built from are `private: true` and never reach the
// registry. `tsc` emits per-file declarations that reference `@crabgic/*`
// types by module specifier, which resolve inside this monorepo and resolve
// NOWHERE for an installing user — the same defect the runtime had before
// `bundle-cli.mjs`, in type space. `dts-bundle-generator` inlines every
// referenced type into one file whose only remaining imports are `node:*` and
// `zod` (both real dependencies of the published package).
//
// WHY IT IS CACHED. The generator type-checks the entire transitive project
// to do this, which takes ~5 minutes and does not get meaningfully faster
// with a non-composite config (measured: 323s vs 318s). `npm run build` runs
// in several CI jobs, so paying that every time would add ~25 minutes to a
// CI round for an artifact that changes only when the sources do. The output
// is therefore regenerated only when it is older than the newest input, and
// `--force` overrides that.
//
// The staleness check spans EVERY workspace package's `src`, not just
// `packages/cli`'s: the declarations inline types from all of them, so a
// change in `@crabgic/contracts` invalidates this artifact just as surely as
// a change in the CLI's own barrel.

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PACKAGES_DIR = join(REPO_ROOT, "packages");
// NOT written straight into `dist`: `tsc -b` runs before this and emits its
// own `dist/index.d.ts` (a barrel of `export * from "./errors.js"` relative
// re-exports). That would clobber the bundled file AND refresh its mtime, so
// the staleness check below would then declare the cache current while
// holding tsc's output — which `check-install-smoke.mjs` caught as
// "Cannot find module './exit-codes.js'" from an installed consumer.
// `bundle-cli.mjs` copies this cached artifact into `dist` after it wipes.
const OUTPUT = join(PACKAGES_DIR, "cli", ".dts-cache", "index.d.ts");
const ENTRY = join(PACKAGES_DIR, "cli", "src", "index.ts");

/** Newest mtime across every workspace package's TypeScript sources. */
function newestSourceMtime() {
  let newest = 0;
  function walk(dir) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === "node_modules" || entry.name === "dist") continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith(".ts")) {
        newest = Math.max(newest, statSync(full).mtimeMs);
      }
    }
  }
  for (const pkg of readdirSync(PACKAGES_DIR, { withFileTypes: true })) {
    if (!pkg.isDirectory()) continue;
    const src = join(PACKAGES_DIR, pkg.name, "src");
    if (existsSync(src)) walk(src);
  }
  return newest;
}

// PROGRESS GOES TO STDERR, never stdout. These scripts run as
// packages/cli's `prepack`, so `npm pack --dry-run --json` captures whatever
// they print on stdout and hands it to `JSON.parse` —
// `scripts/check-published-tarball.mjs` died with
// `Unexpected token 'b', "bundle-typ"... is not valid JSON` when this wrote
// there. Build chatter is diagnostics, not output.
const force = process.argv.includes("--force");
if (!force && existsSync(OUTPUT) && statSync(OUTPUT).mtimeMs >= newestSourceMtime()) {
  process.stderr.write("bundle-types: up to date (pass --force to regenerate)\n");
  process.exit(0);
}

process.stderr.write(
  "bundle-types: regenerating declarations (~5 min; cached until sources change)\n",
);
mkdirSync(dirname(OUTPUT), { recursive: true });
execFileSync(
  "npx",
  [
    "dts-bundle-generator",
    "--project",
    join(PACKAGES_DIR, "cli", "tsconfig.dts.json"),
    "--no-check",
    "-o",
    OUTPUT,
    ENTRY,
  ],
  { cwd: REPO_ROOT, stdio: "inherit" },
);
process.stderr.write(`bundle-types: wrote ${OUTPUT}\n`);
