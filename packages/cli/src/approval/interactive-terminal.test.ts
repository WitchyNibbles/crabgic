/**
 * The gate that decides who may answer the approval prompt.
 *
 * The CRITICAL these tests pin (adversarial review, 2026-07-29): a bare
 * `process.stdin.isTTY` check is satisfied by ANY process that allocates a
 * pty, so `script -qec "crabgic approve <digest>" /dev/null <<< yes` from the
 * model's own shell minted and spent a real approval. Reproduced live before
 * this module existed.
 */
import { describe, expect, it } from "vitest";
import { NON_HUMAN_RUNTIME_ENV_MARKERS, resolveApprovalTerminal } from "./interactive-terminal.js";

/** A plausible human shell: a TTY, and none of the runtime markers. */
const HUMAN_ENV: NodeJS.ProcessEnv = { HOME: "/home/someone", TERM: "xterm-256color" };

describe("resolveApprovalTerminal", () => {
  it("allows a real interactive terminal with no agent/CI provenance", () => {
    expect(resolveApprovalTerminal({ env: HUMAN_ENV, isTty: true })).toEqual({ allowed: true });
  });

  it("refuses a piped stdin (the scripted non-interactive path)", () => {
    const verdict = resolveApprovalTerminal({ env: HUMAN_ENV, isTty: false });
    expect(verdict.allowed).toBe(false);
    if (verdict.allowed) throw new Error("unreachable");
    expect(verdict.reason).toContain("no interactive terminal");
  });

  // THE REGRESSION. Each marker, on its own, with isTty TRUE — the exact shape
  // a pty wrapper produces, which the pre-fix gate accepted.
  it.each(NON_HUMAN_RUNTIME_ENV_MARKERS)(
    "refuses a pty whose environment carries %s, even though isTTY is true",
    (marker) => {
      const verdict = resolveApprovalTerminal({
        env: { ...HUMAN_ENV, [marker]: "1" },
        isTty: true,
      });
      expect(verdict.allowed).toBe(false);
      if (verdict.allowed) throw new Error("unreachable");
      expect(verdict.reason).toContain(marker);
    },
  );

  it("treats a marker set to the empty string as present — a runtime sets it as a flag", () => {
    const verdict = resolveApprovalTerminal({
      env: { ...HUMAN_ENV, CLAUDECODE: "" },
      isTty: true,
    });
    expect(verdict.allowed).toBe(false);
  });

  it("refuses on provenance even when several markers are set, naming one of them", () => {
    const verdict = resolveApprovalTerminal({
      env: { ...HUMAN_ENV, CLAUDECODE: "1", CI: "true" },
      isTty: true,
    });
    expect(verdict.allowed).toBe(false);
    if (verdict.allowed) throw new Error("unreachable");
    expect(verdict.reason).toMatch(/CLAUDECODE|CI/);
  });

  it("refuses a non-TTY before it even looks at provenance (both wrong is still refused)", () => {
    const verdict = resolveApprovalTerminal({
      env: { ...HUMAN_ENV, CLAUDECODE: "1" },
      isTty: false,
    });
    expect(verdict.allowed).toBe(false);
    if (verdict.allowed) throw new Error("unreachable");
    expect(verdict.reason).toContain("no interactive terminal");
  });

  it("does not refuse a human shell that merely mentions a marker's name in an unrelated variable", () => {
    const verdict = resolveApprovalTerminal({
      env: { ...HUMAN_ENV, EDITOR: "vim --cmd 'let g:CI=1'", PATH: "/usr/bin" },
      isTty: true,
    });
    expect(verdict.allowed).toBe(true);
  });
});
