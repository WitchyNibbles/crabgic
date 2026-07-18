import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

/**
 * Why this exists: `lease.test.ts`'s two-real-child-process contention test
 * (roadmap/04-journal-idempotency-leases.md work item 6's exit-criterion
 * test) needs a REAL, separate OS process that imports and calls the
 * actual `Lease.acquire`. Node's native TypeScript type-stripping (verified
 * empirically against this repo's pinned Node 24.18.0 — `node child.ts`
 * importing a NodeNext-style `"./sibling.js"` specifier throws
 * `ERR_MODULE_NOT_FOUND` even under `--experimental-strip-types`, because
 * unlike `tsc`/bundlers it does NOT remap a `.js` specifier to a sibling
 * `.ts` file) cannot directly execute this package's `.ts` sources as a
 * child-process entry point once they import each other — which every
 * NodeNext-convention relative import in this codebase does.
 *
 * A full `tsc -b packages/journal` build was considered and rejected: it
 * compiles the WHOLE package as one project, so it can be broken by an
 * unrelated, in-progress sibling file another parallel worker adds
 * elsewhere in `packages/journal/src` (this package's own worker brief
 * warns of exactly that risk) — an isolated fixture-runtime step must not
 * depend on the rest of the package typechecking cleanly.
 *
 * The fix: `ts.transpileModule` erasure (single-file, no cross-file type
 * checking, so immune to sibling-file breakage) of exactly this module's
 * own known source files plus the given fixture entry file, written to a
 * fresh temp directory alongside a `{"type":"module"}` package.json (so
 * plain `.js` output is interpreted as ESM with no specifier rewriting
 * needed — source and output both keep the NodeNext-mandated `.js`
 * extension in relative imports). The temp directory is created UNDER
 * `packages/journal/dist/` (already `.gitignore`d as a build-output path)
 * rather than the OS temp dir, specifically so Node's node_modules
 * directory walk-up (starting from the executing file's own directory)
 * reaches this repo's real `node_modules` and resolves bare specifiers
 * like `zod` — an OS temp dir such as `/tmp` is outside the repo tree and
 * would fail that resolution. This is a narrow, deliberate exception to
 * this package's general "use `os.tmpdir()`" test convention: unlike a
 * lease-file test directory (data the module under test writes to), this
 * directory is purely a Node module-resolution scratch space.
 */

// VALIDATION ROUND (2026-07-18) fix: `lease.ts` was split into
// `lease-errors.ts` (typed error classes) and `lease-acquire.ts`
// (`tryAcquireOnce` and its private helpers) to stay under this repo's
// file-size convention after the MAJOR 2 self-defense fix — both are now
// part of `lease.ts`'s own real dependency closure and must be transpiled
// alongside it for this fixture's child process to resolve them.
const SOURCE_FILES = [
  "lease-record.ts",
  "lease-proc-stat.ts",
  "lease-errors.ts",
  "lease-acquire.ts",
  "lease.ts",
] as const;

const FIXTURES_DIR = dirname(fileURLToPath(import.meta.url));
const SRC_DIR = join(FIXTURES_DIR, "..");
const SCRATCH_ROOT = join(SRC_DIR, "..", "dist");

export interface FixtureRuntime {
  readonly dir: string;
  readonly entryPath: string;
  cleanup(): Promise<void>;
}

async function transpileOneFile(srcPath: string, outPath: string): Promise<void> {
  const source = await readFile(srcPath, "utf8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2023,
      verbatimModuleSyntax: true,
    },
    fileName: srcPath,
  });
  await writeFile(outPath, outputText, "utf8");
}

/**
 * Transpiles this module's fixed set of source files (erasure only, see
 * this file's doc comment above) plus `entryFileName` (resolved relative
 * to `src/lease-fixtures/`) into a fresh temp directory. Returns the
 * transpiled entry file's path (ready to `spawn(process.execPath,
 * [entryPath, ...args])`) and a `cleanup()` that removes the temp
 * directory — callers must always call it, including on test failure.
 */
export async function prepareFixtureRuntime(entryFileName: string): Promise<FixtureRuntime> {
  await mkdir(SCRATCH_ROOT, { recursive: true });
  const dir = await mkdtemp(join(SCRATCH_ROOT, "eo-lease-fixture-"));
  await writeFile(join(dir, "package.json"), JSON.stringify({ type: "module" }), "utf8");

  // Mirrors the real `src/` layout (source files directly under `dir/`,
  // the fixture entry under `dir/lease-fixtures/`) so the entry file's own
  // `"../lease.js"`-style relative import — unchanged by transpilation —
  // resolves correctly, exactly as it does in the real source tree.
  for (const file of SOURCE_FILES) {
    await transpileOneFile(join(SRC_DIR, file), join(dir, file.replace(/\.ts$/, ".js")));
  }
  const fixturesOutDir = join(dir, "lease-fixtures");
  await mkdir(fixturesOutDir, { recursive: true });
  const entryOutName = entryFileName.replace(/\.ts$/, ".js");
  await transpileOneFile(join(FIXTURES_DIR, entryFileName), join(fixturesOutDir, entryOutName));

  return {
    dir,
    entryPath: join(fixturesOutDir, entryOutName),
    cleanup: async () => {
      await rm(dir, { recursive: true, force: true });
    },
  };
}
