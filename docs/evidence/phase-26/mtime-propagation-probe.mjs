#!/usr/bin/env node
/**
 * DOES A DIRECTORY'S MTIME MOVE WHEN SOMETHING BENEATH IT CHANGES?
 *
 * The stale-dist research record's Q4 turns on the answer. An earlier draft
 * proposed comparing a package's `src` root mtime against its `dist` root
 * mtime; that only works if a nested edit propagates up. It does not.
 *
 * This probe exists because the numbers in Q4 were originally read during a
 * session and logged nowhere — the same epistemic category as the incident
 * mtimes the record's own warning box discloses, but NOT covered by it
 * (round 4, completeness lens). Unlike those, this one is reproducible in
 * under a second, so the honest fix is to make it reproducible rather than
 * to disclose it as unreproducible.
 *
 * Run:  node docs/evidence/phase-26/mtime-propagation-probe.mjs
 * Exits non-zero if the behaviour the record relies on does not hold.
 */
import { mkdtempSync, mkdirSync, writeFileSync, statSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const root = mkdtempSync(join(tmpdir(), "mtime-probe-"));
const nested = join(root, "src", "nested");
mkdirSync(nested, { recursive: true });
const f = join(nested, "f.ts");
writeFileSync(f, "export const a = 1;\n");

/** Whole seconds: the record's claim is about second-granularity comparison. */
const mtime = (p) => Math.floor(statSync(p).mtimeMs / 1000);

/** Busy-wait past a second boundary so a genuine change cannot be hidden by granularity. */
const pastNextSecond = () => {
  const until = Math.ceil(Date.now() / 1000) * 1000 + 1100;
  while (Date.now() < until) {
    /* spin — sleeping here would need a timer and this runs once */
  }
};

const before = mtime(root);

pastNextSecond();
writeFileSync(f, "export const a = 2;\n");
const afterEdit = mtime(root);
const fileAfterEdit = mtime(f);

pastNextSecond();
writeFileSync(join(nested, "g.ts"), "export const b = 3;\n");
const afterAdd = mtime(root);

rmSync(root, { recursive: true, force: true });

/**
 * Assumption 1 of the record also claims mtime ORDERING is meaningful here at
 * second granularity. That was an uncited "measured:" parenthetical until
 * round 6's assumption-audit lens caught it, so it is asserted here too:
 * two consecutive writes separated by more than a second must produce
 * strictly increasing whole-second mtimes.
 */
const orderingRoot = mkdtempSync(join(tmpdir(), "mtime-order-"));
const h = join(orderingRoot, "h.ts");
writeFileSync(h, "export const c = 1;\n");
const firstWrite = mtime(h);
pastNextSecond();
writeFileSync(h, "export const c = 2;\n");
const secondWrite = mtime(h);
rmSync(orderingRoot, { recursive: true, force: true });

const rows = [
  ["root-mtime before", before],
  ["root-mtime after editing src/nested/f.ts", afterEdit],
  ["root-mtime after ADDING src/nested/g.ts", afterAdd],
  ["file-mtime after the edit", fileAfterEdit],
  ["ordering: first write", firstWrite],
  ["ordering: second write, >1s later", secondWrite],
];
for (const [label, value] of rows) console.log(`${label.padEnd(40)}: ${value}`);

const failures = [];
if (afterEdit !== before) failures.push("root mtime MOVED on a nested edit");
if (afterAdd !== before) failures.push("root mtime MOVED when a file was added two levels down");
if (fileAfterEdit <= before) failures.push("the edited file's own mtime did not move");
if (secondWrite <= firstWrite) {
  failures.push(
    `mtime ordering is NOT meaningful at second granularity here ` +
      `(${firstWrite} then ${secondWrite}) - the whole comparison is unusable`,
  );
}

if (failures.length > 0) {
  console.error(`\nFAIL — the record's Q4 relies on behaviour that did not hold here:`);
  for (const line of failures) console.error(`  - ${line}`);
  process.exit(1);
}
console.log("\nPASS - a root mtime is blind to every change beneath its immediate entry list.");
