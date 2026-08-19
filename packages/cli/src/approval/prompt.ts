/**
 * Terminal-prompt approval flow — roadmap/09-cli-and-doctor.md §In scope:
 * "terminal prompt rendering an arbitrary digest ... the human-only gate;
 * no model-driven call can mint one." §Test plan, Security: "token minting
 * is reachable only through the terminal-prompt renderer, never a bare
 * flag or a scripted non-interactive path." `runApprovalFlow` below is
 * therefore the ONLY function in this package that calls
 * `ApprovalTokenMinter.mint` — no command handler calls `mint` directly.
 */
import type { Readable, Writable } from "node:stream";
import {
  ApprovalTokenMinter,
  type ApprovalTokenSubjectKind,
  type MintedApprovalToken,
} from "./token.js";

/** Human-readable label per subject kind — exhaustive over `ApprovalTokenSubjectKind` (a `never` default branch fails to compile if a further kind is ever added without a matching label here; `design_revision` joined 2026-08-19 and this branch is what caught its absence). */
function subjectKindLabel(subjectKind: ApprovalTokenSubjectKind): string {
  switch (subjectKind) {
    case "envelope_hash":
      return "authorization envelope";
    case "capability_digest":
      return "capability manifest";
    case "learning_review":
      return "learning proposal (independent review)";
    case "design_revision":
      return "design revision";
    default: {
      const exhaustive: never = subjectKind;
      throw new Error(`unknown approval-token subject kind: ${String(exhaustive)}`);
    }
  }
}

export function renderApprovalPrompt(
  subjectKind: ApprovalTokenSubjectKind,
  digest: string,
): string {
  const label = subjectKindLabel(subjectKind);
  return (
    `About to approve the following ${label} digest:\n\n` +
    `  ${digest}\n\n` +
    `Type "yes" to approve, anything else to abort: `
  );
}

export interface ApprovalPromptIo {
  readonly input: Readable;
  readonly output: Writable;
}

/**
 * Reads one line of confirmation from `io.input`; resolves `true` only for an
 * exact (trimmed, case-insensitive) "yes".
 *
 * EOF terminates the final line: "yes" followed by end-of-input confirms, and
 * end-of-input with nothing buffered declines. A stream that already ended
 * before this attached (the `run < intake.json` shape, where the intake JSON
 * read drained stdin) has emitted its events for good — no listener attached
 * now will ever fire — so it is declined up front rather than awaited forever.
 * A stream error declines; it never crashes the process or mints.
 */
function readConfirmation(io: ApprovalPromptIo): Promise<boolean> {
  return new Promise((resolve) => {
    if (io.input.readableEnded || io.input.destroyed) {
      resolve(false);
      return;
    }
    let buffer = "";
    const isYes = (line: string): boolean => line.trim().toLowerCase() === "yes";
    const settle = (value: boolean): void => {
      io.input.off("data", onData);
      io.input.off("end", onEnd);
      io.input.off("close", onClose);
      io.input.off("error", onError);
      resolve(value);
    };
    function onData(chunk: Buffer | string): void {
      buffer += typeof chunk === "string" ? chunk : chunk.toString("utf8");
      if (buffer.includes("\n")) {
        settle(isYes(buffer.split("\n")[0]!));
      }
    }
    function onEnd(): void {
      // An ORDERLY end-of-input terminates the final line: the human typed
      // "yes" and pressed Ctrl-D instead of Enter, which is a complete answer.
      settle(isYes(buffer));
    }
    function onClose(): void {
      // An abnormal teardown is NOT an answer. Consent inferred from a line
      // the human never submitted is consent they never gave, so a close
      // without a preceding `end` always declines (adversarial review, 2026-07-29).
      settle(false);
    }
    function onError(): void {
      settle(false);
    }
    io.input.on("data", onData);
    io.input.on("end", onEnd);
    io.input.on("close", onClose);
    io.input.on("error", onError);
  });
}

export class ApprovalDeclinedError extends Error {
  constructor() {
    super("approval was declined at the terminal prompt");
    this.name = "ApprovalDeclinedError";
  }
}

/**
 * The ONLY reachable path to `ApprovalTokenMinter.mint` in this package:
 * renders the prompt, reads an interactive confirmation, and mints only on
 * an explicit "yes". Throws `ApprovalDeclinedError` on anything else
 * (including EOF with no input) — never mints on a declined/ambiguous
 * response.
 */
export async function runApprovalFlow(
  minter: ApprovalTokenMinter,
  subjectKind: ApprovalTokenSubjectKind,
  digest: string,
  io: ApprovalPromptIo,
): Promise<MintedApprovalToken> {
  io.output.write(renderApprovalPrompt(subjectKind, digest));
  const confirmed = await readConfirmation(io);
  if (!confirmed) {
    throw new ApprovalDeclinedError();
  }
  return minter.mint(subjectKind, digest);
}
