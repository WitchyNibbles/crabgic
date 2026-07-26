/**
 * `createFileRegistry` — the durable counterpart to `createInMemoryRegistry`.
 *
 * WHY IT EXISTS: intake (11) builds a ChangeSet, its WorkUnits and the
 * AuthorizationEnvelope and `put`s them into registries — which are
 * in-memory. The CLI process that ran `run` then exits and takes the whole
 * approved DAG with it. Journal replay does NOT recover them either:
 * `./recovery.ts` rebuilds only `runs` and `workers`, and `JournalEntryType`
 * is a ledger-closed 13-member union with no entry that carries a full
 * ChangeSet/WorkUnit/envelope payload.
 *
 * The consequence was that the supervisor daemon could never see a DAG the
 * CLI had approved, so `run.dispatch` had nothing to drive. Durability is
 * also what makes `resume` meaningful at all — a run that cannot survive a
 * daemon restart cannot be resumed after one.
 *
 * The `Registry<T>` interface is synchronous, so this implementation is too
 * (sync fs + atomic rename). That is deliberate: matching the existing
 * interface keeps every current caller working unchanged, and these files
 * hold tens of records, not millions.
 */
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ChangeSetSchema, type ChangeSet } from "@crabgic/contracts";
import { buildChangeSet } from "@crabgic/testkit";
import { createFileRegistry } from "./file-registry.js";

let dir: string;
let path: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "eo-file-registry-"));
  path = join(dir, "change-sets.json");
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function newRegistry() {
  return createFileRegistry<ChangeSet>({ path, schema: ChangeSetSchema });
}

const ID_A = "11111111-1111-4111-8111-111111111111";
const ID_B = "22222222-2222-4222-8222-222222222222";

describe("createFileRegistry", () => {
  it("is empty (never throws) when the backing file does not exist yet", () => {
    const registry = newRegistry();
    expect(registry.list()).toEqual([]);
    expect(registry.get(ID_A)).toBeUndefined();
  });

  it("persists a put so a SEPARATE registry instance reads it back identically", () => {
    const changeSet = buildChangeSet({ id: ID_A });
    newRegistry().put(changeSet);

    // The whole point: `run` (CLI process) writes, the daemon reads.
    expect(newRegistry().get(ID_A)).toEqual(changeSet);
    expect(newRegistry().list()).toEqual([changeSet]);
  });

  it("replaces an existing record by id rather than appending a duplicate", () => {
    const registry = newRegistry();
    registry.put(buildChangeSet({ id: ID_A, rollbackStrategy: "first" }));
    registry.put(buildChangeSet({ id: ID_A, rollbackStrategy: "second" }));

    const reread = newRegistry().list();
    expect(reread).toHaveLength(1);
    expect(reread[0]?.rollbackStrategy).toBe("second");
  });

  it("supports query() over the durable contents", () => {
    const registry = newRegistry();
    registry.put(buildChangeSet({ id: ID_A, rollbackStrategy: "keep" }));
    registry.put(buildChangeSet({ id: ID_B, rollbackStrategy: "drop" }));

    expect(
      newRegistry()
        .query((c) => c.rollbackStrategy === "keep")
        .map((c) => c.id),
    ).toEqual([ID_A]);
  });

  it("fails closed on a corrupt/tampered backing file rather than returning unvalidated records", async () => {
    newRegistry().put(buildChangeSet({ id: ID_A }));
    await writeFile(path, JSON.stringify([{ id: "x", schemaVersion: 1 }]), "utf8");

    expect(() => newRegistry().list()).toThrow();
  });

  it("writes owner-only (0600) — run state is nobody else's business", async () => {
    newRegistry().put(buildChangeSet({ id: ID_A }));
    expect((await stat(path)).mode & 0o777).toBe(0o600);
  });

  it("writes valid, re-readable JSON", async () => {
    newRegistry().put(buildChangeSet({ id: ID_A }));
    const raw = await readFile(path, "utf8");
    expect(() => JSON.parse(raw)).not.toThrow();
    expect(Array.isArray(JSON.parse(raw))).toBe(true);
  });
});
