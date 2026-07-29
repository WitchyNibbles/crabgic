/**
 * `classifyOpenFailure` — the errno routing behind `loadEnvelopePolicy`.
 *
 * Roast round 9: the resource-exhaustion branch shipped with **no test at
 * all**. `grep` found `EMFILE`/`ENFILE` nowhere else in the repo and v8 named
 * its `return` uncovered — the same "a green suite proves nothing about the
 * new path" pattern round 8 was written to punish, and against this repo's
 * own TDD ground rule.
 *
 * Tested here rather than by exhausting the real descriptor table, which
 * would destabilise every other test in the run.
 */
import { describe, expect, it } from "vitest";
import { classifyOpenFailure } from "./policy-store.js";

const PATH = "/state/envelope-policy.json";

describe("classifyOpenFailure", () => {
  /** The one code that means the owner has not authored a policy yet. */
  it("routes ENOENT, and only ENOENT, to absent", () => {
    expect(classifyOpenFailure("ENOENT", PATH).status).toBe("absent");
  });

  it.each(["ENOTDIR", "EACCES", "EISDIR", "ENAMETOOLONG", "EIO", undefined])(
    "routes %s to invalid, so `install` is not invited to overwrite",
    (code) => {
      const result = classifyOpenFailure(code, PATH);
      expect(result.status).toBe("invalid");
      if (result.status !== "invalid") return;
      expect(result.transient).toBeUndefined();
    },
  );

  it("names a symbolic link specifically", () => {
    const result = classifyOpenFailure("ELOOP", PATH);
    expect(result.status).toBe("invalid");
    if (result.status !== "invalid") return;
    expect(result.reason).toMatch(/symbolic link/i);
  });

  /**
   * These describe the PROCESS, not the file. Marking them transient is what
   * stops the doctor pairing "the policy is fine" with "go rewrite it" -- a
   * remedy that, followed, renames a machine-derived policy over a hand-tuned
   * one because a descriptor table filled up.
   */
  it.each(["EMFILE", "ENFILE", "ENOMEM"])("marks %s transient", (code) => {
    const result = classifyOpenFailure(code, PATH);
    expect(result.status).toBe("invalid");
    if (result.status !== "invalid") return;
    expect(result.transient).toBe(true);
    expect(result.reason).toMatch(/probably fine/);
    // It must NOT tell the owner to touch the file.
    expect(result.reason).not.toMatch(/edit|re-run|install/i);
  });

  it("never reports a resource failure as absent", () => {
    for (const code of ["EMFILE", "ENFILE", "ENOMEM"]) {
      expect(classifyOpenFailure(code, PATH).status).not.toBe("absent");
    }
  });
});
