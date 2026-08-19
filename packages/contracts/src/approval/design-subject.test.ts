import { describe, expect, it } from "vitest";
import { APPROVAL_TOKEN_SUBJECT_KINDS, designRevisionDigest } from "./token.js";

/**
 * ⚠️ THE DESIGN GATE'S TOKEN SUBJECT — owner ruling 2026-08-19, amending R2.
 *
 * R2 made `crabgic design approve` a CLI command precisely so that "nothing
 * reachable from a session may record this verdict"
 * (`packages/cli/src/commands/design-verdict-handler.ts`). The amendment keeps
 * that guarantee and changes only WHO CARRIES the human's act: a token the owner
 * mints at their own terminal, rather than a file the command writes directly.
 *
 * What that buys is auditability. A minted token is journaled as
 * `approval_token_mint` and claimed once through the durable ledger, so a design
 * approval becomes a first-class evidence artifact on the same footing as the
 * contract and capability approvals — instead of a write to
 * `design-verdicts.json` that leaves no trace of the act itself.
 *
 * MEASURED FIRST, and stated because it bounds the claim: this does NOT remove a
 * context switch. `design-verdict-handler.ts` calls `runApprovalFlow` zero
 * times, so today's approval is already one terminal command with no prompt. The
 * token flow is one command too. It is bought for the audit trail, not for
 * convenience, and nothing here should be read as claiming otherwise.
 */

describe("design_revision — the token subject the design gate binds to", () => {
  it("is a member of the subject-kind vocabulary", () => {
    expect(APPROVAL_TOKEN_SUBJECT_KINDS).toContain("design_revision");
  });

  /**
   * ⚠️ THE DIGEST BINDS BOTH HALVES, and that is the whole point of having one.
   * A token minted for revision 1 must not approve revision 2 — the design was
   * edited after the owner read it, which is exactly the window
   * `build-tool-registry.test.ts`'s "keeps refusing when the owner approved a
   * DIFFERENT design revision" case exists to close.
   */
  it("gives a different digest for a different revision of the same change set", () => {
    const one = designRevisionDigest("cs-1", "design-rev-1");
    const two = designRevisionDigest("cs-1", "design-rev-2");

    expect(one).not.toBe(two);
  });

  /** And a different change set at the same revision label is a different subject too. */
  it("gives a different digest for a different change set at the same revision", () => {
    expect(designRevisionDigest("cs-1", "r")).not.toBe(designRevisionDigest("cs-2", "r"));
  });

  it("is stable for the same pair, so a mint and a later verify agree", () => {
    expect(designRevisionDigest("cs-1", "r")).toBe(designRevisionDigest("cs-1", "r"));
  });

  /**
   * ⚠️ The separator is not decorative. Without one, ("ab", "c") and ("a", "bc")
   * concatenate identically, so a token minted for one pair would verify for the
   * other — a real confusion between two distinct subjects.
   */
  it("does not confuse two pairs that would concatenate identically", () => {
    expect(designRevisionDigest("ab", "c")).not.toBe(designRevisionDigest("a", "bc"));
  });
});
