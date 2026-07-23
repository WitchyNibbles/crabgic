import {
  CURRENT_SCHEMA_VERSION,
  RenderedArtifactSchema,
  type CommunicationPolicy,
  type RenderedArtifact,
} from "@eo/contracts";
import { randomUUID } from "node:crypto";
import type { ArtifactKind } from "./artifact-kind.js";
import type { LintFinding } from "./lint-types.js";
import { lint } from "./lint.js";
import { normalizeToNfc } from "./unicode-defense.js";

/**
 * `RenderOutcome` — roadmap/17 §Interfaces produced, verbatim union shape.
 */
export type RenderOutcome =
  | { readonly status: "rendered"; readonly artifact: RenderedArtifact }
  | { readonly status: "blocked"; readonly error: "policy_blocked"; readonly findings: readonly LintFinding[] };

/**
 * A caller-supplied candidate generator. Called with no feedback on the
 * first attempt; called with the prior attempt's `LintFinding[]` as
 * feedback on the (sole) regeneration attempt. May be sync or async — this
 * phase has no model/engine access of its own (roadmap/17 §Risks: "the
 * actual re-drafting happens in the caller's process").
 */
export type CandidateGenerator = (feedback?: readonly LintFinding[]) => string | Promise<string>;

export interface RenderWithRegenerationInput {
  readonly kind: ArtifactKind;
  readonly generate: CandidateGenerator;
  readonly policy: CommunicationPolicy;
  /** Injectable for deterministic testing; defaults to `Date.now`-derived `toISOString()`. */
  readonly now?: () => Date;
}

function buildRenderedArtifact(kind: ArtifactKind, content: string, now: () => Date): RenderedArtifact {
  const artifact: RenderedArtifact = {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    id: randomUUID(),
    kind,
    content,
    renderedAt: now().toISOString(),
  };
  // Defense-in-depth (coding-style: "validate at system boundaries"): every
  // artifact this pipeline constructs must itself round-trip through the
  // canonical schema before it is handed back to a caller.
  return RenderedArtifactSchema.parse(artifact);
}

/**
 * `renderWithRegeneration({ kind, generate, policy }): Promise<RenderOutcome>`
 * — roadmap/17 §Interfaces produced, verbatim: "the regenerate-once
 * contract." Calls `generate()`, runs `lint()` on the result; on failure,
 * calls `generate(findings)` exactly once more; a second failure returns
 * `{ status: "blocked", error: "policy_blocked", findings }` WITHOUT ever
 * writing anything anywhere — this phase never performs the downstream git
 * commit/push or provider API call itself.
 *
 * L2 fix (adversarial-review LOW): each candidate is NFC-normalized FIRST,
 * then that exact normalized string is both linted and (on success) stored
 * — never lint the raw candidate and store a different, later-normalized
 * string. Linting anything other than the exact bytes that end up in the
 * `RenderedArtifact` is a validation/storage mismatch: a decomposed-form
 * candidate can differ in codepoint COUNT from its composed form (e.g. "e"
 * + COMBINING ACUTE ACCENT is 2 codepoints raw but 1 composed), so a
 * length-limit verdict computed on the wrong string can wrongly block (or,
 * in principle, wrongly pass) content relative to what is actually stored.
 */
export async function renderWithRegeneration(input: RenderWithRegenerationInput): Promise<RenderOutcome> {
  const { kind, generate, policy } = input;
  const now = input.now ?? (() => new Date());

  const firstCandidate = normalizeToNfc(await generate());
  const firstOutcome = lint(firstCandidate, kind, policy);
  if (firstOutcome.ok) {
    return { status: "rendered", artifact: buildRenderedArtifact(kind, firstCandidate, now) };
  }

  const secondCandidate = normalizeToNfc(await generate(firstOutcome.findings));
  const secondOutcome = lint(secondCandidate, kind, policy);
  if (secondOutcome.ok) {
    return { status: "rendered", artifact: buildRenderedArtifact(kind, secondCandidate, now) };
  }

  return { status: "blocked", error: "policy_blocked", findings: secondOutcome.findings };
}
