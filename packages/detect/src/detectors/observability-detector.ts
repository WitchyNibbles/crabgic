/**
 * `observability_integration` category — roadmap/12 §In scope, "Detection"
 * bullet: "observability integrations → `StackEvidence`". Two signals: (1)
 * a known observability package name in a node `package.json`'s
 * dependencies/devDependencies, (2) a recognized observability config
 * file name anywhere in the tree.
 */
import type { StackEvidenceFinding } from "@eo/contracts";
import { parseJsonSafe } from "../fs/safe-read.js";
import { findFiles, type DetectionContext, type Detector } from "./types.js";

const OBSERVABILITY_PACKAGE_PREFIXES: readonly string[] = [
  "@opentelemetry/",
  "@sentry/",
  "dd-trace",
  "newrelic",
  "prom-client",
  "@datadog/",
];

const OBSERVABILITY_CONFIG_FILES: readonly string[] = [
  "otel-collector-config.yaml",
  "otel-collector-config.yml",
  "sentry.properties",
];

function collectDependencyNames(parsed: unknown): readonly string[] {
  if (typeof parsed !== "object" || parsed === null) return [];
  const record = parsed as { dependencies?: unknown; devDependencies?: unknown };
  const names: string[] = [];
  for (const bucket of [record.dependencies, record.devDependencies]) {
    if (typeof bucket !== "object" || bucket === null) continue;
    names.push(...Object.keys(bucket));
  }
  return names;
}

function detectFromPackageJson(ctx: DetectionContext): StackEvidenceFinding[] {
  const findings: StackEvidenceFinding[] = [];
  for (const file of findFiles(ctx, (p) => p === "package.json" || p.endsWith("/package.json"))) {
    const text = ctx.readFile(file.relativePath);
    if (text === undefined) continue;
    const parsed = parseJsonSafe(text);
    const names = collectDependencyNames(parsed);
    for (const name of names) {
      const matchedPrefix = OBSERVABILITY_PACKAGE_PREFIXES.find((prefix) =>
        name.startsWith(prefix),
      );
      if (matchedPrefix === undefined) continue;
      findings.push({
        category: "observability_integration",
        ecosystem: "node",
        detail: `observability dependency: ${name}`,
        path: file.relativePath,
        confidence: 0.75,
      });
    }
  }
  return findings;
}

function detectConfigFiles(ctx: DetectionContext): StackEvidenceFinding[] {
  const findings: StackEvidenceFinding[] = [];
  for (const fileName of OBSERVABILITY_CONFIG_FILES) {
    for (const file of findFiles(ctx, (p) => p === fileName || p.endsWith(`/${fileName}`))) {
      findings.push({
        category: "observability_integration",
        ecosystem: "generic",
        detail: `${fileName} present`,
        path: file.relativePath,
        confidence: 0.7,
      });
    }
  }
  return findings;
}

export const observabilityDetector: Detector = {
  id: "observability_integration",
  detect(ctx: DetectionContext): StackEvidenceFinding[] {
    return [...detectFromPackageJson(ctx), ...detectConfigFiles(ctx)];
  },
};
