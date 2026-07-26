import type { GrafanaResourceKind } from "../resource-kinds.js";

/**
 * Plan-payload store — `RemoteMutationPlan` (02's schema) carries only a
 * redacted diff + a desired-state HASH, never the full desired-state body
 * itself (roadmap/02's schema is deliberately payload-agnostic across every
 * connector). This connector's own `planCreate`/`planUpdate` (`../adapter.js`)
 * stash the actual create/update input here, keyed by the plan's own `id`,
 * so `apply()` (`./mutation-apply-client.js`) can later resolve it back —
 * "planning is local-only; no network call" (mirrors
 * `@crabgic/gateway`'s fake-tracker-provider's own comment on `planCreate`).
 *
 * The class below is in-memory, matching `./snapshot-store.js`'s same
 * scope decision. `./file-backed-store.js`'s
 * `createFileGrafanaPlanPayloadStore` is the durable drop-in the shipped
 * `gateway mcp` server wires instead (WP5, 2026-07-25) — see that module
 * for why a `Map` stops being sufficient the moment plan and apply run in
 * different processes.
 */
export interface GrafanaPlanPayload {
  readonly kind: GrafanaResourceKind;
  readonly action: "create" | "update";
  readonly input: Readonly<Record<string, unknown>>;
}

/**
 * The three-method contract every plan-payload store satisfies.
 *
 * Declared explicitly because the class below carries a `#private` field,
 * which makes its TYPE nominal in TypeScript: a structurally-identical
 * object literal is NOT assignable to `GrafanaPlanPayloadStore`, so a
 * durable drop-in genuinely does need a named interface to be assignable
 * to `GrafanaProviderAdapterDeps.payloadStore` et al. Every consumer
 * takes this interface; the in-memory class implements it, so no existing
 * `new GrafanaPlanPayloadStore()` call site changes.
 */
export interface GrafanaPlanPayloadStoreLike {
  set(planId: string, payload: GrafanaPlanPayload): void;
  get(planId: string): GrafanaPlanPayload | undefined;
  clear(planId: string): void;
}

export class GrafanaPlanPayloadStore implements GrafanaPlanPayloadStoreLike {
  readonly #payloads = new Map<string, GrafanaPlanPayload>();

  set(planId: string, payload: GrafanaPlanPayload): void {
    this.#payloads.set(planId, payload);
  }

  get(planId: string): GrafanaPlanPayload | undefined {
    return this.#payloads.get(planId);
  }

  clear(planId: string): void {
    this.#payloads.delete(planId);
  }
}
