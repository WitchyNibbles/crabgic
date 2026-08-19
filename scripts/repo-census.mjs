#!/usr/bin/env node
// A census of what exists in this repository, and — the point of it — where the
// repository's several enumerations of itself DISAGREE. Run with:
//   node scripts/repo-census.mjs            # human summary
//   node scripts/repo-census.mjs --json     # machine-readable
//
// WHY THIS EXISTS (2026-08-19). A research record spent TEN review rounds
// designing an mtime staleness check while `scripts/bundle-types.mjs:70`
// already implemented one, and answered Q2 "nothing already detects it". The
// search space had been narrowed to `packages/cli/src/doctor/checks/` and
// `check:all` by plausible convention, and nothing ever compared that space to
// the claim. One unscoped `grep -ln mtime` over tracked files returns EIGHT
// hits with `bundle-types.mjs` among them, and was available in round 1.
//
// WHY NOT AN INDEX. Every off-the-shelf index scopes itself by a rule, and here
// each candidate rule is the rule that hid the file. Measured, not argued:
// `scip-typescript` indexes this repo in 22s producing 1501 documents and ZERO
// `.mjs` files, because it is driven by the TypeScript `Program` and `scripts/`
// appears in none of the 28 tsconfigs. An import graph never reaches
// `bundle-types.mjs` either — it is invoked by the shell string
// `"bundle:types": "node scripts/bundle-types.mjs"`, which is not a module edge.
// Adding a scoped index to fix a scope failure rebuilds the failure behind a
// new boundary, and adds an authoritative-looking surface to trust.
//
// SO THIS DOES NOT INDEX ANYTHING. It runs several INDEPENDENT enumerations —
// git, the filesystem, npm workspaces, the root `tsc -b` reference graph, every
// tsconfig on disk, and path-shaped strings in npm scripts and workflows — and
// reports where they disagree. A region no enumeration claims is where a blind
// spot lives. There is no published technique for telling an agent its search
// space omitted a region (context precision/recall all need a known gold set),
// so the disagreement list is the closest available coverage signal.
//
// ⚠️ NOT COMMITTED, BY DESIGN. Its output is generated on demand and never
// stored. A committed census becomes one more build artifact with its own
// staleness problem — the exact defect class that motivated it — and a stale
// census gives a CONFIDENTLY WRONG enumeration, which is strictly worse than an
// obviously incomplete one.
//
// Dependency-free on purpose: `meta-checks` runs `npm ci` with no build step,
// the same constraint `scripts/citation-content/file-index.mjs` documents.
import { readdirSync, readFileSync, existsSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));

/** Extensions that are program text — the population a "does anything do X" claim ranges over. */
export const SOURCE_EXTENSIONS = Object.freeze([
  ".ts",
  ".tsx",
  ".mts",
  ".cts",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
]);

const isSource = (path) => SOURCE_EXTENSIONS.some((ext) => path.endsWith(ext));

/**
 * `tsconfig.json` is the file the project graph keys on. `tsconfig.base.json`
 * and `tsconfig.dts.json` are build INPUTS that are a project in nobody's
 * graph — and the base is extended by all 19 units from the repo root, outside
 * every unit's `src/`, so one edit to it changes every build while moving
 * nothing a src-walk observes. Counting them as projects would be wrong;
 * ignoring them was this file's own first blind spot, found by comparing the
 * census's tsconfig count against `find -name 'tsconfig*.json'`.
 */
export function isProjectTsconfig(basename) {
  return basename === "tsconfig.json";
}

export function isVariantTsconfig(basename) {
  return (
    basename.startsWith("tsconfig.") && basename.endsWith(".json") && !isProjectTsconfig(basename)
  );
}

/**
 * Repo-relative paths mentioned as STRINGS — how a shell-invoked script is
 * reached when no module edge exists. Requires a `/` and a trailing extension,
 * so bare words, flags and version ranges do not qualify.
 */
const PATH_TOKEN = /[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)+/g;

export function pathShapedStrings(text) {
  const found = new Set();
  for (const match of String(text).matchAll(PATH_TOKEN)) {
    const token = match[0].replace(/^\.\//, "");
    if (!/\.[A-Za-z0-9]+$/.test(token)) continue;
    found.add(token);
  }
  return [...found];
}

/**
 * The DEEPEST listed directory that contains `path`, or undefined. Compares on a
 * trailing separator so `packages/cli` is not an ancestor of `packages/cli-extra`
 * — a prefix bug here would silently mark an unclaimed file as claimed, which is
 * the failure this whole file exists to stop.
 */
export function nearestAncestorDir(path, dirs) {
  let best;
  for (const dir of dirs) {
    if (!path.startsWith(`${dir}/`)) continue;
    if (best === undefined || dir.length > best.length) best = dir;
  }
  return best;
}

/**
 * The disagreements. Each key answers "which enumeration failed to claim this",
 * and every value is a list a reader can act on directly.
 */
export function computeDisagreements(input) {
  const {
    diskFiles = [],
    trackedFiles = [],
    workspaceDirs = [],
    rootReferenceDirs = [],
    tsconfigDirs = [],
    namedPaths = new Map(),
    variantConfigFiles = [],
    ignoredOnDisk = [],
  } = input;

  const tracked = new Set(trackedFiles);
  // Everything physically present — tracked, untracked AND ignored. A named
  // build artifact is on disk even though git ignores it, and asking the
  // filtered set instead reported four such artifacts as missing.
  const onDisk = new Set([...diskFiles, ...ignoredOnDisk]);
  const workspaces = new Set(workspaceDirs);
  const referenced = new Set(rootReferenceDirs);

  const sourceClaimedByNothing = [];
  const claimedOnlyByString = [];
  for (const path of trackedFiles) {
    if (!isSource(path)) continue;
    if (nearestAncestorDir(path, tsconfigDirs) !== undefined) continue;
    const namedBy = namedPaths.get(path);
    if (namedBy && namedBy.length > 0) {
      claimedOnlyByString.push({ path, namedBy });
      continue;
    }
    sourceClaimedByNothing.push(path);
  }

  const namedButMissing = [];
  for (const [path, namedBy] of namedPaths) {
    if (!onDisk.has(path)) namedButMissing.push({ path, namedBy });
  }

  return {
    // A tsconfig exists but the root `tsc -b` graph does not reference it, so
    // anything derived from the root graph — scip included — cannot see it.
    tsconfigNotInRootGraph: tsconfigDirs.filter((dir) => !referenced.has(dir)),
    // Referenced as a build unit but not an npm workspace member, so a
    // `packages/*` enumeration omits it. This is `e2e/report`.
    referencedButNotWorkspace: rootReferenceDirs.filter((dir) => !workspaces.has(dir)),
    // A workspace the root build graph does not reference.
    workspaceNotReferenced: workspaceDirs.filter((dir) => !referenced.has(dir)),
    // Program text that no tsconfig contains and no script names. This is
    // `scripts/` before anything names it: the founding blind spot.
    sourceClaimedByNothing,
    // Reachable, but only by a string in a script or workflow — invisible to
    // every import graph and every type-driven index.
    claimedOnlyByString,
    // A script or workflow names a path that is not on disk.
    namedButMissing,
    // Build inputs that are a project in no graph — `tsconfig.base.json` and
    // friends. Every unit extends the base, so it is an input to every build
    // and a member of none.
    configInputsOutsideProjectGraph: [...variantConfigFiles],
    // Present, not tracked, not ignored.
    onDiskUntracked: diskFiles.filter((path) => !tracked.has(path)),
  };
}

/* ------------------------------------------------------------------ *
 * Real enumerations. Each is deliberately derived from a DIFFERENT
 * source, because two enumerations that share a source cannot disagree.
 * ------------------------------------------------------------------ */

/**
 * git resolves WHICH repository it operates on from these before it consults
 * the working directory, and it exports `GIT_DIR` into every hook it runs —
 * including this repo's `pre-push`. A census run from a hook would enumerate
 * whatever repository the hook was aimed at and report it as this one: a
 * confidently wrong enumeration, which is the exact failure this file exists to
 * prevent. Demonstrated rather than assumed — with `GIT_DIR` aimed at a
 * nonexistent path, `git ls-files` fails outright.
 *
 * Mirrors `@crabgic/git-engine`'s `GIT_LOCATION_ENV_VARS`, duplicated rather
 * than imported for the same reason `packages/cli/src/installer/git-repo-state.ts`
 * duplicates it: this script must stay dependency-free, because `meta-checks`
 * runs `npm ci` with no build step and there is no `dist` to import from.
 */
const GIT_LOCATION_ENV_VARS = Object.freeze([
  // `git rev-parse --local-env-vars`, git 2.43.0.
  "GIT_ALTERNATE_OBJECT_DIRECTORIES",
  "GIT_CONFIG",
  "GIT_CONFIG_PARAMETERS",
  "GIT_CONFIG_COUNT",
  "GIT_OBJECT_DIRECTORY",
  "GIT_DIR",
  "GIT_WORK_TREE",
  "GIT_IMPLICIT_WORK_TREE",
  "GIT_GRAFT_FILE",
  "GIT_INDEX_FILE",
  "GIT_NO_REPLACE_OBJECTS",
  "GIT_REPLACE_REF_BASE",
  "GIT_PREFIX",
  "GIT_INTERNAL_SUPER_PREFIX",
  "GIT_SHALLOW_FILE",
  "GIT_COMMON_DIR",
]);

export function censusGitEnv(source = process.env) {
  const env = { ...source };
  for (const name of GIT_LOCATION_ENV_VARS) delete env[name];
  return env;
}

const runGit = (args, cwd) =>
  execFileSync("git", args, {
    cwd,
    env: censusGitEnv(),
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  })
    .split("\n")
    .filter(Boolean);

export function enumerateGit(cwd = REPO_ROOT) {
  return {
    // Literal argv at each call site, not a forwarded variable: that is what
    // lets `git-spawn-hygiene.test.ts` classify these as read-only instead of
    // assuming they mutate. The forwarded-variable shape it flags is exactly
    // how this file was first written, and how both original offenders were.
    trackedFiles: runGit(["ls-files"], cwd),
    // `node_modules` is not part of this repository's own surface, and leaving
    // it in inflates the ignored count from 7833 to 28804 — a number that reads
    // as a finding and is not one.
    ignoredFiles: runGit(["ls-files", "-o", "-i", "--exclude-standard"], cwd).filter(
      (path) => !path.includes("node_modules/"),
    ),
  };
}

const SKIP_DIRS = new Set(["node_modules", ".git"]);

export function enumerateDisk(cwd = REPO_ROOT) {
  const files = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue;
        walk(join(dir, entry.name));
      } else if (entry.isFile()) {
        files.push(relative(cwd, join(dir, entry.name)).split(sep).join("/"));
      }
    }
  };
  walk(cwd);
  return files;
}

export function enumerateWorkspaces(cwd = REPO_ROOT) {
  const pkg = JSON.parse(readFileSync(join(cwd, "package.json"), "utf8"));
  const dirs = [];
  for (const pattern of pkg.workspaces ?? []) {
    if (!pattern.endsWith("/*")) continue;
    const base = pattern.slice(0, -2);
    const baseDir = join(cwd, base);
    if (!existsSync(baseDir)) continue;
    for (const entry of readdirSync(baseDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      if (existsSync(join(baseDir, entry.name, "package.json"))) dirs.push(`${base}/${entry.name}`);
    }
  }
  return dirs.sort();
}

export function enumerateRootReferences(cwd = REPO_ROOT) {
  const raw = readFileSync(join(cwd, "tsconfig.json"), "utf8");
  // Comment-tolerant: tsconfig permits `//` and the file uses it.
  const stripped = raw.replace(/^\s*\/\/.*$/gm, "");
  const config = JSON.parse(stripped);
  return (config.references ?? [])
    .map((reference) => String(reference.path).replace(/^\.\//, "").replace(/\/$/, ""))
    .sort();
}

/**
 * Returns BOTH populations: the directories holding a project `tsconfig.json`
 * (excluding the root solution file, which references rather than compiles),
 * and the variant config files that are inputs to builds but projects in none.
 */
export function enumerateTsconfigs(cwd = REPO_ROOT) {
  const dirs = [];
  const variants = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue;
        walk(join(dir, entry.name));
        continue;
      }
      const rel = relative(cwd, dir).split(sep).join("/");
      if (isProjectTsconfig(entry.name)) {
        if (rel !== "") dirs.push(rel);
        continue;
      }
      if (isVariantTsconfig(entry.name)) {
        variants.push(rel === "" ? entry.name : `${rel}/${entry.name}`);
      }
    }
  };
  walk(cwd);
  return { tsconfigDirs: dirs.sort(), variantConfigFiles: variants.sort() };
}

/** path -> the places that name it, so a reader can go and look. */
export function enumerateNamedPaths(cwd = REPO_ROOT) {
  const named = new Map();
  const add = (path, source) => {
    if (!named.has(path)) named.set(path, []);
    const sources = named.get(path);
    if (!sources.includes(source)) sources.push(source);
  };

  const pkg = JSON.parse(readFileSync(join(cwd, "package.json"), "utf8"));
  for (const [name, body] of Object.entries(pkg.scripts ?? {})) {
    for (const path of pathShapedStrings(body)) add(path, `package.json:scripts.${name}`);
  }

  const workflowsDir = join(cwd, ".github", "workflows");
  if (existsSync(workflowsDir)) {
    for (const entry of readdirSync(workflowsDir)) {
      if (!entry.endsWith(".yml") && !entry.endsWith(".yaml")) continue;
      const text = readFileSync(join(workflowsDir, entry), "utf8");
      for (const path of pathShapedStrings(text)) add(path, `.github/workflows/${entry}`);
    }
  }
  return named;
}

export function runCensus(cwd = REPO_ROOT) {
  const { trackedFiles, ignoredFiles } = enumerateGit(cwd);
  const ignored = new Set(ignoredFiles);
  const { tsconfigDirs, variantConfigFiles } = enumerateTsconfigs(cwd);
  const diskFiles = enumerateDisk(cwd).filter((path) => !ignored.has(path));
  const input = {
    diskFiles,
    trackedFiles,
    workspaceDirs: enumerateWorkspaces(cwd),
    rootReferenceDirs: enumerateRootReferences(cwd),
    tsconfigDirs,
    variantConfigFiles,
    ignoredOnDisk: ignoredFiles,
    namedPaths: enumerateNamedPaths(cwd),
  };
  return {
    counts: {
      tracked: trackedFiles.length,
      ignoredOnDisk: ignoredFiles.length,
      workspaces: input.workspaceDirs.length,
      rootReferences: input.rootReferenceDirs.length,
      projectTsconfigsBelowRoot: input.tsconfigDirs.length,
      variantConfigs: variantConfigFiles.length,
      namedPaths: input.namedPaths.size,
    },
    disagreements: computeDisagreements(input),
  };
}

/* ----------------------------- CLI ----------------------------- */

const isMain =
  process.argv[1] && statSync(process.argv[1]).ino === statSync(fileURLToPath(import.meta.url)).ino;

if (isMain) {
  const census = runCensus();
  if (process.argv.includes("--json")) {
    const { disagreements } = census;
    process.stdout.write(
      `${JSON.stringify(
        {
          ...census,
          disagreements: {
            ...disagreements,
            claimedOnlyByString: disagreements.claimedOnlyByString,
            namedButMissing: disagreements.namedButMissing,
          },
        },
        null,
        2,
      )}\n`,
    );
    process.exit(0);
  }

  const { counts, disagreements } = census;
  const out = [];
  out.push("repo-census — enumerations, and where they disagree\n");
  out.push(
    `  tracked ${counts.tracked} · ignored-on-disk ${counts.ignoredOnDisk} · ` +
      `workspaces ${counts.workspaces} · root refs ${counts.rootReferences} · ` +
      `project tsconfigs below root ${counts.projectTsconfigsBelowRoot} · ` +
      `variant configs ${counts.variantConfigs} · string-named paths ${counts.namedPaths}\n`,
  );

  const LABELS = {
    tsconfigNotInRootGraph: "tsconfig exists but is NOT in the root tsc -b graph",
    referencedButNotWorkspace: "build unit referenced but NOT an npm workspace",
    workspaceNotReferenced: "workspace NOT referenced by the root build graph",
    sourceClaimedByNothing: "SOURCE claimed by no tsconfig and named by nothing",
    claimedOnlyByString: "reachable ONLY by a string in a script/workflow",
    configInputsOutsideProjectGraph: "build INPUT config that is a project in no graph",
    namedButMissing: "named by a script/workflow but NOT on disk",
    onDiskUntracked: "on disk, neither tracked nor ignored",
  };

  for (const [key, label] of Object.entries(LABELS)) {
    const rows = disagreements[key];
    out.push(`\n${rows.length === 0 ? "ok" : "!!"} ${label} — ${rows.length}`);
    for (const row of rows.slice(0, 40)) {
      out.push(
        typeof row === "string" ? `     ${row}` : `     ${row.path}  <- ${row.namedBy.join(", ")}`,
      );
    }
    if (rows.length > 40) out.push(`     ... and ${rows.length - 40} more`);
  }
  process.stdout.write(`${out.join("\n")}\n`);
}
