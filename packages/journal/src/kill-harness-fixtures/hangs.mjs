// Plumbing fixture: signals its one fault point, then hangs forever
// instead of exiting — exercises runKillHarness's `spawnTimeoutMs`
// safety-kill path for a marker the harness (deliberately, for this test)
// is not told to react to.
const marker = "__EO_KILL_HARNESS_FAULT__:";
process.stdout.write(`${marker}unreached-by-harness\n`);
setInterval(() => {}, 60_000);
