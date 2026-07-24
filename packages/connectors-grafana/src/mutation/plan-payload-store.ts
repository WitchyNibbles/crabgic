import type { GrafanaResourceKind } from "../resource-kinds.js";

/**
 * Plan-payload store — `RemoteMutationPlan` (02's schema) carries only a
 * redacted diff + a desired-state HASH, never the full desired-state body
 * itself (roadmap/02's schema is deliberately payload-agnostic across every
 * connector). This connector's own `planCreate`/`planUpdate` (`../adapter.js`)
 * stash the actual create/update input here, keyed by the plan's own `id`,
 * so `apply()` (`./mutation-apply-client.js`) can later resolve it back —
 * "planning is local-only; no network call" (mirrors
 * `@eo/gateway`'s fake-tracker-provider's own comment on `planCreate`).
 *
 * In-memory only, matching `./snapshot-store.js`'s same scope decision.
 */
export interface GrafanaPlanPayload {
  readonly kind: GrafanaResourceKind;
  readonly action: "create" | "update";
  readonly input: Readonly<Record<string, unknown>>;
}

export class GrafanaPlanPayloadStore {
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
