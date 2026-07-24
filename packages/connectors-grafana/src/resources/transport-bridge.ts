import type { GrafanaHttpRequestSpec } from "./resource-definitions.js";

/** The subset of `@eo/gateway`'s `GatewayHttpRequest`/`MutationHttpRequestSpec` this bridge fills in from a `GrafanaHttpRequestSpec` — callers add the remaining connection-scoped fields (`connectionId`/`tenant`/`resource`/`isWrite`) themselves. */
export interface BridgedHttpRequest {
  readonly url: URL;
  readonly method: GrafanaHttpRequestSpec["method"];
  readonly headers?: Readonly<Record<string, string>>;
  readonly body?: string;
  readonly hasPrecondition?: boolean;
}

/** Resolves `spec.path` against `baseUrl` and JSON-serializes `spec.body`, if present — the one seam every resource definition's request spec crosses on its way into `@eo/gateway`'s transport (`GatewayHttpClient`/the mutation pipeline's `MutationHttpRequestSpec`). */
export function toGatewayHttpRequest(
  spec: GrafanaHttpRequestSpec,
  baseUrl: string,
): BridgedHttpRequest {
  return {
    url: new URL(spec.path, baseUrl),
    method: spec.method,
    ...(spec.headers !== undefined ? { headers: spec.headers } : {}),
    ...(spec.body !== undefined ? { body: JSON.stringify(spec.body) } : {}),
    ...(spec.hasPrecondition !== undefined ? { hasPrecondition: spec.hasPrecondition } : {}),
  };
}
