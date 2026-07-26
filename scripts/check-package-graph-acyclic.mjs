#!/usr/bin/env node
// Asserts the intra-workspace dependency graph is a DAG. Run with:
//   node scripts/check-package-graph-acyclic.mjs
//
// WHY THIS EXISTS (2026-07-25): `packages/detect` imported the approval-token
// minter, the MCP tool registry, and the CommandResult/EXIT_* vocabulary from
// the published `crabgic` package, while
// `cli -> learning -> gates -> detect` already held. That cycle made `tsc -b`
// fail from a clean checkout (TS2307 at detect, or TS6202 once the missing
// project reference was added) — but it stayed invisible locally, because
// stale `dist/` output from before `packages/detect` existed satisfied the
// import. Only a from-zero build surfaced it, and nothing in CI did one.
//
// This guard catches the same class of mistake from the manifests alone, in
// milliseconds, without needing a clean build. It deliberately reads
// package.json rather than tsconfig references: a dependency declared in the
// manifest is the thing that lets `import "crabgic"` resolve
// at all, so the manifest is where the cycle is really introduced.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const PACKAGES_DIR = fileURLToPath(new URL("../packages", import.meta.url));

/** name -> in-workspace dependency names (prod + dev; a dev-only cycle breaks `tsc -b` just as hard, since tests are inside `include: ["src"]`). */
function readGraph() {
  const manifests = new Map();
  for (const entry of readdirSync(PACKAGES_DIR, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    let raw;
    try {
      raw = readFileSync(join(PACKAGES_DIR, entry.name, "package.json"), "utf8");
    } catch {
      continue; // not a package directory
    }
    const pkg = JSON.parse(raw);
    manifests.set(pkg.name, { ...pkg.dependencies, ...pkg.devDependencies });
  }

  const graph = new Map();
  for (const [name, deps] of manifests) {
    graph.set(
      name,
      Object.keys(deps).filter((dep) => manifests.has(dep)),
    );
  }
  return graph;
}

/** Iterative DFS with an explicit stack — returns the first cycle found as a name path, or null. */
function findCycle(graph) {
  const WHITE = 0;
  const GREY = 1;
  const BLACK = 2;
  const color = new Map([...graph.keys()].map((name) => [name, WHITE]));

  for (const root of graph.keys()) {
    if (color.get(root) !== WHITE) continue;

    const path = [];
    const stack = [{ name: root, remaining: [...(graph.get(root) ?? [])] }];
    color.set(root, GREY);
    path.push(root);

    while (stack.length > 0) {
      const frame = stack.at(-1);
      const next = frame.remaining.pop();

      if (next === undefined) {
        color.set(frame.name, BLACK);
        stack.pop();
        path.pop();
        continue;
      }

      if (color.get(next) === GREY) {
        // `next` is an ancestor on the current path — the cycle is the
        // path from its first appearance onward, closed back onto itself.
        return [...path.slice(path.indexOf(next)), next];
      }
      if (color.get(next) === BLACK) continue;

      color.set(next, GREY);
      path.push(next);
      stack.push({ name: next, remaining: [...(graph.get(next) ?? [])] });
    }
  }
  return null;
}

const graph = readGraph();
const cycle = findCycle(graph);

if (cycle !== null) {
  console.error("check-package-graph-acyclic: FAIL — dependency cycle detected:");
  console.error(`  ${cycle.join(" -> ")}`);
  console.error(
    "\nA cycle here means `tsc -b` cannot order the build: it fails from a clean\n" +
      "checkout even when incremental local builds appear to succeed against\n" +
      "stale dist/ output. Move the shared primitive down to a package both\n" +
      "sides may depend on (usually @crabgic/contracts) rather than importing\n" +
      "upward.",
  );
  process.exit(1);
}

console.log(
  `check-package-graph-acyclic: PASS — ${graph.size} workspace packages, dependency graph is a DAG.`,
);
