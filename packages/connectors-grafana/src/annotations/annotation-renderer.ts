import {
  renderGrafanaAnnotation,
  renderWithRegeneration,
  type CandidateGenerator,
  type RenderOutcome,
} from "@eo/renderer";
import type { CommunicationPolicy } from "@eo/contracts";

/**
 * Grafana annotation rendering — roadmap/20-grafana-adapters.md §Interfaces
 * produced: "produced by calling 17's `renderWithRegeneration({ kind:
 * 'grafana_annotation', generate, policy })`... the rendered text follows
 * the `<state> | <service> | <change> | evidence=<ref>` template." This
 * module is the ONLY call site in this package that constructs a
 * `grafana_annotation` `RenderedArtifact` — every Grafana annotation body
 * this connector ever writes is produced here, never hand-assembled
 * elsewhere (roadmap/20 §Test plan, "Conformance": "every rendered
 * annotation is produced via 17's `renderWithRegeneration`").
 */
export interface RenderGrafanaAnnotationArtifactInput {
  readonly state: string;
  readonly service: string;
  readonly change: string;
  readonly evidenceRef: string;
  readonly policy: CommunicationPolicy;
  readonly now?: () => Date;
}

/** The regeneration strategy for a too-long candidate: deterministically shorten `change` (the one free-text field a caller controls) rather than retrying with the identical, already-failing text — a caller-supplied `generate` that never changes on retry would make "regenerate-once" pointless. */
function shortenChange(change: string, maxLength: number): string {
  if (change.length <= maxLength) return change;
  return `${change.slice(0, Math.max(0, maxLength - 1))}…`;
}

export async function renderGrafanaAnnotationArtifact(
  input: RenderGrafanaAnnotationArtifactInput,
): Promise<RenderOutcome> {
  const generate: CandidateGenerator = (feedback) => {
    const change = feedback === undefined ? input.change : shortenChange(input.change, 40);
    return renderGrafanaAnnotation({
      state: input.state,
      service: input.service,
      change,
      evidenceRef: input.evidenceRef,
    });
  };

  return renderWithRegeneration({
    kind: "grafana_annotation",
    generate,
    policy: input.policy,
    ...(input.now !== undefined ? { now: input.now } : {}),
  });
}
