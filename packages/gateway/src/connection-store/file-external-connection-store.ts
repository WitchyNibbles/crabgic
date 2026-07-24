/**
 * Durable, file-backed `ExternalConnectionRepository` — roadmap/16 §In
 * scope: "**`ExternalConnection` store** (02 schema; this phase implements
 * the store) — CRUD + secret-reference resolution over env/file-0600/exec
 * backends. Consumed by 09 (`connection add/list/doctor/capabilities`
 * backend), 18, 19, 20."
 *
 * WHY THIS EXISTS ALONGSIDE `InMemoryExternalConnectionStore` (2026-07-25):
 * the in-memory store is right for the gateway's own in-process use, but it
 * cannot back the CLI. `connection add` runs in one short-lived process and
 * `connection list`/`doctor` run in later ones, so every connection an
 * operator added would vanish the instant the command exited — the
 * "Consumed by 09" half of the sentence above is unsatisfiable without
 * durable storage. Same interface, same schema validation, same
 * immutability discipline; only the backing medium differs.
 *
 * Discipline notes:
 * - EVERY read re-parses through `ExternalConnectionSchema`, so a
 *   hand-edited or tampered file fails closed rather than handing a
 *   downgraded record (say, a `baseUrl` demoted to plain http://) to the
 *   SSRF-guarded HTTP client.
 * - `update` never mutates a stored value: it builds and validates a fresh
 *   object and replaces the entry wholesale, matching
 *   `InMemoryExternalConnectionStore`'s own stated discipline.
 * - Writes are atomic (temp file + `rename`) and `0o600`. The file names
 *   secret REFERENCES, never secret material, but a reference still
 *   discloses where credentials live and is nobody else's business.
 */
import { randomUUID } from "node:crypto";
import { chmod, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { ExternalConnectionSchema, type ExternalConnection } from "@eo/contracts";
import {
  ExternalConnectionNotFoundError,
  type ExternalConnectionRepository,
} from "./external-connection-store.js";

/** Owner-only: the store names secret references (env var names, file paths, exec commands). */
const FILE_MODE = 0o600;

export class FileExternalConnectionStore implements ExternalConnectionRepository {
  readonly #path: string;

  constructor(path: string) {
    this.#path = path;
  }

  /** The absolute path of the backing file — exposed for diagnostics (`doctor`) and tests, never for direct writes. */
  get path(): string {
    return this.#path;
  }

  async create(
    input: Omit<ExternalConnection, "id" | "schemaVersion">,
  ): Promise<ExternalConnection> {
    const created = ExternalConnectionSchema.parse({
      ...input,
      schemaVersion: 1,
      id: randomUUID(),
    });
    const records = await this.#read();
    await this.#write([...records, created]);
    return created;
  }

  async get(id: string): Promise<ExternalConnection | undefined> {
    return (await this.#read()).find((record) => record.id === id);
  }

  async list(): Promise<readonly ExternalConnection[]> {
    return this.#read();
  }

  async update(
    id: string,
    patch: Partial<Omit<ExternalConnection, "id" | "schemaVersion">>,
  ): Promise<ExternalConnection> {
    const records = await this.#read();
    const existing = records.find((record) => record.id === id);
    if (existing === undefined) throw new ExternalConnectionNotFoundError(id);

    // A brand-new validated object — the stored record is replaced, never
    // edited in place, so any reference a caller still holds is unaffected.
    const updated = ExternalConnectionSchema.parse({ ...existing, ...patch, id, schemaVersion: 1 });
    await this.#write(records.map((record) => (record.id === id ? updated : record)));
    return updated;
  }

  async remove(id: string): Promise<void> {
    const records = await this.#read();
    if (!records.some((record) => record.id === id)) {
      throw new ExternalConnectionNotFoundError(id);
    }
    await this.#write(records.filter((record) => record.id !== id));
  }

  /** A missing file is an EMPTY store, not an error — the first `connection list` on a fresh machine must not fail. Anything else (unreadable, malformed, schema-invalid) propagates: failing closed is the point. */
  async #read(): Promise<readonly ExternalConnection[]> {
    let raw: string;
    try {
      raw = await readFile(this.#path, "utf8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw err;
    }
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      throw new TypeError(`connection store at ${this.#path} is not a JSON array`);
    }
    return parsed.map((record) => ExternalConnectionSchema.parse(record));
  }

  /** Temp file + atomic rename, so a crash mid-write can never leave a truncated store behind. */
  async #write(records: readonly ExternalConnection[]): Promise<void> {
    await mkdir(dirname(this.#path), { recursive: true });
    const tmpPath = join(dirname(this.#path), `.${randomUUID()}.tmp`);
    try {
      await writeFile(tmpPath, `${JSON.stringify(records, null, 2)}\n`, {
        encoding: "utf8",
        mode: FILE_MODE,
      });
      await rename(tmpPath, this.#path);
      // `rename` preserves the temp file's mode, but a pre-existing target
      // may predate this policy — re-assert it rather than assume.
      await chmod(this.#path, FILE_MODE);
    } catch (err) {
      await unlink(tmpPath).catch(() => {
        /* best-effort cleanup; the original error is what matters */
      });
      throw err;
    }
  }
}
