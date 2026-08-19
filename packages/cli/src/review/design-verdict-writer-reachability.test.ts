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
  /**
   * ⚠️ ADDED BY OWNER RULING 2026-08-19, AMENDING R2. The design gate now also
   * completes inside a session, by redeeming a token the owner minted at their
   * own terminal. `redeem-design-verdict.ts` is the ONLY other module that may
   * name the writer, and it reaches it only after
   * `verifyApprovalTokenDurable` has spent an owner-minted, revision-bound,
   * single-use token — writing nothing if that fails.
   *
   * This list is owner ruling R2 in code. Adding to it is an amendment, not a
   * test fix, and the security consequence is recorded in
   * `docs/security-posture.md` rather than only here.
   */
  "packages/cli/src/review/redeem-design-verdict.ts",
]);

/**
 * Strips line and block comments so the scan sees CODE, not prose.
 *
 * ⚠️ MEASURED FALSE POSITIVE. Registering the redeem tool made
 * `gateway-mcp/build-tool-registry.ts` fail the gateway assertion — not because
 * it reaches the writer, but because a COMMENT explaining that it cannot reach
 * the writer names the symbol. A guard that fires on a comment saying "this
 * does not do X" punishes the documentation that makes the property legible,
 * and teaches people to stop writing it. The substantive property is about what
 * the code does.
 */
function stripComments(text: string): string {
  const withoutBlocks = text.replace(/\/\*[\s\S]*?\*\//g, "");
  return withoutBlocks
    .split("\n")
    .map((line) => {
      const marker = line.indexOf("//");
      if (marker === -1) return line;
      const before = line.slice(0, marker);
      /**
       * ⚠️ BIASED TOWARDS KEEPING TEXT. If anything quoted precedes the `//`
       * it may be a URL or a string literal rather than a comment, and cutting
       * there would delete real code after it on the same line — a FALSE
       * NEGATIVE, which for a security guard is far worse than the noise of a
       * false positive. When in doubt the line survives intact.
       */
      if (/["'`]/.test(before)) return line;
      return before;
    })
    .join("\n");
}

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
        const text = stripComments(readFileSync(file, "utf8"));
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
      .filter((file) => stripComments(readFileSync(file, "utf8")).includes(WRITER))
      .map((file) => relative(REPO_REL_ROOT, file));
    expect(offenders).toEqual([]);
  });
});

describe("stripComments", () => {
  it("removes a line comment that merely names the writer", () => {
    expect(stripComments("// this cannot reach recordDesignVerdict\nconst a = 1;")).not.toContain(
      "recordDesignVerdict",
    );
  });

  it("removes a block comment that names it", () => {
    expect(stripComments("/** cannot reach recordDesignVerdict */\nconst a = 1;")).not.toContain(
      "recordDesignVerdict",
    );
  });

  it("KEEPS a real call, which is the thing being guarded", () => {
    expect(stripComments("await recordDesignVerdict(path, v, home);")).toContain(
      "recordDesignVerdict",
    );
  });

  it("keeps a call that merely shares a line with a trailing comment", () => {
    // A trailing comment must not take the code before it with it.
    expect(stripComments("recordDesignVerdict(a); // spend first")).toContain(
      "recordDesignVerdict",
    );
  });
});

describe("stripComments — the safe-bias rule", () => {
  it("does NOT cut at a // inside a string, which would delete real code after it", () => {
    const line = 'const u = "https://x"; recordDesignVerdict(a);';
    expect(stripComments(line)).toContain("recordDesignVerdict");
  });
});
