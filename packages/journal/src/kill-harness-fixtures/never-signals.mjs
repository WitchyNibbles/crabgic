// Plumbing fixture: exits cleanly without ever emitting a fault-point
// marker — models an operation whose fault points don't apply to a given
// requested name (e.g. a caller passed a fault point the operation never
// reaches). Exercises runKillHarness's "natural-exit" (killedAt) path.
process.stdout.write("done, no fault points signalled\n");
process.exit(0);
