---
"crabgic": minor
---

Record what a run costs, because nothing was.

The engine reports usage on every result — `WorkerResult.usage` carries
`turnsUsed` and `totalCostUsd`, normalized from the SDK's own `total_cost_usd` —
and **nothing wrote it down**. The system knew what each attempt cost for exactly
as long as that attempt was in memory, and a finished run could never answer
"what did that cost me". For a product that spends the owner's own subscription,
that is the number they actually feel.

Usage now rides the terminal `work_unit_transition` entry, and `crabgic status
<run-id>` renders it under the progress line:

```
run d1b0858c-…: running (changeSet 1111…, updated 2026-07-30T00:44:34Z)
  work units seen: 3 succeeded · 1 running · 1 failed
  spent so far:    47 turns · $2.18
```

Carried on the existing entry rather than a new journal type, because
`JournalEntryType` is a closed union and ledger Gap 5's ruling is to reuse it.
Optional at every level, so every entry written before the field existed stays
valid — an attempt the engine reported no usage for is not an error, it is an
attempt nobody measured.

Two distinctions the implementation refuses to blur:

- **Spend sums every attempt, not the latest status per unit.** A work unit that
  failed twice before succeeding cost all three attempts, and a figure that
  forgot the failures would understate the one thing being watched.
- **No reported cost renders as nothing, never `$0.00`.** `undefined` and zero
  mean different things: one is "nobody measured it", the other claims the run
  was free.

This is the groundwork a spend _budget_ needs. The ceiling itself is not here:
that belongs on the `AuthorizationEnvelope`, which is the security keystone, so a
new field has to be accounted for by the compiler and the containment check or it
becomes an unchecked dimension — the exact class of hole a recent review found
elsewhere.
