import { scanForAttributionTokens } from "@eo/contracts";
import type { LintFinding, LintStageInput } from "./lint-types.js";

/**
 * Attribution-neutral-language stage — roadmap/17 work item 4, built on
 * `renderer-core`'s `scanForAttributionTokens` (shared with 08's belt-and-
 * suspenders assertion; implements adaptation §9's Neutrality test-matrix
 * item). Layers three additional categories on top of the shared scanner's
 * fixed token list (per `renderer-core`'s own doc comment: "phase 17 layers
 * additional first-person/signature/engine-name detection on top using
 * these same primitives"): first-person voice, sign-off closings, and
 * engine-name credit lines.
 */

export const STAGE_NAME_ATTRIBUTION_NEUTRAL = "attribution-neutral";

const FIRST_PERSON_PATTERN = /\b(I|I've|I'm|I'll|we|we've|we're|we'll|our|my|mine)\b/gi;

// L1 fix (adversarial-review LOW, "your call" — treated as an unintended
// over-block and narrowed): the original pattern matched ANY line starting
// with `--`/`—` regardless of what followed, so a unified-diff header
// quoted in a PR body (`--- a/src/index.ts`) or a markdown horizontal rule
// (`---`) both false-blocked as a "signature." The classic plain-text
// signature delimiter (RFC 3676 sig-dash convention) is exactly "--" or an
// em-dash ALONE on its own line — that narrower shape is still caught;
// named sign-off closings ("Regards,", "Best,", ...) are unaffected since
// they always carry trailing text on the same line.
const SIGNATURE_DASH_ALONE_PATTERN = /^\s*(—|--)\s*$/gim;
const SIGNATURE_CLOSING_PATTERN = /^\s*(Regards,|Best,|Cheers,|Thanks,|Sincerely,)\s*.*$/gim;

const ENGINE_NAME_PATTERN = /\b(Claude|Anthropic|ChatGPT|OpenAI|GPT-4|GPT-3|Copilot|Gemini|Bard)\b/gi;

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

export function attributionNeutralStage(input: LintStageInput): readonly LintFinding[] {
  const text = input.candidate;
  const findings: LintFinding[] = [];

  for (const attribution of scanForAttributionTokens(text)) {
    findings.push({
      stage: STAGE_NAME_ATTRIBUTION_NEUTRAL,
      severity: "block",
      message: `attribution/engine-credit token "${attribution.token}" is not permitted (line ${attribution.line})`,
      span: { start: attribution.index, end: attribution.index + attribution.token.length },
    });
  }

  for (const match of findAllMatches(text, FIRST_PERSON_PATTERN)) {
    findings.push({
      stage: STAGE_NAME_ATTRIBUTION_NEUTRAL,
      severity: "block",
      message: `first-person self-referential language ("${match[0]}") is not permitted in neutral communication text`,
      span: { start: match.index, end: match.index + match[0].length },
    });
  }

  for (const match of findAllMatches(text, SIGNATURE_DASH_ALONE_PATTERN)) {
    findings.push({
      stage: STAGE_NAME_ATTRIBUTION_NEUTRAL,
      severity: "block",
      message: `sign-off/signature closing ("${match[0].trim()}") is not permitted`,
      span: { start: match.index, end: match.index + match[0].length },
    });
  }

  for (const match of findAllMatches(text, SIGNATURE_CLOSING_PATTERN)) {
    findings.push({
      stage: STAGE_NAME_ATTRIBUTION_NEUTRAL,
      severity: "block",
      message: `sign-off/signature closing ("${match[0].trim()}") is not permitted`,
      span: { start: match.index, end: match.index + match[0].length },
    });
  }

  for (const match of findAllMatches(text, ENGINE_NAME_PATTERN)) {
    findings.push({
      stage: STAGE_NAME_ATTRIBUTION_NEUTRAL,
      severity: "block",
      message: `engine/vendor name "${match[0]}" is not permitted in neutral communication text`,
      span: { start: match.index, end: match.index + match[0].length },
    });
  }

  return findings;
}
