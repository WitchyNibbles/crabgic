import { readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * The supervisor daemon's STATIC boot graph, asserted as a graph rather
 * than as a number.
 *
 * WHY (WP5, 2026-07-25): this repo has already been bitten once by exactly
 * the change WP5 makes. `../bin/supervisord.ts:34-42` records it: adding a
 * static import that reached `@crabgic/engine-claude` ->
 * `@anthropic-ai/claude-agent-sdk` cost +40.9 MiB and put the daemon's idle
 * RSS at 99.8 / 108.2 / 100.2 MiB across three boots, straddling
 * roadmap/05's <100 MiB budget — for a module an idle daemon serving
 * status/cancel/evidence/registry never touches. The fix was
 * `./lazy-run-dispatcher.ts`. WP5 adds `@crabgic/connectors-jira` and
 * `@crabgic/connectors-grafana` to `packages/cli`, which is the same class of
 * change: both are reachable from `../bootstrap.ts`, and one careless
 * static import from anything the daemon boots would pull them in.
 *
 * NOT A MEASUREMENT, AND DELIBERATELY SO — corrected 2026-07-25 after an
 * adversarial review rightly objected that this docstring used to state a
 * one-off local `VmRSS` reading as fact, from a script that was never
 * committed and so could not be re-run. The repo's only reproducible idle
 * figure is the one `e2e/attestation`'s `measureSupervisorIdle` produces:
 * it boots the real daemon, samples `/proc`, and decides against
 * `SUPERVISOR_IDLE_RSS_BUDGET_BYTES` (roadmap/05's <100 MiB). That probe
 * is the authority on the NUMBER; cite it, not this file.
 *
 * What belongs HERE is the INVARIANT that keeps the number where it is. An
 * RSS assertion tells you the budget broke; this tells you WHAT broke it,
 * in the same edit that breaks it, without booting anything. The two are
 * complements, and this one is not a substitute for the measurement —
 * see the report accompanying WP5 for that correction.
 *
 * Deliberately walks SOURCE, not `dist`: the guard must fail in the same
 * edit that introduces the import, not after a build.
 */
const HERE = dirname(fileURLToPath(import.meta.url));
const SRC_ROOT = resolve(HERE, "..");
const ENTRY = join(SRC_ROOT, "bin", "supervisord.ts");

/**
 * Packages that must NOT be statically reachable from the daemon entry
 * point. Each is heavy and used only on a code path an idle daemon never
 * runs; each has, or must have, a lazy seam instead.
 */
const FORBIDDEN_IN_BOOT_GRAPH: readonly string[] = [
  "@crabgic/engine-claude",
  "@crabgic/connectors-jira",
  "@crabgic/connectors-grafana",
];

/**
 * Only `import`/`export … from "…"`. The clause list may span lines but
 * never contains a `;`, so `[^;]*?` is both multi-line-safe and unable to
 * run past the end of one statement. `import(...)` is deliberately NOT
 * matched: a dynamic import is exactly the lazy seam this guard requires.
 */
const STATIC_SPECIFIER = /(?:^|\n)\s*(?:import|export)\s[^;]*?\bfrom\s*["']([^"']+)["']/g;
/** A bare `import "…"` side-effect form carries no `from`. */
const BARE_IMPORT = /(?:^|\n)\s*import\s*["']([^"']+)["']/g;
/** `import type … from` / `export type … from` are erased under `verbatimModuleSyntax` and cost nothing at runtime. */
const TYPE_ONLY = /^\s*(?:import|export)\s+type\b/;

function staticSpecifiersOf(file: string): readonly string[] {
  const source = readFileSync(file, "utf8");
  const kept = source
    .split("\n")
    .map((line) => (TYPE_ONLY.test(line) ? "" : line))
    .join("\n");
  const found = new Set<string>();
  for (const match of kept.matchAll(STATIC_SPECIFIER)) found.add(match[1]!);
  for (const match of kept.matchAll(BARE_IMPORT)) found.add(match[1]!);
  return [...found];
}

interface BootGraph {
  readonly files: readonly string[];
  readonly packages: readonly string[];
}

/** Walks the daemon entry point's static import graph, following relative specifiers inside this package and recording every `@crabgic/*` package it reaches. */
function walkBootGraph(entry: string): BootGraph {
  const visited = new Set<string>();
  const packages = new Set<string>();
  const queue = [entry];

  while (queue.length > 0) {
    const file = queue.pop()!;
    if (visited.has(file)) continue;
    visited.add(file);

    for (const specifier of staticSpecifiersOf(file)) {
      if (specifier.startsWith("@crabgic/")) {
        packages.add(specifier);
        continue;
      }
      if (!specifier.startsWith(".")) continue; // node: builtins, zod, the SDK — not this guard's subject
      // Source is `.ts`; emitted specifiers are `.js` (NodeNext).
      const resolved = resolve(dirname(file), specifier).replace(/\.js$/, ".ts");
      queue.push(resolved);
    }
  }

  return {
    files: [...visited].map((file) => relative(SRC_ROOT, file)),
    packages: [...packages].sort(),
  };
}

describe("supervisor daemon boot graph", () => {
  const graph = walkBootGraph(ENTRY);

  it("reaches the entry point's own first-party modules — the walker actually walks", () => {
    expect(graph.files).toContain("bin/supervisord.ts");
    expect(graph.files).toContain("daemon/lazy-run-dispatcher.ts");
    expect(graph.files).toContain("daemon/worker-auth.ts");
  });

  it("does NOT statically reach the heavy packages an idle daemon never uses", () => {
    for (const forbidden of FORBIDDEN_IN_BOOT_GRAPH) {
      expect(
        graph.packages,
        `${forbidden} is statically reachable from bin/supervisord.ts — that is the +40.9 MiB ` +
          `class of regression roadmap/05's <100 MiB idle budget was already broken by once. ` +
          `Load it behind a dynamic import, as daemon/lazy-run-dispatcher.ts does.`,
      ).not.toContain(forbidden);
    }
  });

  /**
   * The specific reachability WP5 creates. `bootstrap.ts` now imports both
   * connector packages; if the daemon ever reaches `bootstrap.ts`, it
   * inherits every one of them at once.
   */
  it("does NOT statically reach bootstrap.ts, which imports both connector packages", () => {
    expect(graph.files).not.toContain("bootstrap.ts");
  });

  /** `run-dispatcher.ts` is the module the lazy seam defers; reaching it statically would undo the seam entirely. */
  it("does NOT statically reach the engine-bearing run dispatcher", () => {
    expect(graph.files).not.toContain("daemon/run-dispatcher.ts");
  });

  /** Proof the guard has teeth: bootstrap.ts really does pull the connectors in, so the assertion above is not vacuous. */
  it("bootstrap.ts genuinely pulls both connector packages in (the assertions above are not vacuous)", () => {
    const fromBootstrap = walkBootGraph(join(SRC_ROOT, "bootstrap.ts")).packages;
    expect(fromBootstrap).toContain("@crabgic/connectors-jira");
    expect(fromBootstrap).toContain("@crabgic/connectors-grafana");
  });

  /** …and that the walker would in fact SEE a forbidden package if one were reachable. */
  it("detects a forbidden package when one really is reachable (walker sanity)", () => {
    const fromRunDispatcher = walkBootGraph(join(SRC_ROOT, "daemon", "run-dispatcher.ts")).packages;
    expect(fromRunDispatcher).toContain("@crabgic/engine-claude");
  });
});
