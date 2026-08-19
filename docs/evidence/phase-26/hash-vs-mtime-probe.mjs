#!/usr/bin/env node
/**
 * IS CONTENT HASHING TOO EXPENSIVE TO BE THE STALENESS ORACLE?
 *
 * Assumption 2 rejects content hashing. Its ORIGINAL reason — "costs far more
 * than the question is worth" — was uncited, and round 13 corrected it with a
 * measured table. That table was then itself uncited: no command, no script, no
 * artifact. It was the only measurement left in the record standing on session
 * memory, in a document whose own standing rule is *a count is a measurement
 * with a timestamp; the command is the reproducible part*. Round 14 caught it.
 *
 * ⚠️ AND THE NUMBERS WERE MISLABELLED. Round 13's figures were recorded as
 * "warm cache". Round 14 ran the same corpus four times and found they match its
 * FIRST, COLDEST run; on genuinely warm cache the ratio is nearer 1.1x than
 * 1.45x. That is the same critique round 13 levelled at round 13's own reviewer,
 * landing on round 13. Hence this probe reports EVERY run and its spread rather
 * than one figure.
 *
 * ⚠️ AND THE RESULT KILLED THE ARGUMENT ENTIRELY. Written to assert that
 * hashing is at least MORE EXPENSIVE than the walk — the weakest form of
 * assumption 2's original claim — this probe FAILED on its first run: across
 * four runs the ratio spanned 0.98x to 1.64x, and on the warmest run hashing was
 * CHEAPER. So cost does not discriminate between the two approaches at this
 * corpus size at all. Not "far more" (the original claim), not "1.45x more"
 * (round 13's correction), not even "more".
 *
 * The probe therefore asserts what is actually true and useful: the two are the
 * same ORDER of cost, so a design must choose between them on something else.
 * Assumption 2 now rests entirely on the argument that survives — hashing needs
 * somewhere to persist a baseline, and an mtime comparison does not.
 *
 * Run:  node docs/evidence/phase-26/hash-vs-mtime-probe.mjs
 */
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

const REPO_ROOT = fileURLToPath(new URL("../../..", import.meta.url));
const RUNS = 4;

/** The 19 build units, from `references` — assumption 4's enumeration, not `workspaces`. */
function referencedUnits() {
  const raw = readFileSync(join(REPO_ROOT, "tsconfig.json"), "utf8").replace(/^\s*\/\/.*$/gm, "");
  return JSON.parse(raw).references.map((r) => String(r.path).replace(/^\.\//, ""));
}

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

const units = referencedUnits();
const srcFiles = units.flatMap((u) => walk(join(REPO_ROOT, u, "src")));
const distFiles = units.flatMap((u) => walk(join(REPO_ROOT, u, "dist")));

const ms = (fn) => {
  const start = process.hrtime.bigint();
  fn();
  return Number(process.hrtime.bigint() - start) / 1e6;
};

console.log(
  `units ${units.length} · src files ${srcFiles.length} · src+dist ${srcFiles.length + distFiles.length}`,
);
console.log("run  stat(src)   sha256(src)   walk(src+dist)   hash/walk");

const ratios = [];
let bytes = 0;
for (let run = 1; run <= RUNS; run += 1) {
  const statOnly = ms(() => {
    for (const f of srcFiles) statSync(f);
  });
  let total = 0;
  const hash = ms(() => {
    for (const f of srcFiles) {
      const buf = readFileSync(f);
      total += buf.length;
      createHash("sha256").update(buf).digest();
    }
  });
  bytes = total;
  const walkBoth = ms(() => {
    for (const f of srcFiles) statSync(f);
    for (const f of distFiles) statSync(f);
  });
  const ratio = hash / walkBoth;
  ratios.push(ratio);
  console.log(
    `${String(run).padEnd(4)} ${statOnly.toFixed(1).padStart(6)} ms ${hash.toFixed(1).padStart(10)} ms ${walkBoth.toFixed(1).padStart(13)} ms ${ratio.toFixed(2).padStart(10)}x`,
  );
}

console.log(`\nsource bytes hashed: ${(bytes / 1e6).toFixed(1)} MB`);
console.log(
  `hash/walk ratio across ${RUNS} runs: min ${Math.min(...ratios).toFixed(2)}x, max ${Math.max(...ratios).toFixed(2)}x`,
);
console.log(
  "\nThe FIRST run is the coldest and the least representative; the spread is the honest answer.",
);

/**
 * The assertion is that the two are the SAME ORDER of cost — which is what makes
 * cost a non-argument. A band rather than a direction, because the direction was
 * measured to be unstable: hashing came out cheaper on the warmest run.
 */
const SAME_ORDER_LOW = 0.25;
const SAME_ORDER_HIGH = 4;
const sameOrder = ratios.every((r) => r > SAME_ORDER_LOW && r < SAME_ORDER_HIGH);

if (!sameOrder) {
  console.error(
    `\nFAIL - the hash/walk ratio left the ${SAME_ORDER_LOW}x-${SAME_ORDER_HIGH}x band, so cost may now genuinely discriminate between the two approaches and assumption 2 should be re-argued on it.`,
  );
  process.exit(1);
}
console.log(
  "\nPASS - hashing and the proposed walk are the same ORDER of cost, and which is faster moves with cache state. Cost therefore cannot decide between them, which is why assumption 2 rests on the persisted-baseline argument instead.",
);
