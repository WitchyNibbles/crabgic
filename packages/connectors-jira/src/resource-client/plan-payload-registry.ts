/**
 * `RemoteMutationPlan` (P02 schema) deliberately carries only a
 * `redactedDiff` + `desiredStateHash` — never the raw desired-state
 * payload itself (no such field exists on that closed, `.strict()`
 * schema). So the ACTUAL field values / ADF bodies / transition ids a
 * `plan*` builder computed have to survive to apply time some other way.
 *
 * This registry is that side channel — the same pattern
 * `../attachments/attachment-staging.ts` uses for attachment bytes,
 * generalized to every mutating action's payload. `./plan-builder.ts`'s
 * `buildJiraMutationPlan` stores the payload keyed by the plan's own
 * (freshly-generated) `id` at construction time;
 * `./jira-mutation-apply-client.ts`'s `buildRequest` is the only reader,
 * consuming it exactly once, immediately before constructing the real
 * outbound HTTP request. Never serialized into the plan JSON itself, so
 * a caller inspecting a `RemoteMutationPlan` (e.g. an approval-review UI)
 * only ever sees the already-redacted diff — never the raw payload.
 */
export class JiraPlanPayloadRegistry {
  readonly #entries = new Map<string, unknown>();

  put(planId: string, payload: unknown): void {
    this.#entries.set(planId, payload);
  }

  /** Consumes (removes) and returns the stored payload for `planId`. `buildRequest` is called at most once per plan in the mutation pipeline's own lifecycle (a `pending`-recovery retry never re-invokes `buildRequest` — see `@eo/gateway`'s `mutation-pipeline.ts`), so consuming here never starves a legitimate second read. */
  take(planId: string): unknown {
    const payload = this.#entries.get(planId);
    this.#entries.delete(planId);
    return payload;
  }
}
