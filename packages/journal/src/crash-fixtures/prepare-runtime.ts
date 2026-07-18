import { dirname as pathDirname, join } from "node:path";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

/**
 * Generalized sibling of `../lease-fixtures/prepare-runtime.ts` (see that
 * file's doc comment for the full rationale: Node's native TypeScript
 * stripping cannot resolve NodeNext `.js`-specifier sibling imports for a
 * directly-spawned `.ts` entry script, and a full `tsc -b packages/journal`
 * build is deliberately avoided so this fixture runtime never depends on
 * unrelated sibling files elsewhere in the package typechecking cleanly).
 *
 * This module differs from the lease one only in being parameterized over
 * an arbitrary list of relative source paths (including subdirectories —
 * `codec/`, `layout/`, `store/`) rather than a fixed flat list, because the
 * crash suite's fixture entry script (`append-chain-snapshot-operation.ts`)
 * needs the real append/snapshot dependency closure, not just three
 * sibling files in one directory.
 */

const FIXTURES_DIR = dirname(fileURLToPath(import.meta.url));
const SRC_DIR = join(FIXTURES_DIR, "..");
const SCRATCH_ROOT = join(SRC_DIR, "..", "dist");

/**
 * The exact dependency closure `append-chain-snapshot-operation.ts` needs
 * to run for real: the append path (`store/append-entry.ts` and
 * everything it imports) plus the snapshot path (`store/snapshot-io.ts`
 * and everything IT imports, including `store/query-entries.ts` — pulled
 * in transitively even though this fixture never calls `recover()` itself,
 * because `snapshot-io.ts` imports it at module-load time).
 *
 * VALIDATION ROUND (2026-07-18) fix, MAJOR 1: `snapshot-io.ts`'s `recover`
 * now calls the orchestrated `repairJournal` (`store/repair-journal.ts`)
 * BEFORE replaying — a top-level import `snapshot-io.ts` needs resolvable
 * at MODULE LOAD time regardless of whether this fixture ever calls
 * `recover()` itself, so `repair-journal.ts`'s own transitive closure
 * (`repair-chain.ts`, `verify-journal.ts`, `verify-chain.ts`) is now
 * included too — previously deliberately excluded (with `retention-gc.ts`/
 * `journal-store.ts`, still excluded) because nothing in the fixture's
 * dependency closure imported them.
 */
export const CRASH_SUITE_SOURCE_FILES = [
  "codec/error-message.ts",
  "codec/hash-chain.ts",
  "codec/journal-entry.ts",
  "codec/journal-payloads.ts",
  "codec/ndjson-codec.ts",
  "kill-harness.ts",
  "layout/xdg-layout.ts",
  "store/append-entry.ts",
  "store/durable-io.ts",
  "store/fs-port.ts",
  "store/query-entries.ts",
  "store/repair-chain.ts",
  "store/repair-journal.ts",
  "store/segment-layout.ts",
  "store/snapshot-io.ts",
  "store/store-config.ts",
  "store/verify-chain.ts",
  "store/verify-journal.ts",
] as const;

/**
 * Files colocated in `crash-fixtures/` itself that the entry script imports
 * (e.g. `./signaling-fs-port.js`) — transpiled into the SAME output
 * subdirectory as the entry file, alongside it, so that relative import
 * resolves. Distinct from `CRASH_SUITE_SOURCE_FILES` (which are all
 * relative to `src/`, one level up).
 */
export const CRASH_SUITE_LOCAL_FIXTURE_FILES = ["signaling-fs-port.ts"] as const;

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
  await mkdir(pathDirname(outPath), { recursive: true });
  await writeFile(outPath, outputText, "utf8");
}

/**
 * Transpiles `sourceFiles` (paths relative to `src/`, erasure only) plus
 * `entryFileName` (resolved relative to `crash-fixtures/`) into a fresh
 * temp directory that mirrors `src/`'s own directory layout, so every
 * relative `"../store/foo.js"`-style import — unchanged by transpilation —
 * resolves exactly as it does in the real source tree. Returns the
 * transpiled entry file's path (ready to `spawn(process.execPath,
 * [entryPath, ...args])`) and a `cleanup()` callers must always invoke.
 */
export async function prepareCrashSuiteRuntime(
  entryFileName: string,
  sourceFiles: readonly string[] = CRASH_SUITE_SOURCE_FILES,
  localFixtureFiles: readonly string[] = CRASH_SUITE_LOCAL_FIXTURE_FILES,
): Promise<FixtureRuntime> {
  await mkdir(SCRATCH_ROOT, { recursive: true });
  const dir = await mkdtemp(join(SCRATCH_ROOT, "eo-crash-fixture-"));
  await writeFile(join(dir, "package.json"), JSON.stringify({ type: "module" }), "utf8");

  for (const file of sourceFiles) {
    await transpileOneFile(join(SRC_DIR, file), join(dir, file.replace(/\.ts$/, ".js")));
  }
  const fixturesOutDir = join(dir, "crash-fixtures");
  await mkdir(fixturesOutDir, { recursive: true });
  for (const file of localFixtureFiles) {
    await transpileOneFile(
      join(FIXTURES_DIR, file),
      join(fixturesOutDir, file.replace(/\.ts$/, ".js")),
    );
  }
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
