import {
  canonicalFieldsEqual,
  type GrafanaParsedResource,
  type GrafanaResourceDefinition,
} from "../resources/resource-definitions.js";

export interface RollbackHttpResponse {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly bodyText: string;
}

export interface RollbackDeps {
  /** Issues one HTTP call for a resource-definition-built request spec. Kept abstract (never the raw `@eo/gateway` client type) so this module has no direct transport dependency of its own — the caller wires the real `GatewayHttpClient` (or a fake) in. */
  readonly send: (spec: {
    readonly method: string;
    readonly path: string;
    readonly body?: unknown;
    readonly headers?: Readonly<Record<string, string>>;
  }) => Promise<RollbackHttpResponse>;
}

export type RollbackOutcome =
  | { readonly status: "restored"; readonly canonical: GrafanaParsedResource }
  | { readonly status: "blocked"; readonly reason: string };

/**
 * Restores `snapshot` — roadmap/20 §In scope: "rollback classes (reversible
 * → version-checked restore)." Re-reads the CURRENT remote revision first
 * (never restores blind against a stale precondition, mirroring
 * `./precondition.js`'s own discipline), writes the snapshot's fields back
 * conditioned on that fresh revision, then reads back and canonical-
 * compares the result against `snapshot` — exit criterion: "the restored
 * resource is canonical-identical (post-serializer-normalization) to the
 * pre-mutation snapshot." A restore that the remote rejects, or whose
 * read-back doesn't match, is reported `blocked` — never silently assumed
 * to have worked.
 */
export async function restoreFromSnapshot(
  definition: GrafanaResourceDefinition,
  basePath: string,
  snapshot: GrafanaParsedResource,
  deps: RollbackDeps,
): Promise<RollbackOutcome> {
  const getResp = await deps.send(definition.buildGetRequest(basePath, snapshot.externalId));
  if (getResp.status >= 400) {
    return {
      status: "blocked",
      reason: `could not read current state before restore (HTTP ${getResp.status})`,
    };
  }
  const current = definition.parseCanonical(snapshot.externalId, getResp.bodyText, getResp.headers);

  const updateResp = await deps.send(
    definition.buildUpdateRequest(basePath, snapshot.externalId, snapshot.fields, current.revision),
  );
  if (updateResp.status >= 400) {
    return { status: "blocked", reason: `restore write failed (HTTP ${updateResp.status})` };
  }

  const readBackResp = await deps.send(definition.buildGetRequest(basePath, snapshot.externalId));
  if (readBackResp.status >= 400) {
    return {
      status: "blocked",
      reason: `could not read back after restore (HTTP ${readBackResp.status})`,
    };
  }
  const restored = definition.parseCanonical(
    snapshot.externalId,
    readBackResp.bodyText,
    readBackResp.headers,
  );

  if (!canonicalFieldsEqual(restored.fields, snapshot.fields)) {
    return {
      status: "blocked",
      reason: "read-back after restore did not match the pre-mutation snapshot",
    };
  }
  return { status: "restored", canonical: restored };
}
