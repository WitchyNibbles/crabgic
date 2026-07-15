#!/usr/bin/env node
// Phase 01, work item 6 — asserts docs/release-notes-prep.md exists and
// records a timestamped `npm view engineering-orchestrator` availability
// verdict. Run with:
//   node scripts/check-release-notes.mjs
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const docPath = path.join(root, "docs", "release-notes-prep.md");

let contents;
try {
  contents = readFileSync(docPath, "utf8");
} catch {
  console.error(`check-release-notes: MISSING — ${docPath}`);
  process.exit(1);
}

if (contents.trim().length === 0) {
  console.error("check-release-notes: FAIL — docs/release-notes-prep.md is empty.");
  process.exit(1);
}

// Require: mention of the exact package name, an ISO-8601-ish UTC timestamp,
// and one of the two possible verdict words.
const hasPackageName = /engineering-orchestrator/.test(contents);
const hasTimestamp = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z/.test(contents);
const hasVerdict = /\b(available|taken)\b/i.test(contents);

if (!hasPackageName || !hasTimestamp || !hasVerdict) {
  console.error(
    "check-release-notes: FAIL — docs/release-notes-prep.md exists but is missing a recorded, timestamped npm-name verdict.",
  );
  console.error(
    `  hasPackageName=${hasPackageName} hasTimestamp=${hasTimestamp} hasVerdict=${hasVerdict}`,
  );
  process.exit(1);
}

console.log(
  "check-release-notes: PASS — docs/release-notes-prep.md records a timestamped npm-name verdict.",
);
