/**
 * Durable, file-backed drop-ins for `./plan-payload-store.ts`'s and
 * `./snapshot-store.ts`'s in-memory `Map`s.
 *
 * WHY THIS EXISTS (WP5, 2026-07-25): both stores carried an in-file note
 * calling durability "a 21/23 integration concern ... a carry-forward, not
 * a gap in THIS phase's contract." Wiring the Grafana provider into the
 * shipped `gateway mcp` server (`packages/cli/src/bootstrap.ts`) is that
 * integration, and it converts the carry-forward into a real defect:
 * `observability.plan_create` stashes the desired-state body in one MCP
 * call and `observability.apply` reads it back in another. A restart —
 * or simply a second `gateway mcp` process, which is the normal shape of
 * a stdio server — between the two turns every pending plan into
 * `no stored plan payload for plan <id>`, and every pending update into
 * a mutation with no rollback baseline. `RemoteMutationPlan` deliberately
 * carries only a redacted diff plus a desired-state HASH, so the body
 * genuinely cannot be recovered from the plan itself.
 *
 * SYNCHRONOUS ON PURPOSE — this is a hard constraint, not a preference.
 * `@eo/gateway`'s `MutationApplyClient.buildRequest` is synchronous by
 * contract, and `./mutation-apply-client.ts`'s implementation of it calls
 * `deps.payloadStore.get(plan.id)` with no `await` available at that call
 * site. An async store would have to be threaded through a signature
 * change in `@eo/gateway`'s own contract, which is out of scope here.
 *
 * Discipline copied verbatim from `@eo/supervisor`'s `createFileRegistry`
 * (`packages/supervisor/src/registries/file-registry.ts`): temp file +
 * atomic `renameSync` so a crash mid-write can never leave a truncated
 * store; `0o600` re-asserted after rename; a missing file is an EMPTY
 * store rather than an error; and every read re-validates through zod, so
 * a hand-edited or corrupted file raises instead of handing an
 * unvalidated resource body to the mutation pipeline.
 */
import { randomUUID } from "node:crypto";
import { chmodSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { z } from "zod";
import { GRAFANA_RESOURCE_KINDS } from "../resource-kinds.js";
import type { GrafanaParsedResource } from "../resources/resource-definitions.js";
import type { GrafanaPlanPayload, GrafanaPlanPayloadStoreLike } from "./plan-payload-store.js";
import type { GrafanaRollbackSnapshotStoreLike } from "./snapshot-store.js";

/**
 * Owner-only. A plan payload is the caller's full desired-state resource
 * body and a rollback snapshot is a full copy of a remote one — a Grafana
 * contact point or notification template legitimately carries webhook
 * secrets in `settings` (see `../security/redaction.ts`), so neither file
 * may be group- or world-readable.
 */
const FILE_MODE = 0o600;

const ResourceKindSchema = z.enum(GRAFANA_RESOURCE_KINDS);

const PlanPayloadRecordSchema = z
  .object({
    planId: z.string().min(1),
    payload: z
      .object({
        kind: ResourceKindSchema,
        action: z.enum(["create", "update"]),
        input: z.record(z.string(), z.unknown()),
      })
      .strict(),
  })
  .strict();

const SnapshotRecordSchema = z
  .object({
    planId: z.string().min(1),
    snapshot: z
      .object({
        kind: ResourceKindSchema,
        externalId: z.string().min(1),
        revision: z.string(),
        canonicalUrl: z.string().optional(),
        fields: z.record(z.string(), z.unknown()),
      })
      .strict(),
  })
  .strict();

export interface FileBackedStoreOptions {
  /** Absolute path of the backing JSON file. Parent directories are created on first write. */
  readonly path: string;
}

/** The minimal slice of a zod schema this module needs, declared structurally — same decoupling `createFileRegistry` uses. */
interface RecordSchema<T> {
  parse(value: unknown): T;
}

/**
 * The shared read/write core. Records are a JSON ARRAY of
 * `{ planId, ... }` objects rather than a keyed object, matching
 * `createFileRegistry`'s own on-disk shape (and so a corrupted top-level
 * shape is detectable rather than silently readable as an empty map).
 */
function fileBackedRecords<T extends { readonly planId: string }>(
  path: string,
  schema: RecordSchema<T>,
) {
  /** A missing file is an EMPTY store, not an error — the first plan on a fresh machine must not fail. Anything else propagates. */
  function read(): T[] {
    let raw: string;
    try {
      raw = readFileSync(path, "utf8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw err;
    }
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      throw new TypeError(`Grafana plan store at ${path} is not a JSON array`);
    }
    return parsed.map((record) => schema.parse(record));
  }

  function write(records: readonly T[]): void {
    mkdirSync(dirname(path), { recursive: true });
    const tmpPath = join(dirname(path), `.${randomUUID()}.tmp`);
    try {
      writeFileSync(tmpPath, `${JSON.stringify(records, null, 2)}\n`, {
        encoding: "utf8",
        mode: FILE_MODE,
      });
      renameSync(tmpPath, path);
      // `rename` keeps the temp file's mode, but a pre-existing target may
      // predate this policy — re-assert rather than assume.
      chmodSync(path, FILE_MODE);
    } catch (err) {
      try {
        unlinkSync(tmpPath);
      } catch {
        /* best-effort cleanup; the original error is what matters */
      }
      throw err;
    }
  }

  return {
    read,
    find(planId: string): T | undefined {
      return read().find((record) => record.planId === planId);
    },
    /** Upsert by `planId` — never appends a duplicate, matching the `Map.set` semantics this replaces. */
    upsert(record: T): void {
      // Validate BEFORE persisting: an invalid record must never reach
      // disk, where a later read would then fail closed on data we wrote
      // ourselves.
      const validated = schema.parse(record);
      const records = read();
      const index = records.findIndex((existing) => existing.planId === validated.planId);
      if (index === -1) records.push(validated);
      else records[index] = validated;
      write(records);
    },
    remove(planId: string): void {
      const records = read();
      const remaining = records.filter((record) => record.planId !== planId);
      // Deleting something that was never stored is a no-op, exactly like
      // `Map.delete` — and must not rewrite the file for nothing.
      if (remaining.length === records.length) return;
      write(remaining);
    },
  };
}

/** Durable `GrafanaPlanPayloadStore` — same three methods, backed by a file instead of a `Map`. */
export function createFileGrafanaPlanPayloadStore(
  options: FileBackedStoreOptions,
): GrafanaPlanPayloadStoreLike {
  const records = fileBackedRecords(options.path, PlanPayloadRecordSchema);
  return {
    set(planId, payload) {
      records.upsert({ planId, payload });
    },
    get(planId): GrafanaPlanPayload | undefined {
      return records.find(planId)?.payload;
    },
    clear(planId) {
      records.remove(planId);
    },
  };
}

/** Durable `GrafanaRollbackSnapshotStore` — same three methods plus `size`, backed by a file instead of a `Map`. */
export function createFileGrafanaRollbackSnapshotStore(
  options: FileBackedStoreOptions,
): GrafanaRollbackSnapshotStoreLike {
  const records = fileBackedRecords(options.path, SnapshotRecordSchema);
  return {
    capture(planId, snapshot) {
      records.upsert({ planId, snapshot });
    },
    get(planId): GrafanaParsedResource | undefined {
      const snapshot = records.find(planId)?.snapshot;
      if (snapshot === undefined) return undefined;
      // Rebuilt field-by-field rather than returned as parsed: under
      // `exactOptionalPropertyTypes`, `canonicalUrl?: string` and
      // `canonicalUrl: string | undefined` are different types, and a
      // record that never had a canonical URL must come back WITHOUT the
      // key rather than with an explicit `undefined` — otherwise a
      // round-tripped snapshot stops deep-equalling the one captured.
      return {
        kind: snapshot.kind,
        externalId: snapshot.externalId,
        revision: snapshot.revision,
        ...(snapshot.canonicalUrl !== undefined ? { canonicalUrl: snapshot.canonicalUrl } : {}),
        fields: snapshot.fields,
      };
    },
    clear(planId) {
      records.remove(planId);
    },
    /** Read from DISK, not from a counter — a restarted process must not report an empty store. */
    get size(): number {
      return records.read().length;
    },
  };
}
