import { McpServerCapabilityEntrySchema, type CapabilityManifestEntry } from "@eo/contracts";

/**
 * The optional official Grafana MCP wrap — roadmap/20-grafana-adapters.md
 * §In scope: "Official Grafana MCP wrap: optional read-only capability
 * behind a flag; HTTP APIs remain primary and are the only path exercised
 * by default fixtures." §Risks: "this phase declares it only as an
 * optional, flag-gated `CapabilityManifest` entry and never enables it by
 * default." Quarantine (digest pinning, SBOM, sandboxed pre-execution
 * test) is owned by phase 12 — this module produces the DECLARATION
 * `CapabilityManifestEntry` only; it never runs, pins a digest signature,
 * or approves anything itself. The `decision` field is hard-coded to
 * `"pending"` at the type level (no parameter can override it) — this
 * function structurally cannot auto-approve the capability it declares.
 */
export interface GrafanaMcpWrapOptions {
  readonly enabled: boolean;
  /** Required when `enabled` — the digest-pinned MCP server binary/image this entry declares (roadmap/12's quarantine pipeline resolves it to `approved`/`rejected`, never this module). */
  readonly digest?: string;
  readonly sourceRef?: string;
}

export class GrafanaMcpWrapConfigError extends Error {
  constructor(message: string) {
    super(`Grafana MCP wrap configuration error: ${message}`);
    this.name = "GrafanaMcpWrapConfigError";
    Object.freeze(this);
  }
}

/**
 * Builds the optional Grafana MCP wrap's `CapabilityManifest` entry when
 * `options.enabled` — returns `undefined` otherwise (the default posture:
 * HTTP APIs remain the only path). Never returns an `"approved"` decision.
 */
export function buildGrafanaMcpWrapCapabilityEntry(
  options: GrafanaMcpWrapOptions,
): CapabilityManifestEntry | undefined {
  if (!options.enabled) return undefined;
  if (options.digest === undefined || options.digest.length === 0) {
    throw new GrafanaMcpWrapConfigError(
      "a digest is required to declare the Grafana MCP wrap entry",
    );
  }
  return McpServerCapabilityEntrySchema.parse({
    kind: "mcp_server",
    name: "grafana-mcp",
    digest: options.digest,
    ...(options.sourceRef !== undefined ? { sourceRef: options.sourceRef } : {}),
    decision: "pending",
  });
}
