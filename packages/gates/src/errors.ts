/**
 * Typed errors for `@eo/gates` — roadmap/14-quality-security-gates.md's
 * "fail-closed everywhere" posture: every place this package refuses to
 * proceed does so with a named, catchable error type, never a bare
 * `Error`/string throw.
 */

/** Thrown by `../security/tool-resolution.ts`'s `resolveDigestPinnedTool` when 12's capability store has no entry at all for the named tool — fail CLOSED (never "no entry means allow"). */
export class MissingCapabilityEntryError extends Error {
  constructor(readonly toolName: string) {
    super(
      `gates: no digest-pinned capability-store entry found for tool "${toolName}" — refusing ` +
        `to run it (fail-closed; roadmap/14 §In scope, "Scanner binaries resolve as digest-pinned ` +
        `entries from 12's content-addressed capability store").`,
    );
    this.name = "MissingCapabilityEntryError";
  }
}

/** Thrown by `../security/tool-resolution.ts`'s `resolveDigestPinnedTool` when the observed digest no longer matches 12's pinned entry — mirrors 12's own unsigned-digest-swap vector; never runs a stale/tampered binary. */
export class ToolDigestMismatchError extends Error {
  constructor(
    readonly toolName: string,
    readonly expectedDigest: string,
    readonly observedDigest: string,
  ) {
    super(
      `gates: digest mismatch for tool "${toolName}" — pinned "${expectedDigest}", observed ` +
        `"${observedDigest}". Refusing to run a stale/tampered binary (fail-closed).`,
    );
    this.name = "ToolDigestMismatchError";
  }
}

/** Thrown by `../tdd-gate.ts`'s `captureRedBaseline` when called with `exitStatus === 0` — a "red" baseline that already passes proves nothing about the test's ability to catch a regression. */
export class RedBaselineNotFailingError extends Error {
  constructor(readonly requirementId: string) {
    super(
      `gates: captureRedBaseline called for requirement "${requirementId}" with a passing ` +
        `(exitStatus 0) result — a red baseline must genuinely fail before implementation exists.`,
    );
    this.name = "RedBaselineNotFailingError";
  }
}

/** Thrown by `../registry.ts` when `fireByTag`/`fireAll` is called for a tag with zero registered handlers and `requireAtLeastOne` is set — most callers should treat "nothing registered" as a no-op, but the final-candidate re-verification path (work item 6) wants to catch a mis-wired registry (e.g. `security` accidentally never populated) loudly. */
export class NoGatesRegisteredError extends Error {
  constructor(readonly tag: string) {
    super(
      `gates: fireByTag("${tag}") found zero registered handlers and requireAtLeastOne was set.`,
    );
    this.name = "NoGatesRegisteredError";
  }
}
