/**
 * `language_runtime` category — roadmap/12 §In scope, "Detection" bullet:
 * "language/runtime versions ... → `StackEvidence`". Also feeds the
 * "conflicting `engines.node` across a monorepo's packages" contradiction
 * example (roadmap/12 §Test plan, "Unit" bullet) — every node `package.json`
 * this detector finds with an `engines.node` field is emitted as its own
 * finding so `../contradiction.ts` can compare them pairwise.
 *
 * Every parse here is bounded/best-effort (`../fs/safe-read.ts`'s
 * `parseJsonSafe`, or a narrow regex for non-JSON manifests) — a
 * malformed manifest yields no finding for that file, never a throw.
 */
import type { StackEvidenceFinding } from "@eo/contracts";
import { parseJsonSafe } from "../fs/safe-read.js";
import { findFiles, type DetectionContext, type Detector } from "./types.js";

function detectNodeEngines(ctx: DetectionContext): StackEvidenceFinding[] {
  const findings: StackEvidenceFinding[] = [];
  for (const file of findFiles(ctx, (p) => p === "package.json" || p.endsWith("/package.json"))) {
    const text = ctx.readFile(file.relativePath);
    if (text === undefined) continue;
    const parsed = parseJsonSafe(text);
    if (typeof parsed !== "object" || parsed === null) continue;
    const engines = (parsed as { engines?: unknown }).engines;
    if (typeof engines !== "object" || engines === null) continue;
    const nodeRange = (engines as { node?: unknown }).node;
    if (typeof nodeRange !== "string" || nodeRange.trim().length === 0) continue;
    findings.push({
      category: "language_runtime",
      ecosystem: "node",
      detail: `engines.node: ${nodeRange}`,
      path: file.relativePath,
      confidence: 0.9,
    });
  }
  return findings;
}

function detectPythonRequiresPython(ctx: DetectionContext): StackEvidenceFinding[] {
  const findings: StackEvidenceFinding[] = [];
  for (const file of findFiles(
    ctx,
    (p) => p === "pyproject.toml" || p.endsWith("/pyproject.toml"),
  )) {
    const text = ctx.readFile(file.relativePath);
    if (text === undefined) continue;
    const match = /requires-python\s*=\s*"([^"]+)"/.exec(text);
    if (match === null) continue;
    findings.push({
      category: "language_runtime",
      ecosystem: "python",
      detail: `requires-python: ${match[1] ?? ""}`,
      path: file.relativePath,
      confidence: 0.85,
    });
  }
  return findings;
}

function detectGoDirective(ctx: DetectionContext): StackEvidenceFinding[] {
  const findings: StackEvidenceFinding[] = [];
  for (const file of findFiles(ctx, (p) => p === "go.mod" || p.endsWith("/go.mod"))) {
    const text = ctx.readFile(file.relativePath);
    if (text === undefined) continue;
    const match = /^go\s+(\d+\.\d+(?:\.\d+)?)/m.exec(text);
    if (match === null) continue;
    findings.push({
      category: "language_runtime",
      ecosystem: "go",
      detail: `go directive: ${match[1] ?? ""}`,
      path: file.relativePath,
      confidence: 0.9,
    });
  }
  return findings;
}

function detectRustEdition(ctx: DetectionContext): StackEvidenceFinding[] {
  const findings: StackEvidenceFinding[] = [];
  for (const file of findFiles(ctx, (p) => p === "Cargo.toml" || p.endsWith("/Cargo.toml"))) {
    const text = ctx.readFile(file.relativePath);
    if (text === undefined) continue;
    const match = /^edition\s*=\s*"([^"]+)"/m.exec(text);
    if (match === null) continue;
    findings.push({
      category: "language_runtime",
      ecosystem: "rust",
      detail: `edition: ${match[1] ?? ""}`,
      path: file.relativePath,
      confidence: 0.85,
    });
  }
  return findings;
}

export const languageRuntimeDetector: Detector = {
  id: "language_runtime",
  detect(ctx: DetectionContext): StackEvidenceFinding[] {
    return [
      ...detectNodeEngines(ctx),
      ...detectPythonRequiresPython(ctx),
      ...detectGoDirective(ctx),
      ...detectRustEdition(ctx),
    ];
  },
};
