// Shared verdict-block helper for all spikes/0N-*.mjs probe scripts.
// Format per roadmap/00-engine-spikes.md work item 1:
//   { probe, expectation, observed, verdict: "PASS" | "FAIL" | "UNRESOLVED" }
//
// Each script prints one line of human-readable output plus one compact JSON
// line per verdict (for machine parsing into docs/engine-baseline.md), and
// can dump the full set to a JSON file at the end via writeVerdicts().

import { writeFileSync } from "node:fs";

const VALID = new Set(["PASS", "FAIL", "UNRESOLVED"]);

export function verdict({ probe, expectation, observed, verdict: v, note }) {
  if (!VALID.has(v)) {
    throw new Error(`invalid verdict "${v}" for probe "${probe}" (must be PASS|FAIL|UNRESOLVED)`);
  }
  const entry = { probe, expectation, observed, verdict: v, ...(note ? { note } : {}) };
  console.log(`\n[${v}] ${probe}`);
  console.log(`  expectation: ${expectation}`);
  console.log(`  observed:    ${observed}`);
  if (note) console.log(`  note:        ${note}`);
  console.log(`VERDICT_JSON ${JSON.stringify(entry)}`);
  return entry;
}

export function writeVerdicts(path, entries) {
  writeFileSync(path, JSON.stringify(entries, null, 2) + "\n", "utf8");
}

// grep-style check for token-shaped substrings; used before any fixture or
// verdict-dump file is left on disk. Returns array of {file, match} hits.
export function scanForSecrets(text) {
  const patterns = [
    { name: "sk-ant token", re: /sk-ant-[a-zA-Z0-9_-]{10,}/g },
    { name: "oauth access/refresh token blob", re: /"(accessToken|refreshToken)"\s*:\s*"[^"]{10,}"/g },
    { name: "$HOME path leak", re: new RegExp(process.env.HOME.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g") },
  ];
  const hits = [];
  for (const { name, re } of patterns) {
    const m = text.match(re);
    if (m) hits.push({ name, count: m.length });
  }
  return hits;
}

export function summarizeExit(res) {
  return `exit=${res.code ?? "null"} signal=${res.signal ?? "null"}`;
}
