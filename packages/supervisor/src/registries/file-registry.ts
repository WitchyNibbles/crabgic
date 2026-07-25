/**
 * Durable, file-backed `Registry<T>` — the counterpart to
 * `./registry.ts`'s `createInMemoryRegistry`.
 *
 * WHY THIS EXISTS (2026-07-25): intake (11) builds a ChangeSet, its
 * WorkUnits and the AuthorizationEnvelope and `put`s them into registries.
 * Those registries were in-memory, so the CLI process that ran `run` took
 * the entire approved DAG with it when it exited. Journal replay does not
 * recover them either — `./recovery.ts` rebuilds only `runs` and `workers`,
 * and `JournalEntryType` is a ledger-closed 13-member union with no member
 * carrying a full ChangeSet/WorkUnit/envelope payload, so widening replay
 * would require a ledger ruling change rather than an implementation one.
 *
 * The consequence was concrete: the supervisor daemon could never see a DAG
 * the CLI had approved, so `run.dispatch` (`../router/run-dispatcher.ts`)
 * had nothing to drive. Durability is also precisely what makes `resume`
 * meaningful — a run whose definition cannot survive a daemon restart
 * cannot be resumed after one.
 *
 * SYNCHRONOUS ON PURPOSE: `Registry<T>` is a synchronous interface and
 * every existing caller depends on that. Making it async would ripple
 * through intake, the router and recovery for no benefit at this scale —
 * these files hold tens of records. Writes are temp-file + atomic
 * `renameSync`, so a crash mid-write can never leave a truncated registry.
 *
 * FAILS CLOSED: every read re-validates through the caller's schema, so a
 * hand-edited or corrupted file raises rather than handing an unvalidated
 * record to the dispatcher.
 */
import { randomUUID } from "node:crypto";
import { chmodSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Registry } from "./registry.js";

/** Owner-only: a run's definition names owned paths, allowed commands and repository refs. */
const FILE_MODE = 0o600;

/** The minimal slice of a zod schema this module needs — declared structurally so the registry is not coupled to a zod major version. */
export interface RegistryRecordSchema<T> {
  parse(value: unknown): T;
}

export interface CreateFileRegistryOptions<T> {
  /** Absolute path of the backing JSON file. Parent directories are created on first write. */
  readonly path: string;
  /** Validates every record on read AND on write — the fail-closed boundary. */
  readonly schema: RegistryRecordSchema<T>;
}

export function createFileRegistry<T extends { readonly id: string }>(
  options: CreateFileRegistryOptions<T>,
): Registry<T> {
  const { path, schema } = options;

  /** A missing file is an EMPTY registry, not an error — the first run on a fresh machine must not fail. Anything else propagates. */
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
      throw new TypeError(`file registry at ${path} is not a JSON array`);
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
    get(id) {
      return read().find((record) => record.id === id);
    },
    list() {
      return read();
    },
    put(item) {
      // Validate BEFORE persisting: an invalid record must never reach disk,
      // where a later read would then fail closed on data we wrote ourselves.
      const validated = schema.parse(item);
      const records = read();
      const index = records.findIndex((record) => record.id === validated.id);
      // Replace in place by id rather than appending — `put` is an upsert,
      // matching `createInMemoryRegistry`'s Map-backed semantics exactly.
      if (index === -1) records.push(validated);
      else records[index] = validated;
      write(records);
    },
    query(predicate) {
      return read().filter(predicate);
    },
  };
}
