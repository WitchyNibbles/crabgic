/**
 * `EnvelopeCompilationError` — thrown by `compileEnvelope`'s input-validation
 * helpers (`owned-path.ts`, `network-destination.ts`) when an
 * `AuthorizationEnvelope` field carries a value the compiler cannot safely
 * turn into a permission/sandbox rule ("Validate at system boundaries; fail
 * fast with clear error messages" — coding-style ground rule). Named
 * distinctly from `../footguns/invariants.ts`'s own error classes: those
 * assert POST-HOC properties of an already-compiled profile (used both to
 * guard the real compiler and to prove seeded mutation variants are
 * caught); this one is a PRE-COMPILATION input-rejection error, thrown by
 * the emitters themselves before a rule is ever constructed.
 */
export class EnvelopeCompilationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EnvelopeCompilationError";
  }
}
