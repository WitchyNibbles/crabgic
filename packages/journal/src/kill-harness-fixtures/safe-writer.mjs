// Safe counterpart to unsafe-writer.mjs (roadmap/04 work item 7: "a safe
// counterpart it passes"). Writes the new content to a TEMP file, fsyncs
// it, then atomically rename()s it over the target — matching this
// package's own snapshot/lease convention (write -> fsync -> rename). If
// killed at any point before the rename, the target file is completely
// untouched (still its prior valid content); the target is NEVER observed
// mid-write, because the write only ever happens to a temp path the
// target's own readers never look at.
import { closeSync, fsyncSync, openSync, renameSync, writeSync } from "node:fs";

const target = process.env["EO_KILL_HARNESS_TARGET"];
const newContent = process.env["EO_KILL_HARNESS_NEW"] ?? "";
if (!target) {
  process.stderr.write("safe-writer: missing EO_KILL_HARNESS_TARGET\n");
  process.exit(2);
}

const marker = "__EO_KILL_HARNESS_FAULT__:";
function signal(name) {
  process.stdout.write(`${marker}${name}\n`);
}
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const tmpPath = `${target}.tmp-${process.pid}`;
const half = Math.floor(newContent.length / 2);
const firstHalf = newContent.slice(0, half);
const secondHalf = newContent.slice(half);

const fd = openSync(tmpPath, "w");
signal("before-write");
await sleep(250);

writeSync(fd, firstHalf, 0, "utf8");
signal("half-written");
await sleep(250);

writeSync(fd, secondHalf, firstHalf.length, "utf8");
fsyncSync(fd);
closeSync(fd);
renameSync(tmpPath, target);
process.exit(0);
