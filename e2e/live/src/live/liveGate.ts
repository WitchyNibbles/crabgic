/**
 * `@live`-gate primitive for this harness's own live conformance tests —
 * mirrors `packages/engine-claude/src/live/live-harness.ts`'s established
 * `CRABGIC_LIVE` convention (that module is package-internal, not part of
 * `@crabgic/engine-claude`'s public barrel, so this self-contained project owns
 * a minimal equivalent rather than deep-importing another package's
 * private test-support). Every `*.live.test.ts` file under this directory
 * calls this in `beforeAll` so the `engine-live`-style CI job goes RED
 * (never silently skips) without `CRABGIC_LIVE=1` set.
 */
export class LiveNotEnabledError extends Error {
  constructor() {
    super(
      'e2e/live/src/live: CRABGIC_LIVE is not "1" — live conformance tests fail RED rather than ' +
        "silently skip (roadmap/06's engine-live CI job convention). Set CRABGIC_LIVE=1 (and ensure real " +
        "Claude Code auth is resolvable) to run this suite for real.",
    );
    this.name = "LiveNotEnabledError";
  }
}

export function assertLiveEnabled(): void {
  if (process.env.CRABGIC_LIVE !== "1") {
    throw new LiveNotEnabledError();
  }
}
