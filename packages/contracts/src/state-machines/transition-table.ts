/**
 * Shared, reusable state-machine primitives used by both the run-lifecycle
 * and `WorkUnitAttemptStatus` closed unions (roadmap/02, work items 2-3).
 * Kept generic so both machines share one error class and one pure
 * transition-function shape instead of duplicating the logic — no
 * mutation anywhere: `transition()` is a pure function of
 * `(current, next) -> next state` (or a thrown error); it never mutates a
 * shared state object.
 */

/** Thrown by a generated transition function when `to` is not reachable from `from`. */
export class IllegalTransitionError<S extends string> extends Error {
  readonly machine: string;
  readonly from: S;
  readonly to: S;

  constructor(machine: string, from: S, to: S) {
    super(`${machine}: illegal transition from "${from}" to "${to}"`);
    this.name = "IllegalTransitionError";
    this.machine = machine;
    this.from = from;
    this.to = to;
  }
}

/** An adjacency list: for each state, the set of states directly reachable from it. */
export type TransitionTable<S extends string> = Readonly<Record<S, readonly S[]>>;

/**
 * Builds a pure transition function for a closed state union. Returns the
 * next state on a legal transition; throws `IllegalTransitionError`
 * otherwise. Never mutates `table` or any external state.
 */
export function createTransitionFn<S extends string>(
  machine: string,
  table: TransitionTable<S>,
): (current: S, next: S) => S {
  return function transition(current: S, next: S): S {
    const allowed = table[current];
    if (!allowed.includes(next)) {
      throw new IllegalTransitionError(machine, current, next);
    }
    return next;
  };
}

/** True when `state` has no declared outgoing transitions in `table`. */
export function isAbsorbing<S extends string>(table: TransitionTable<S>, state: S): boolean {
  return table[state].length === 0;
}
