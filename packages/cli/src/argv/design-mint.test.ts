import { describe, expect, it } from "vitest";
import { parseCommand } from "./parse-command.js";
import { CliUsageError } from "../errors.js";

/**
 * ⚠️ `design mint` — owner ruling 2026-08-19, amending R2.
 *
 * R2 made `design approve` a CLI command so that "nothing reachable from a
 * session may record this verdict". The amendment keeps that and changes what
 * carries the owner's act: a token they mint at their own terminal, which the
 * gateway then verifies, instead of a file the command writes directly.
 *
 * ⚠️ IT IS BOUGHT FOR THE AUDIT TRAIL, NOT FOR CONVENIENCE, and the measurement
 * that establishes this is in the commit: `design-verdict-handler.ts` calls
 * `runApprovalFlow` zero times, so the approval was ALREADY one terminal command
 * with no prompt. The token flow is one command too. What it adds is that the
 * act becomes a journaled `approval_token_mint`, claimed once through the
 * durable ledger — the same footing contract and capability approvals stand on,
 * rather than a bare write to `design-verdicts.json` that leaves no trace of the
 * act itself.
 *
 * `--revision` is required for the same reason `approve` requires it: a token
 * that does not name what it approved carries forward across an edit, which is
 * precisely the window the design gate's own "approved a DIFFERENT revision"
 * refusal exists to close.
 */

describe("design mint — parsing", () => {
  it("parses a change set and revision", () => {
    const parsed = parseCommand(["design", "mint", "cs-1", "--revision", "design-rev-1"]);

    expect(parsed).toMatchObject({
      command: "design-mint",
      changeSetId: "cs-1",
      revision: "design-rev-1",
    });
  });

  /**
   * ⚠️ A mint with no revision would produce a token that approves whatever the
   * design happens to be when it is redeemed — the carry-across-an-edit failure,
   * minted rather than merely recorded.
   */
  it("REFUSES a mint with no --revision", () => {
    expect(() => parseCommand(["design", "mint", "cs-1"])).toThrow(CliUsageError);
  });

  it("REFUSES a mint with no change-set id", () => {
    expect(() => parseCommand(["design", "mint", "--revision", "r"])).toThrow(CliUsageError);
  });

  /** The existing verbs keep working, and the error still names every accepted one. */
  it("keeps approve and reject, and names mint among the expected verbs", () => {
    expect(parseCommand(["design", "approve", "cs-1", "--revision", "r"])).toMatchObject({
      command: "design-approve",
    });
    expect(() => parseCommand(["design", "bogus"])).toThrow(/mint/);
  });
});
