// Bundles the published `crabgic` package.
//
// WHY THIS EXISTS. `packages/cli` is the ONE package this repository
// publishes — `scripts/check-published-tarball.mjs` says so in as many words
// ("The package that actually gets published; every other workspace is
// `private: true`"). But its compiled output imported 15 distinct
// `@crabgic/*` specifiers at runtime and declared 13 of them as
// dependencies, pinned `0.0.0`, none of which are published and none of
// which CAN be while private. `npm install crabgic` therefore failed with
// `404 Not Found - GET .../@crabgic%2fconnectors-grafana` — the package was
// uninstallable, and nothing in the 15-item release gate noticed: the
// tarball check inspects file CONTENTS, and reproducible-build compares
// tarball HASHES between two checkouts, equally blind on both sides. Only
// installing it into a clean project surfaces it, which is why
// `scripts/check-install-smoke.mjs` now does exactly that.
//
// The intent was always one published package; what was missing is a build
// that actually inlines the workspace code. This is that build.
//
// TWO CONSTRAINTS THIS SCRIPT EXISTS TO RESPECT:
//
// 1. THE FOUR EXTERNALS STAY REAL, and are installed rather than inlined.
//    `@anthropic-ai/claude-agent-sdk` cannot be inlined at all: it ships
//    `manifest.zst.json` + `extractFromBunfs.js` and unpacks a vendored
//    engine at runtime. It is also exact-pinned under roadmap/01's
//    `engine-pin-lint` policy, which `reproducible-build` re-asserts across
//    both clean checkouts, so inlining would destroy the pin the release must
//    record. `zod` stays external because schema identity matters — the SDK
//    and `@modelcontextprotocol/sdk` must see the SAME zod instance our
//    schemas were built with, or `instanceof` checks fail across the
//    boundary; a second inlined copy would silently break tool registration.
//
//    This list was only reachable after the repository moved to zod 4. While
//    it pinned zod 3, the SDK's `zod@^4` peer and a sibling `zod@3` in the
//    published manifest were unresolvable — `npm ci` failed with ERESOLVE,
//    and npm hoisted a second zod into `packages/cli/node_modules` that
//    shadowed v3 for the CLI's own imports and broke `tsc -b`.
//
// 2. THE LAZY ENGINE IMPORT MUST SURVIVE. `packages/cli/src/daemon/
//    lazy-run-dispatcher.ts` defers `import("./run-dispatcher.js")` to first
//    dispatch precisely so the supervisor daemon does not pull
//    `@crabgic/engine-claude` -> the Agent SDK into its boot graph; that is
//    worth ~41 MiB and is what keeps 05's <100 MiB idle-RSS budget met (the
//    daemon idles at ~66 MiB). A single-file bundle would inline that
//    dynamic import and blow the budget, so `--splitting` is load-bearing,
//    not stylistic: it keeps `run-dispatcher` in its own chunk that
//    `bin/supervisord.js` reaches only through a real `import()`.
//
// Determinism matters too — `reproducible-build` compares tarball hashes
// from two independent clean checkouts, so this must be a pure function of
// its inputs. esbuild is deterministic for a fixed version and input set,
// and the version is pinned as a devDependency rather than resolved from a
// range.

import { copyFile, cp, mkdir, readdir, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CLI_ROOT = join(REPO_ROOT, "packages", "cli");
const OUT_DIR = join(CLI_ROOT, "dist");

/**
 * Dependencies the published package declares and npm installs, rather than
 * inlining. Kept in step with `packages/cli/package.json` by
 * `scripts/check-install-smoke.mjs`, which fails if the bundle emits an
 * import for anything the manifest does not declare.
 */
export const EXTERNAL_DEPENDENCIES = [
  "@anthropic-ai/claude-agent-sdk",
  "@modelcontextprotocol/sdk",
  "zod",
  "zod-to-json-schema",
];

/**
 * Everything `@crabgic/plugin` distributes that is DATA rather than code.
 *
 * Deliberately an explicit list rather than "copy the package": `src/`,
 * `dist/`, `tsconfig.json` and `package.json` are build inputs and outputs,
 * and shipping them would both bloat the tarball and change what
 * `listPackagedFiles` (which excludes exactly those) considers packaged.
 * `.claude-plugin` is excluded from the content digest by design — it holds
 * `marketplace.json`, which CITES that digest — but the trust-pin check
 * still needs to read it, so it ships too.
 */
const PLUGIN_ASSET_ENTRIES = ["agents", "hooks", "skills", ".mcp.json", ".claude-plugin"];

async function main() {
  // Wipe everything EXCEPT the two artifacts this script does not own.
  //
  // `tsc -b` runs immediately before this and emits its own per-file output
  // across `dist/**` — output that imports `@crabgic/*` by specifier and must
  // not survive into the tarball. An earlier version of this cleanup removed
  // only top-level `*.js`, which left every nested directory behind;
  // `check-install-smoke.mjs` caught it by finding `@crabgic/journal`,
  // `vitest` and `fast-check` among the published imports.
  //
  // PRESERVED: `.tsbuildinfo`, which is `tsc -b`'s incremental state —
  // removing it would force a full recompile every time. The bundled
  // declarations are NOT preserved here; they are copied in fresh below from
  // `bundle-types.mjs`'s own cache, precisely because `tsc -b` overwrites
  // `dist/index.d.ts` on every build.
  const KEEP = new Set([".tsbuildinfo"]);
  const existing = await readdir(OUT_DIR, { withFileTypes: true }).catch(() => []);
  await Promise.all(
    existing
      .filter((entry) => !KEEP.has(entry.name))
      .map((entry) => rm(join(OUT_DIR, entry.name), { recursive: true, force: true })),
  );

  const result = await build({
    entryPoints: [
      join(CLI_ROOT, "src", "index.ts"),
      join(CLI_ROOT, "src", "bin.ts"),
      join(CLI_ROOT, "src", "bin", "supervisord.ts"),
    ],
    outdir: OUT_DIR,
    outbase: join(CLI_ROOT, "src"),
    bundle: true,
    platform: "node",
    target: "node24",
    format: "esm",
    // See constraint (2) above — this is what keeps the daemon's idle RSS
    // inside 05's budget.
    splitting: true,
    external: EXTERNAL_DEPENDENCIES,
    // Node needs the shebang preserved on the executables.
    banner: { js: "" },
    logLevel: "info",
    metafile: true,
  });

  // The self-contained declarations `bundle-types.mjs` produced. Copied
  // rather than generated here so the ~5-minute generation stays cached and
  // out of the hot path.
  const cachedTypes = join(CLI_ROOT, ".dts-cache", "index.d.ts");
  if (!existsSync(cachedTypes)) {
    throw new Error(
      `missing ${cachedTypes} — run \`npm run bundle:types\` before bundling (the build script ` +
        "orders them correctly; this only happens when bundle:cli is invoked on its own).",
    );
  }
  await copyFile(cachedTypes, join(OUT_DIR, "index.d.ts"));

  // THE PLUGIN'S DATA ASSETS, which are not code and cannot be bundled.
  //
  // `@crabgic/plugin` is a private workspace package, so bundling inlines its
  // JS and the published tarball would otherwise contain none of the FILES it
  // exists to distribute: `.mcp.json`, the two subagents, the hooks, the five
  // skills, and the `.claude-plugin/marketplace.json` the trust-pin check
  // reads. `crabgic install` copies those into a consuming project and
  // `crabgic doctor` verifies them, so without them the published package
  // cannot do the one thing an operator installs it for.
  //
  // This was shipped broken in 1.0.0: `crabgic doctor` in a real consuming
  // repo died with `Cannot find module '@crabgic/plugin/package.json'`,
  // because `resolvePluginSourceDir` resolved a workspace package that does
  // not exist outside this monorepo. The smoke check missed it by probing
  // only the argument parser, never a real command; it now runs `doctor`.
  //
  // Copied rather than symlinked, and kept byte-identical to the source, so
  // `computeContentDigest` over the installed copy equals the digest
  // `marketplace.json` records — the trust pin compares exactly that.
  const pluginRoot = join(REPO_ROOT, "packages", "plugin");
  const pluginOut = join(OUT_DIR, "plugin");
  await mkdir(pluginOut, { recursive: true });
  for (const entry of PLUGIN_ASSET_ENTRIES) {
    await cp(join(pluginRoot, entry), join(pluginOut, entry), { recursive: true });
  }

  const emitted = Object.keys(result.metafile.outputs).length;
  process.stderr.write(`bundle-cli: emitted ${String(emitted)} file(s) into packages/cli/dist\n`);
}

await main();
