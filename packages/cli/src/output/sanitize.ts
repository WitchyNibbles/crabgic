/**
 * Terminal-safe rendering of untrusted text.
 *
 * WHY (2026-07-29, adversarial review finding f). The operator's terminal is
 * this system's trust anchor: the approval gate is "a human read a digest and
 * typed yes". Two strings reach that terminal without having been authored by
 * it -- the digest argument, which the human copy-pasted from model output,
 * and the tail of the spawned daemon's stderr log, which any same-uid process
 * can write. Raw ANSI/OSC escape sequences in either can redraw the screen,
 * hide lines, or paint a convincing fake prompt above the real one.
 *
 * So every untrusted span is stripped of C0 and C1 control characters before
 * it is written. `\n` and `\t` survive, because multi-line diagnostics are the
 * point of showing a log tail at all; ESC (0x1B) does not, which is what
 * defeats every escape sequence built on it.
 *
 * Written as a codepoint test rather than a regex literal: the ranges are the
 * specification here, and spelling them as numbers keeps them readable and
 * keeps unprintable bytes out of this file's own source.
 */

const TAB = 0x09;
const LINE_FEED = 0x0a;

/** True for C0 (0x00-0x1F) except tab/newline, DEL (0x7F), and C1 (0x80-0x9F) -- a lone 0x9B is a CSI introducer on terminals that decode 8-bit controls. */
function isControlCodePoint(code: number): boolean {
  if (code === TAB || code === LINE_FEED) return false;
  return code <= 0x1f || (code >= 0x7f && code <= 0x9f);
}

/** Strips control characters (keeping `\n` and `\t`) so untrusted text cannot drive the terminal. */
export function sanitizeForTerminal(value: string): string {
  let out = "";
  for (const character of value) {
    const code = character.codePointAt(0);
    if (code !== undefined && isControlCodePoint(code)) continue;
    out += character;
  }
  return out;
}
