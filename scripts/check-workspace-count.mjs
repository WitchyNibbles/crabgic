#!/usr/bin/env node
// Phase 01, work item 1 — asserts the npm workspace enumeration returns
// exactly 18 entries (the packages/ Gap-3 roster). Run with:
//   node scripts/check-workspace-count.mjs
import { execFileSync } from "node:child_process";

const EXPECTED = 18;

function listWorkspaces() {
  let raw;
  try {
    raw = execFileSync("npm", ["ls", "--workspaces", "--json"], {
      encoding: "utf8",
      cwd: new URL("..", import.meta.url),
    });
  } catch (err) {
    // npm ls exits non-zero on some workspace states (e.g. before any
    // package.json exists) but still writes JSON to stdout — recover it.
    if (err.stdout) {
      raw = err.stdout;
    } else {
      console.error("check-workspace-count: failed to invoke npm ls --workspaces --json");
      console.error(err.message);
      process.exit(1);
    }
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    console.error("check-workspace-count: npm ls did not return parseable JSON:");
    console.error(raw);
    process.exit(1);
  }
  return parsed;
}

const parsed = listWorkspaces();
const dependencies = parsed && typeof parsed === "object" ? (parsed.dependencies ?? {}) : {};
const names = Object.keys(dependencies);
const count = names.length;

console.log(`check-workspace-count: found ${count} workspace(s):`);
for (const name of names) {
  console.log(`  - ${name}`);
}

if (count !== EXPECTED) {
  console.error(
    `check-workspace-count: FAIL — expected exactly ${EXPECTED} workspaces, found ${count}.`,
  );
  process.exit(1);
}

console.log(`check-workspace-count: PASS — exactly ${EXPECTED} workspaces declared.`);
