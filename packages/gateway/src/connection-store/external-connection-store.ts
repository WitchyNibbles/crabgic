/**
 * `ExternalConnection` store — roadmap/16-gateway-core.md §Interfaces
 * produced: "`ExternalConnection` store (02 schema; this phase implements
 * the store) — CRUD + secret-reference resolution over env/file-0600/exec
 * backends. Consumed by 09 (`connection add/list/doctor/capabilities`
 * backend), 18, 19, 20." Work item 1.
 *
 * This phase's own storage-backend choice (out of scope's own text leaves
 * the CLI command surface to 09): a pluggable `ExternalConnectionRepository`
 * interface plus an in-memory reference implementation — sufficient for
 * every consumer named above, which reads/writes through this store's own
 * typed methods rather than any particular persistence mechanism. A
 * durable (file/journal-backed) implementation is a natural drop-in later
 * without changing this module's public surface.
 */

import { randomUUID } from "node:crypto";
import { ExternalConnectionSchema, type ExternalConnection } from "@eo/contracts";
import { resolveSecretReference } from "../secrets/secret-reference-resolver.js";

export class ExternalConnectionNotFoundError extends Error {
  readonly connectionId: string;

  constructor(connectionId: string) {
    super(`ExternalConnection not found: ${connectionId}`);
    this.name = "ExternalConnectionNotFoundError";
    this.connectionId = connectionId;
    Object.freeze(this);
  }
}

export interface ExternalConnectionRepository {
  create(input: Omit<ExternalConnection, "id" | "schemaVersion">): Promise<ExternalConnection>;
  get(id: string): Promise<ExternalConnection | undefined>;
  list(): Promise<readonly ExternalConnection[]>;
  update(
    id: string,
    patch: Partial<Omit<ExternalConnection, "id" | "schemaVersion">>,
  ): Promise<ExternalConnection>;
  remove(id: string): Promise<void>;
}

/**
 * In-memory `ExternalConnectionRepository`. Immutability discipline: every
 * stored value is the frozen, schema-validated result of
 * `ExternalConnectionSchema.parse` — `update` never mutates the existing
 * record, it constructs and validates a brand-new object and replaces the
 * map entry wholesale.
 */
export class InMemoryExternalConnectionStore implements ExternalConnectionRepository {
  readonly #records = new Map<string, ExternalConnection>();

  async create(
    input: Omit<ExternalConnection, "id" | "schemaVersion">,
  ): Promise<ExternalConnection> {
    const candidate = ExternalConnectionSchema.parse({
      ...input,
      schemaVersion: 1,
      id: randomUUID(),
    });
    this.#records.set(candidate.id, candidate);
    return candidate;
  }

  async get(id: string): Promise<ExternalConnection | undefined> {
    return this.#records.get(id);
  }

  async list(): Promise<readonly ExternalConnection[]> {
    return [...this.#records.values()];
  }

  async update(
    id: string,
    patch: Partial<Omit<ExternalConnection, "id" | "schemaVersion">>,
  ): Promise<ExternalConnection> {
    const existing = this.#records.get(id);
    if (existing === undefined) {
      throw new ExternalConnectionNotFoundError(id);
    }
    const updated = ExternalConnectionSchema.parse({ ...existing, ...patch });
    this.#records.set(id, updated);
    return updated;
  }

  async remove(id: string): Promise<void> {
    this.#records.delete(id);
  }
}

/**
 * Resolves the live secret value backing a stored connection's
 * `secretRef` — the one call site the mutation pipeline / HTTP client use
 * to attach credentials, never reaching into `connection.secretRef`
 * directly and never persisting the resolved value anywhere.
 */
export async function resolveConnectionSecret(connection: ExternalConnection): Promise<string> {
  return resolveSecretReference(connection.secretRef);
}
