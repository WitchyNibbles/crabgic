/**
 * `buildStackEvidence` — roadmap/12 work item 1's top-level entry point:
 * walks a project root ONCE (`./fs/safe-walk.ts`), runs every registered
 * detector (`./detectors/index.ts`) over the shared file list, runs
 * contradiction detection (`./contradiction.ts`), and assembles a
 * schema-valid `StackEvidence` (02) instance. Zero child-process spawns —
 * every step below is `node:fs`/pure-function only (see
 * `./spawn-surface-scan.test.ts` and `./no-exec-jail.test.ts`).
 */
import { randomUUID } from "node:crypto";
import { CURRENT_SCHEMA_VERSION, StackEvidenceSchema, type StackEvidence } from "@eo/contracts";
import { readTextBounded } from "./fs/safe-read.js";
import { walkRepoTree, type WalkOptions } from "./fs/safe-walk.js";
import { ALL_DETECTORS, buildDetectionContext } from "./detectors/index.js";
import { detectContradictions } from "./contradiction.js";

export interface BuildStackEvidenceOptions extends WalkOptions {
  /** Injectable for deterministic tests; defaults to `crypto.randomUUID()`. */
  readonly idProvider?: () => string;
  /** Injectable for deterministic tests; defaults to `() => new Date().toISOString()`. */
  readonly clock?: () => string;
}

function buildUnresolvedAmbiguity(evidence: {
  readonly findings: StackEvidence["findings"];
}): string[] {
  const notes: string[] = [];
  const hasManifest = evidence.findings.some((f) => f.category === "manifest");
  if (!hasManifest) {
    notes.push(
      "no recognized manifest file found anywhere in the walked tree; ecosystem could not be determined",
    );
  }
  return notes;
}

/**
 * Runs the full detection pass against `rootDir` and returns a schema-valid
 * `StackEvidence`. Never throws for a missing/unreadable root — an absent
 * or empty tree simply yields empty findings plus the "no manifest found"
 * ambiguity note above.
 */
export function buildStackEvidence(
  rootDir: string,
  options: BuildStackEvidenceOptions = {},
): StackEvidence {
  const idProvider = options.idProvider ?? randomUUID;
  const clock = options.clock ?? (() => new Date().toISOString());

  const files = walkRepoTree(rootDir, options);
  const absoluteByRelative = new Map(files.map((f) => [f.relativePath, f.absolutePath]));
  const ctx = buildDetectionContext(files, (relativePath: string) => {
    const absolutePath = absoluteByRelative.get(relativePath);
    return absolutePath === undefined ? undefined : readTextBounded(absolutePath);
  });

  const findings = ALL_DETECTORS.flatMap((detector) => detector.detect(ctx));
  const contradictions = detectContradictions(findings);

  const evidence: StackEvidence = {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    id: idProvider(),
    createdAt: clock(),
    findings,
    contradictions,
    unresolvedAmbiguity: buildUnresolvedAmbiguity({ findings }),
  };

  return StackEvidenceSchema.parse(evidence);
}
