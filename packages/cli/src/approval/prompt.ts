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

export function renderApprovalPrompt(
  subjectKind: ApprovalTokenSubjectKind,
  digest: string,
): string {
  const label = subjectKind === "envelope_hash" ? "authorization envelope" : "capability manifest";
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

/** Reads one line of confirmation from `io.input`; resolves `true` only for an exact (trimmed, case-insensitive) "yes". */
function readConfirmation(io: ApprovalPromptIo): Promise<boolean> {
  return new Promise((resolve) => {
    let buffer = "";
    function onData(chunk: Buffer | string): void {
      buffer += typeof chunk === "string" ? chunk : chunk.toString("utf8");
      if (buffer.includes("\n")) {
        io.input.off("data", onData);
        resolve(buffer.split("\n")[0]!.trim().toLowerCase() === "yes");
      }
    }
    io.input.on("data", onData);
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
