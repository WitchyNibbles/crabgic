#!/usr/bin/env node
/**
 * Advisory-only PostToolUse hook (roadmap/10-plugin-and-installer.md §In scope,
 * "advisory manager hooks"). Runs in the MANAGER's own interactive session
 * context, never the worker's compiled/blocking sandbox profile (03/06 own
 * those). NEVER blocks: this script always exits 0, no matter what it observes
 * or what error it hits reading its own input — a warning printed to stderr is
 * its only effect. Distinguishing itself from a blocking hook is the entire
 * point of this file; do not add an exit-2 path here.
 */
import { readFileSync, existsSync } from "node:fs";

function readStdin() {
  try {
    return readFileSync(0, "utf8");
  } catch {
    return "";
  }
}

function main() {
  const raw = readStdin();
  if (raw.trim().length === 0) return;

  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    return; // Advisory only — a malformed/absent payload is silently tolerated.
  }

  const filePath = payload?.tool_input?.file_path;
  if (typeof filePath !== "string" || filePath.length === 0) return;
  if (!existsSync(filePath)) return;

  let content;
  try {
    content = readFileSync(filePath, "utf8");
  } catch {
    return;
  }

  const warnings = [];
  if (content.includes("console.log(")) {
    warnings.push(
      `advisory: "${filePath}" contains console.log( — consider removing before commit`,
    );
  }
  if (content.length > 0 && !content.endsWith("\n")) {
    warnings.push(`advisory: "${filePath}" has no trailing newline`);
  }

  for (const warning of warnings) {
    process.stderr.write(`${warning}\n`);
  }
}

main();
process.exitCode = 0;
