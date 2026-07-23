/**
 * Grafana annotation template — roadmap/17 §Templates:
 * "`<state> | <service> | <change> | evidence=<ref>`."
 */
export interface GrafanaAnnotationInput {
  readonly state: string;
  readonly service: string;
  readonly change: string;
  readonly evidenceRef: string;
}

export function renderGrafanaAnnotation(input: GrafanaAnnotationInput): string {
  return `${input.state} | ${input.service} | ${input.change} | evidence=${input.evidenceRef}`;
}
