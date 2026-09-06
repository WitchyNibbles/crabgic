import { describe, expect, it } from "vitest";
import { describeUndeclaredImports } from "./undeclared-imports.mjs";

describe("describeUndeclaredImports", () => {
  /**
   * ⚠️ THIS MESSAGE SENT ITS FIRST READER CHASING THE WRONG THING.
   *
   * `prepack` bundles every `@crabgic/*` workspace package INTO the emitted
   * files, so a bundle that still imports them by name is, overwhelmingly, a
   * bundle that was not rebuilt. Measured 2026-09-06: a `check:all` run after
   * per-package `tsc -b` (which does not refresh `packages/cli/dist`) reported
   * eight undeclared `@crabgic/*` imports and "would 404 for a real user",
   * and the actual remedy was `npm run build`. The check was right that the
   * artifact was broken and wrong about why.
   *
   * Same discipline as the impossible-specifier refusal above it in
   * `../check-install-smoke.mjs`, which exists because that message was
   * misquoted in two merged PR bodies.
   */
  it("names the rebuild first when every undeclared import is a bundled workspace package", () => {
    const message = describeUndeclaredImports(["@crabgic/journal", "@crabgic/supervisor"]);
    expect(message).toMatch(/npm run build/);
    // The rebuild has to come BEFORE the 404 sentence, or a reader skims to
    // the wrong remedy exactly as before.
    expect(message.indexOf("npm run build")).toBeLessThan(message.indexOf("404"));
    expect(message).toContain("@crabgic/journal");
  });

  it("does not blame the build when a third-party dependency is genuinely missing", () => {
    const message = describeUndeclaredImports(["zod"]);
    expect(message).not.toMatch(/npm run build/);
    expect(message).toContain("zod");
    expect(message).toContain("404");
  });

  it("keeps the 404 explanation when the two causes are mixed", () => {
    const message = describeUndeclaredImports(["@crabgic/journal", "zod"]);
    expect(message).not.toMatch(/npm run build/);
    expect(message).toContain("@crabgic/journal");
    expect(message).toContain("zod");
  });
});
