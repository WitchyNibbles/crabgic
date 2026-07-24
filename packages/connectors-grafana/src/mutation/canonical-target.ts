import { isGrafanaResourceKind, type GrafanaResourceKind } from "../resource-kinds.js";

export interface ParsedCanonicalTarget {
  readonly kind: GrafanaResourceKind;
  readonly id: string;
}

/** `RemoteMutationPlan.canonicalTarget`/`RemoteResource`-scoped target is always `"<kind>:<id>"` for this connector (built by `../resources/canonical-target.js`'s counterpart in `../adapter.js`) — this is the single parse site every consumer (mutation-apply-client, adapter) shares. */
export function parseCanonicalTarget(canonicalTarget: string): ParsedCanonicalTarget {
  const separatorIndex = canonicalTarget.indexOf(":");
  if (separatorIndex < 0) {
    throw new Error(
      `malformed Grafana canonicalTarget (expected "<kind>:<id>"): ${canonicalTarget}`,
    );
  }
  const kindRaw = canonicalTarget.slice(0, separatorIndex);
  const id = canonicalTarget.slice(separatorIndex + 1);
  if (!isGrafanaResourceKind(kindRaw)) {
    throw new Error(`unrecognized Grafana resource kind in canonicalTarget: ${kindRaw}`);
  }
  if (id.length === 0) {
    throw new Error(`malformed Grafana canonicalTarget (empty id): ${canonicalTarget}`);
  }
  return { kind: kindRaw, id };
}

export function buildCanonicalTarget(kind: GrafanaResourceKind, id: string): string {
  return `${kind}:${id}`;
}
