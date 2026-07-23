import type { LintFinding, LintStageInput } from "./lint-types.js";

/**
 * Metadata-strip stage — roadmap/17 §Goal pipeline bullet: "strip caller-
 * supplied authorship/history metadata." Since `lint()` is pure and never
 * mutates its input (it returns findings, never a rewritten string — see
 * `docs/evidence/phase-17/README.md` for the documented reading of this
 * bullet), this stage BLOCKS text that embeds git-trailer-style authorship/
 * history metadata lines rather than silently removing them — a caller-
 * supplied candidate that already contains one of these trailers must be
 * regenerated without it, not silently rewritten by this stateless library.
 */

export const STAGE_NAME_METADATA_STRIP = "metadata-strip";

// Git-trailer-style authorship/history lines: "Key: value" at the start of
// a line, where Key is one of the fixed authorship/history trailer names.
const TRAILER_LINE_PATTERN =
  /^\s*(Co-Authored-By|Signed-off-by|Author|Committer|Date|Change-Id)\s*:.*/gim;

function findAllMatches(text: string, pattern: RegExp): RegExpExecArray[] {
  const matches: RegExpExecArray[] = [];
  const re = new RegExp(pattern.source, pattern.flags);
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    matches.push(match);
    if (match[0].length === 0) re.lastIndex += 1;
  }
  return matches;
}

export function metadataStripStage(input: LintStageInput): readonly LintFinding[] {
  const findings: LintFinding[] = [];
  for (const match of findAllMatches(input.candidate, TRAILER_LINE_PATTERN)) {
    findings.push({
      stage: STAGE_NAME_METADATA_STRIP,
      severity: "block",
      message: `caller-supplied authorship/history trailer "${match[1]}:" is not permitted — the renderer, not the candidate, owns provenance metadata`,
      span: { start: match.index, end: match.index + match[0].length },
    });
  }
  return findings;
}
