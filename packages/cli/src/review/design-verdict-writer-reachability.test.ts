/**
 * WHO CAN WRITE A DESIGN VERDICT — asserted structurally, not by naming.
 *
 * Owner ruling R2 makes `crabgic design approve|reject` a CLI command so that
 * "nothing reachable from a session may record this verdict"
 * (`../commands/design-verdict-handler.ts`). That is the structural half of the
 * design gate: if a model could write a verdict, every other assertion about the
 * gate is theatre.
 *
 * ⚠️ WHY THIS FILE EXISTS. The guard that was carrying that claim —
 * `../gateway-mcp/build-tool-registry.test.ts`, "exposes NO gateway tool that
 * records a design verdict" — tests registered tool NAMES against
 * `/design.*(verdict|approve)/i`. Measured: `design.verdict.record` and
 * `design.approve` are caught, but `design.redeem`, `design.gate.record`,
 * `design.token.claim` and `designGateComplete` all pass it while being free to
 * write whatever they like. The guard tested spelling, not capability, so the
 * structural half of the gate rested on a naming convention.
 *
 * This asserts the property the comment always claimed: the writer has exactly
 * ONE production importer, and it is the CLI command. A new caller anywhere —
 * whatever it is called — reddens this file and forces a deliberate amendment
 * rather than sliding past a regex.
 *
 * NOTE ON SCOPE, stated rather than implied. This is a static import check over
 * source text. It proves no production module NAMES the writer. It does not
 * prove reachability through a dynamic `import()` of a computed specifier, and
 * nothing here would catch one. That bound is real; the check is still strictly
 * stronger than the name pattern it supplements, which caught neither.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const SRC_ROOT = join(import.meta.dirname, "..");
const REPO_REL_ROOT = join(SRC_ROOT, "..", "..", "..");

/** The writer. Only this symbol appends to `design-verdicts.json`. */
const WRITER = "recordDesignVerdict";

/**
 * The sole production module permitted to name it. Changing this list is a
 * change to owner ruling R2 and must be made as one, not as a test fix.
 */
const PERMITTED_IMPORTERS: readonly string[] = Object.freeze([
  "packages/cli/src/commands/design-verdict-handler.ts",
]);

function productionSourceFiles(dir: string): readonly string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      found.push(...productionSourceFiles(full));
      continue;
    }
    if (!entry.endsWith(".ts")) continue;
    // Tests may import the writer freely; they are not a session's reach.
    if (entry.endsWith(".test.ts") || entry.endsWith(".type.test.ts")) continue;
    found.push(full);
  }
  return found;
}

describe("the design verdict writer is reachable from exactly one production module", () => {
  it("names the CLI command and nothing else", () => {
    const importers = productionSourceFiles(SRC_ROOT)
      .filter((file) => {
        const text = readFileSync(file, "utf8");
        // The definition site itself exports the symbol; it is not an importer.
        if (file.endsWith(join("review", "design-verdict-store.ts"))) return false;
        return text.includes(WRITER);
      })
      .map((file) => relative(REPO_REL_ROOT, file).split("\\").join("/"))
      .sort();

    expect(importers).toEqual([...PERMITTED_IMPORTERS].sort());
  });

  it("keeps the gateway registry free of it, which is the half that matters", () => {
    const gatewayModules = productionSourceFiles(join(SRC_ROOT, "gateway-mcp"));
    expect(gatewayModules.length).toBeGreaterThan(0);
    const offenders = gatewayModules
      .filter((file) => readFileSync(file, "utf8").includes(WRITER))
      .map((file) => relative(REPO_REL_ROOT, file));
    expect(offenders).toEqual([]);
  });
});
