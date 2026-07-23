#!/usr/bin/env node
/**
 * `engineering-orchestrator` executable entry point — roadmap/09-cli-and-
 * doctor.md §Interfaces produced item 1 (binary name), item 2 (typed UDS
 * client wiring), Gap 2 (`gateway mcp`'s exact stdio boot). This is the
 * ONLY file in this package that touches the real `process.stdout`/
 * `process.stderr`/`process.exit`/real sockets — it is a thin, intentionally
 * untested-by-design shim over `./cli-entry.ts`'s `runCliEntry` and
 * `./bootstrap.ts`'s `buildRealCliDependencies`, both of which carry every
 * branch of actual logic and ARE unit-tested.
 */
import { runCliEntry } from "./cli-entry.js";
import { buildRealCliDependencies } from "./bootstrap.js";
import { toErrorMessage } from "./errors.js";

runCliEntry(
  process.argv.slice(2),
  {
    writeStdout: (chunk) => process.stdout.write(chunk),
    writeStderr: (chunk) => process.stderr.write(chunk),
  },
  { buildDependencies: () => buildRealCliDependencies() },
)
  .then((exitCode) => {
    process.exitCode = exitCode;
  })
  .catch((err: unknown) => {
    process.stderr.write(`unexpected error: ${toErrorMessage(err)}\n`);
    process.exitCode = 1;
  });
