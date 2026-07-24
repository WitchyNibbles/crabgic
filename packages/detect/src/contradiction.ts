/**
 * Contradiction detection — roadmap/12 §Goal: "confidence, contradictions,
 * unresolved ambiguity"; §Test plan, "Unit" bullet's own worked example:
 * "conflicting `engines.node` across a monorepo's packages." Groups every
 * `language_runtime` finding by ecosystem; if two or more findings for the
 * SAME ecosystem carry a DIFFERENT declared version value, they contradict
 * each other and are reported together (`conflictingPaths` lists every
 * finding's `path`, min 2 per `StackEvidenceContradictionSchema`).
 */
import type { StackEvidenceContradiction, StackEvidenceFinding } from "@eo/contracts";

function extractDeclaredValue(detail: string): string | undefined {
  const colonIndex = detail.indexOf(":");
  if (colonIndex === -1) return undefined;
  return detail.slice(colonIndex + 1).trim();
}

/**
 * Detects `language_runtime` findings that disagree on the declared
 * version for the same ecosystem. Pure function of the findings array —
 * never re-reads the filesystem.
 */
export function detectContradictions(
  findings: readonly StackEvidenceFinding[],
): StackEvidenceContradiction[] {
  const runtimeFindings = findings.filter((f) => f.category === "language_runtime");
  const byEcosystem = new Map<string, StackEvidenceFinding[]>();
  for (const finding of runtimeFindings) {
    const bucket = byEcosystem.get(finding.ecosystem);
    if (bucket === undefined) {
      byEcosystem.set(finding.ecosystem, [finding]);
    } else {
      bucket.push(finding);
    }
  }

  const contradictions: StackEvidenceContradiction[] = [];
  for (const [ecosystem, group] of byEcosystem) {
    const distinctValues = new Set(
      group.map((f) => extractDeclaredValue(f.detail)).filter((v): v is string => v !== undefined),
    );
    if (distinctValues.size < 2) continue;
    contradictions.push({
      description: `conflicting ${ecosystem} runtime versions declared across ${String(group.length)} location(s): ${[...distinctValues].join(", ")}`,
      conflictingPaths: group.map((f) => f.path),
    });
  }
  return contradictions;
}
