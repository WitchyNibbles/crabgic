import { GIT_LOCATION_ENV_VARS } from "@crabgic/git-engine";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Drift guard for the two hand-kept copies of `GIT_LOCATION_ENV_VARS`.
 *
 * The canonical list lives in `@crabgic/git-engine`'s `git-arg-guard.ts`. Two
 * production sites cannot import it and duplicate it inline instead, each for
 * a stated reason: `packages/plugin/statusline/crabgic-statusline.mjs` is a
 * zero-dependency `.mjs` on the TUI hot path (the engine re-runs it on every
 * token change, so bundle-load time is on the hot path), and this directory's
 * `git-repo-state.ts` must not pull the git engine into the `crabgic install`
 * path.
 *
 * Neither copy gets the self-healing property `@crabgic/testkit`'s
 * `gitFixtureEnv()` has — that one drops every `GIT_*` name by prefix and so
 * stays correct when git invents a new variable, whereas these two are
 * enumerations that silently rot. Three hand-kept copies WILL drift; adding
 * `GIT_TEMPLATE_DIR` to only one of them would leave the other two exposed to
 * exactly the class the canonical list was extended to cover. This test makes
 * that drift a build failure instead of a latent hole.
 *
 * It compares as SETS: ordering is presentation, membership is the contract.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const PACKAGES_DIR = join(HERE, "..", "..", "..");

const COPIES: readonly { readonly label: string; readonly path: string }[] = [
  {
    label: "installer (git-repo-state.ts)",
    path: join(HERE, "git-repo-state.ts"),
  },
  {
    label: "plugin status line (crabgic-statusline.mjs)",
    path: join(PACKAGES_DIR, "plugin", "statusline", "crabgic-statusline.mjs"),
  },
];

/** Extracts the `GIT_LOCATION_ENV_VARS = [...]` array literal's string members from a source file. */
function parseCopy(path: string): readonly string[] {
  const source = readFileSync(path, "utf8");
  const match = /GIT_LOCATION_ENV_VARS[^=]*=\s*(?:Object\.freeze\(\s*)?\[([^\]]*)\]/.exec(source);
  if (match === null) throw new Error(`no GIT_LOCATION_ENV_VARS array literal found in ${path}`);
  return [...match[1]!.matchAll(/["'`]([A-Z_0-9]+)["'`]/g)].map((m) => m[1]!);
}

describe("GIT_LOCATION_ENV_VARS — the duplicated inline copies stay in sync", () => {
  it.each(COPIES)("$label matches the canonical git-engine list exactly", ({ path }) => {
    expect([...parseCopy(path)].sort()).toEqual([...GIT_LOCATION_ENV_VARS].sort());
  });

  it("the parser is not vacuously matching an empty list", () => {
    // If the regex silently stopped finding members, every comparison above
    // would degrade into "[] equals []" the moment the canonical list changed
    // shape. Pin a real, non-trivial size and a member that must be present.
    for (const { path } of COPIES) {
      const parsed = parseCopy(path);
      expect(parsed.length).toBeGreaterThanOrEqual(15);
      expect(parsed).toContain("GIT_DIR");
    }
    expect(GIT_LOCATION_ENV_VARS).toContain("GIT_TEMPLATE_DIR");
  });
});
