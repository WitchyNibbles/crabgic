// Deliberately UNSAFE toy writer (roadmap/04-journal-idempotency-leases.md
// work item 7: "build a deliberately unsafe toy writer (buffered, no
// fsync) whose corruption the harness detects"). Overwrites an existing
// file IN PLACE, at offset 0, with no fsync and no temp-file + rename. If
// killed between the two writes below, the target file ends up containing
// the FIRST HALF of the new content followed by the SECOND HALF of the
// old content — neither valid prior state nor valid new state: a torn
// file. This corruption is directly OS-visible (no reboot/power-loss
// simulation needed) because a plain `write(2)` at a given file offset
// lands in the kernel page cache immediately, visible to any other reader,
// regardless of fsync — fsync only matters for durability across power
// loss, not for visibility to a `verify()` step run moments later.
//
// Plain ESM JavaScript (no TypeScript): this file never imports this
// package's own `.ts` sources, so it sidesteps the type-stripping/
// NodeNext-resolution gap `../lease-fixtures/prepare-runtime.ts` documents
// and works under plain `node` with zero flags on this repo's pinned
// Node version.
import { closeSync, openSync, writeSync } from "node:fs";

const target = process.env["EO_KILL_HARNESS_TARGET"];
const newContent = process.env["EO_KILL_HARNESS_NEW"] ?? "";
if (!target) {
  process.stderr.write("unsafe-writer: missing EO_KILL_HARNESS_TARGET\n");
  process.exit(2);
}

const marker = "__EO_KILL_HARNESS_FAULT__:";
function signal(name) {
  process.stdout.write(`${marker}${name}\n`);
}
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const half = Math.floor(newContent.length / 2);
const firstHalf = newContent.slice(0, half);
const secondHalf = newContent.slice(half);

const fd = openSync(target, "r+");
signal("before-write");
await sleep(250);

writeSync(fd, firstHalf, 0, "utf8");
signal("half-written");
await sleep(250);

writeSync(fd, secondHalf, firstHalf.length, "utf8");
closeSync(fd);
process.exit(0);
