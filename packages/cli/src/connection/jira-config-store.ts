/**
 * Durable, file-backed store for `JiraConnectionConfig` — the connector's
 * own auth/deployment companion object for a stored `ExternalConnection`.
 *
 * WHY IT EXISTS. `ConnectionDependencies.discoverCapabilities` recorded
 * the gap precisely: "`JiraConnectionConfigSchema` gained
 * `oauthClientIdSecretRef`/`oauthClientSecretRef` in WP5, but NOTHING
 * PERSISTS a `JiraConnectionConfig`, and P02's `ExternalConnection`
 * carries exactly ONE `secretRef` by a roadmap/19 ruling that must not be
 * widened." A Jira Cloud connection therefore had nowhere to record which
 * credential shape it uses, so it could not authenticate at all (issue
 * #135). This is the storage that was missing — beside the connection,
 * never folded into it, exactly as roadmap/19 ruled: "no change to
 * `ExternalConnection` itself."
 *
 * WHY IN `packages/cli`. It is the composition root's own state, keyed by
 * `externalConnectionId` and written by `connection add`. Putting it in
 * `@crabgic/gateway` would make the provider-neutral connection store
 * carry a Jira-shaped table; putting it in `@crabgic/connectors-jira`
 * would give a connector a durable file of its own, which no connector
 * has. It sits beside `connections.json` under the same XDG state root,
 * with the same 0600 posture, for the same reason.
 *
 * Discipline mirrors `FileExternalConnectionStore` deliberately: every
 * read re-parses through the connector's own schema (a hand-edited file
 * fails closed rather than yielding an unknown `authMode`), writes are
 * atomic (temp file + rename) and owner-only, and a stored value is
 * replaced wholesale rather than edited in place.
 */

import { randomUUID } from "node:crypto";
import { chmod, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { JiraConnectionConfigSchema, type JiraConnectionConfig } from "@crabgic/connectors-jira";

/** Owner-only: the file names secret references — never material, but still a map of where this host's Jira credentials live. */
const FILE_MODE = 0o600;

export interface JiraConnectionConfigStore {
  get(externalConnectionId: string): Promise<JiraConnectionConfig | undefined>;
  list(): Promise<readonly JiraConnectionConfig[]>;
  put(config: JiraConnectionConfig): Promise<JiraConnectionConfig>;
  remove(externalConnectionId: string): Promise<void>;
}

export class FileJiraConnectionConfigStore implements JiraConnectionConfigStore {
  readonly #path: string;

  constructor(path: string) {
    this.#path = path;
  }

  /** The absolute path of the backing file — for diagnostics and tests, never for direct writes. */
  get path(): string {
    return this.#path;
  }

  async get(externalConnectionId: string): Promise<JiraConnectionConfig | undefined> {
    return (await this.#read()).find((c) => c.externalConnectionId === externalConnectionId);
  }

  async list(): Promise<readonly JiraConnectionConfig[]> {
    return this.#read();
  }

  /** Upsert by `externalConnectionId` — one config per connection, so re-adding replaces rather than accumulating a second answer to "how does this connection authenticate". */
  async put(config: JiraConnectionConfig): Promise<JiraConnectionConfig> {
    const validated = JiraConnectionConfigSchema.parse(config);
    const records = await this.#read();
    const others = records.filter((c) => c.externalConnectionId !== validated.externalConnectionId);
    await this.#write([...others, validated]);
    return validated;
  }

  /** Absent is not an error: a connection may legitimately have no config (Grafana's do not), and `connection remove` must be idempotent. */
  async remove(externalConnectionId: string): Promise<void> {
    const records = await this.#read();
    await this.#write(records.filter((c) => c.externalConnectionId !== externalConnectionId));
  }

  /** A missing file is an EMPTY store, not an error. Anything else (unreadable, malformed, schema-invalid) propagates — failing closed is the point. */
  async #read(): Promise<readonly JiraConnectionConfig[]> {
    let raw: string;
    try {
      raw = await readFile(this.#path, "utf8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw err;
    }
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      throw new TypeError(`Jira connection config store at ${this.#path} is not a JSON array`);
    }
    return parsed.map((record) => JiraConnectionConfigSchema.parse(record));
  }

  /** Temp file + atomic rename, so a crash mid-write can never leave a truncated store behind. */
  async #write(records: readonly JiraConnectionConfig[]): Promise<void> {
    await mkdir(dirname(this.#path), { recursive: true });
    const tmpPath = join(dirname(this.#path), `.${randomUUID()}.tmp`);
    try {
      await writeFile(tmpPath, `${JSON.stringify(records, null, 2)}\n`, {
        encoding: "utf8",
        mode: FILE_MODE,
      });
      await rename(tmpPath, this.#path);
      // `rename` preserves the temp file's mode, but a pre-existing target
      // may predate this policy — re-assert rather than assume.
      await chmod(this.#path, FILE_MODE);
    } catch (err) {
      await unlink(tmpPath).catch(() => {
        /* best-effort cleanup; the original error is what matters */
      });
      throw err;
    }
  }
}
