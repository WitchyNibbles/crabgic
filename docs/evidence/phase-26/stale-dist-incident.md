# Stale-dist incident — captured evidence, 2026-08-19

The measurements the research record cites. Captured after the fact from the
session that produced them, which is why each line says how it was obtained.

## 1. The build artifact was older than its source

```
$ ls -la packages/gates/dist/index.js packages/gates/src/coverage-gate-registration.ts
-rw-r--r-- 1 eimi eimi 7282 Aug 19 09:14 packages/gates/dist/index.js
-rw-r--r-- 1 eimi eimi 4648 Aug 18 21:57 packages/gates/src/coverage-gate-registration.ts
```

Captured NOW, after the rebuild that fixed it — so these mtimes are the repaired
state, not the failing one. The failing pair was `dist/index.js` at 21:37 against
`coverage-gate-registration.ts` at 21:46, read from the same command during the
incident. That original reading was NOT captured to a file at the time, and this
record does not pretend otherwise.

## 2. What the failure looked like

```
TypeError: registerCoverageGate is not a function
  ❯ composeGateRegistry src/daemon/compose-gate-registry.ts:416:3
```

One cause, 83 failing tests. Transcribed from the run output; the log files were
written to a session scratch directory that is not committed.

## 3. Reproducibility

Six consecutive full runs of `packages/cli` + `packages/gates` failed identically
before the rebuild; four passed after it. Counted from the loop's own per-run
summary lines during the session. Not logged to a committed file.

## ⚠️ What this artifact does and does not establish

It establishes the SHAPE of the failure — a stale `dist` makes the suite import a
build that predates the source, and the resulting failure is deterministic rather
than flaky. It does NOT let a reader re-derive the specific counts: the raw logs
were not committed, and the mtimes above are post-repair. Anyone citing the
numbers should cite them as reported-not-reproducible.
