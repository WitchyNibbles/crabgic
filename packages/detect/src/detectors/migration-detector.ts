/**
 * `migration` category — roadmap/12 §In scope, "Detection" bullet:
 * "migrations ... → `StackEvidence`". Recognizes the common
 * migration-directory conventions across ecosystems (Django/Alembic-style
 * `migrations/`, Rails-style `db/migrate/`) without needing to parse any
 * migration file's own content.
 */
import type { StackEvidenceFinding } from "@eo/contracts";
import { type DetectionContext, type Detector } from "./types.js";

function migrationDirEcosystem(relativePath: string): string | undefined {
  const segments = relativePath.split("/");
  if (segments.includes("migrations")) {
    // Bare `migrations/` is ambiguous across ecosystems (Django, Alembic,
    // node-pg-migrate, ...) — reported generically rather than guessing.
    return "generic";
  }
  if (segments.includes("db") && segments.includes("migrate")) {
    return "rails";
  }
  return undefined;
}

export const migrationDetector: Detector = {
  id: "migration",
  detect(ctx: DetectionContext): StackEvidenceFinding[] {
    const seenDirs = new Set<string>();
    const findings: StackEvidenceFinding[] = [];
    for (const file of ctx.files) {
      const ecosystem = migrationDirEcosystem(file.relativePath);
      if (ecosystem === undefined) continue;
      const dir = file.relativePath.slice(0, file.relativePath.lastIndexOf("/"));
      if (seenDirs.has(dir)) continue;
      seenDirs.add(dir);
      findings.push({
        category: "migration",
        ecosystem,
        detail: "migration directory present",
        path: file.relativePath,
        confidence: 0.7,
      });
    }
    return findings;
  },
};
