#!/usr/bin/env node
// Phase 01, work item 5 — asserts every required top-level repo-hygiene
// artifact exists and is non-empty. Run with:
//   node scripts/check-repo-hygiene.mjs
import { statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

const REQUIRED_FILES = [
  "LICENSE",
  "NOTICE",
  "SECURITY.md",
  "CONTRIBUTING.md",
  "CODE_OF_CONDUCT.md",
  "README.md",
  ".github/PULL_REQUEST_TEMPLATE.md",
  ".github/ISSUE_TEMPLATE/bug_report.md",
  ".github/ISSUE_TEMPLATE/feature_request.md",
];

let failed = false;

for (const rel of REQUIRED_FILES) {
  const abs = path.join(root, rel);
  let stat;
  try {
    stat = statSync(abs);
  } catch {
    console.error(`check-repo-hygiene: MISSING — ${rel}`);
    failed = true;
    continue;
  }
  if (!stat.isFile()) {
    console.error(`check-repo-hygiene: NOT A FILE — ${rel}`);
    failed = true;
    continue;
  }
  if (stat.size === 0) {
    console.error(`check-repo-hygiene: EMPTY — ${rel}`);
    failed = true;
    continue;
  }
  console.log(`check-repo-hygiene: OK — ${rel} (${stat.size} bytes)`);
}

if (failed) {
  console.error("check-repo-hygiene: FAIL — one or more required files missing/empty.");
  process.exit(1);
}

console.log("check-repo-hygiene: PASS — all required top-level files exist and are non-empty.");
