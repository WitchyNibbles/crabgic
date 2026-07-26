import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createFileGrafanaPlanPayloadStore,
  createFileGrafanaRollbackSnapshotStore,
} from "./file-backed-store.js";
import type { GrafanaPlanPayload } from "./plan-payload-store.js";
import type { GrafanaParsedResource } from "../resources/resource-definitions.js";

/**
 * WP5 (2026-07-25): `./plan-payload-store.ts` and `./snapshot-store.ts` are
 * in-memory `Map`s, flagged in-file as a 21/23 carry-forward. Wiring the
 * Grafana provider into the shipped `gateway mcp` server makes that a real
 * defect rather than a scoping note: `planCreate` runs in one MCP call and
 * `observability.apply` reads `payloadStore.get(plan.id)` in another, so a
 * process restart between the two turns every pending plan into "no stored
 * plan payload for plan <id>".
 *
 * These durable drop-ins copy `@crabgic/supervisor`'s `createFileRegistry`
 * discipline verbatim — temp-file + atomic `renameSync`, `0o600`, schema
 * re-validation on every read, missing file = empty store — and stay
 * SYNCHRONOUS-READ because `MutationApplyClient.buildRequest` is
 * synchronous by contract (`./mutation-apply-client.ts`'s `buildRequest`
 * calls `deps.payloadStore.get(plan.id)` with no `await` available).
 *
 * Written before `./file-backed-store.ts` exists — the required red state.
 */
const PAYLOAD: GrafanaPlanPayload = {
  kind: "dashboard",
  action: "create",
  input: { title: "SLO overview", panels: [] },
};

const SNAPSHOT: GrafanaParsedResource = {
  kind: "dashboard",
  externalId: "dash-1",
  revision: "7",
  canonicalUrl: "https://grafana.example.com/d/dash-1",
  fields: { title: "SLO overview" },
};

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "eo-grafana-store-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("createFileGrafanaPlanPayloadStore", () => {
  it("round-trips a payload through a real file, synchronously", () => {
    const path = join(dir, "payloads.json");
    const store = createFileGrafanaPlanPayloadStore({ path });
    store.set("plan-1", PAYLOAD);
    expect(store.get("plan-1")).toEqual(PAYLOAD);
    expect(existsSync(path)).toBe(true);
  });

  it("survives a process boundary — a SECOND store instance over the same path reads what the first wrote", () => {
    const path = join(dir, "payloads.json");
    createFileGrafanaPlanPayloadStore({ path }).set("plan-1", PAYLOAD);
    // A brand-new instance shares no in-process state with the writer.
    expect(createFileGrafanaPlanPayloadStore({ path }).get("plan-1")).toEqual(PAYLOAD);
  });

  it("treats a missing file as an EMPTY store, never an error", () => {
    const store = createFileGrafanaPlanPayloadStore({ path: join(dir, "nope", "payloads.json") });
    expect(store.get("plan-1")).toBeUndefined();
  });

  it("writes the backing file 0o600 — a plan payload is a caller-supplied resource body", () => {
    const path = join(dir, "payloads.json");
    createFileGrafanaPlanPayloadStore({ path }).set("plan-1", PAYLOAD);
    expect(statSync(path).mode & 0o777).toBe(0o600);
  });

  /**
   * `writeFileSync`'s `mode` is masked by the process umask and can only
   * ever REMOVE bits, so the post-rename `chmodSync` is the only thing
   * that can restore them. Under a umask that strips the owner-write bit,
   * a store without that re-assert leaves the file 0o400 and the NEXT
   * write fails — which is exactly the failure this pins.
   */
  it("re-asserts 0o600 even when the umask stripped bits at creation time", () => {
    const path = join(dir, "payloads.json");
    const previous = process.umask(0o200);
    try {
      createFileGrafanaPlanPayloadStore({ path }).set("plan-1", PAYLOAD);
      expect(statSync(path).mode & 0o777).toBe(0o600);
    } finally {
      process.umask(previous);
    }
  });

  it("re-asserts 0o600 over a pre-existing world-readable file", () => {
    const path = join(dir, "payloads.json");
    mkdirSync(dir, { recursive: true });
    writeFileSync(path, "[]\n", "utf8");
    chmodSync(path, 0o644);
    createFileGrafanaPlanPayloadStore({ path }).set("plan-1", PAYLOAD);
    expect(statSync(path).mode & 0o777).toBe(0o600);
  });

  it("upserts by planId rather than appending a duplicate", () => {
    const path = join(dir, "payloads.json");
    const store = createFileGrafanaPlanPayloadStore({ path });
    store.set("plan-1", PAYLOAD);
    store.set("plan-1", { ...PAYLOAD, action: "update" });
    expect(store.get("plan-1")?.action).toBe("update");
    expect(JSON.parse(readFileSync(path, "utf8"))).toHaveLength(1);
  });

  it("clear() removes only the named plan", () => {
    const path = join(dir, "payloads.json");
    const store = createFileGrafanaPlanPayloadStore({ path });
    store.set("plan-1", PAYLOAD);
    store.set("plan-2", PAYLOAD);
    store.clear("plan-1");
    expect(store.get("plan-1")).toBeUndefined();
    expect(store.get("plan-2")).toEqual(PAYLOAD);
  });

  it("clear() on an unknown planId is a TRUE no-op — it does not even touch the backing file", () => {
    const path = join(dir, "payloads.json");
    const store = createFileGrafanaPlanPayloadStore({ path });
    expect(() => store.clear("never-stored")).not.toThrow();
    // Rewriting an unchanged store would create a file for a store that
    // has never held anything, and would rewrite (and re-chmod) a real one
    // on every miss.
    expect(existsSync(path)).toBe(false);
  });

  it("clear() of an unknown planId leaves an EXISTING file byte-identical", () => {
    const path = join(dir, "payloads.json");
    const store = createFileGrafanaPlanPayloadStore({ path });
    store.set("plan-1", PAYLOAD);
    const before = readFileSync(path, "utf8");
    store.clear("some-other-plan");
    expect(readFileSync(path, "utf8")).toBe(before);
  });

  it("leaves no temp file behind after a write", () => {
    const path = join(dir, "payloads.json");
    createFileGrafanaPlanPayloadStore({ path }).set("plan-1", PAYLOAD);
    expect(readdirSync(dir).filter((name) => name.endsWith(".tmp"))).toEqual([]);
  });

  it("FAILS CLOSED on a corrupted backing file rather than returning a half-parsed payload", () => {
    const path = join(dir, "payloads.json");
    writeFileSync(path, JSON.stringify([{ planId: "plan-1", payload: { kind: "not-a-kind" } }]));
    expect(() => createFileGrafanaPlanPayloadStore({ path }).get("plan-1")).toThrow();
  });

  it("FAILS CLOSED when the backing file is not a JSON array", () => {
    const path = join(dir, "payloads.json");
    writeFileSync(path, JSON.stringify({ "plan-1": PAYLOAD }));
    expect(() => createFileGrafanaPlanPayloadStore({ path }).get("plan-1")).toThrow(
      /not a JSON array/,
    );
  });

  it("propagates a NON-ENOENT read error instead of silently reporting an empty store", () => {
    // A directory where the store file should be: `readFileSync` fails
    // with EISDIR, which is emphatically not "no plans stored yet".
    const path = join(dir, "payloads.json");
    mkdirSync(path, { recursive: true });
    expect(() => createFileGrafanaPlanPayloadStore({ path }).get("plan-1")).toThrow();
  });

  it("refuses to persist at all when the store path is a DIRECTORY, and leaves no temp file behind", () => {
    const path = join(dir, "payloads.json");
    mkdirSync(path, { recursive: true });
    // CORRECTED 2026-07-25: this case fails in `read()` (EISDIR), BEFORE
    // the write is attempted — its original comment claimed it exercised
    // the write path's rollback, which coverage disproved. The genuine
    // write-failure case is the test below.
    expect(() => createFileGrafanaPlanPayloadStore({ path }).set("plan-1", PAYLOAD)).toThrow();
    expect(readdirSync(dir).filter((name) => name.endsWith(".tmp"))).toEqual([]);
  });

  /**
   * MOVED (2026-07-26) to `./file-backed-store.write-failure.test.ts`. The
   * write path's `catch` — best-effort temp-file cleanup, then a rethrow —
   * used to be driven here by making the parent directory read-only, under
   * `it.skipIf(process.getuid?.() === 0)`. Under root, which many CI
   * containers are, that SILENTLY SKIPPED: the branch went untested in CI
   * while the suite still reported green, and a validator's mutation
   * dropping the `unlinkSync` survived. The replacement injects the failure
   * at the `renameSync` boundary instead, so it is uid-independent.
   */

  it("refuses to persist a payload that does not validate — an invalid record never reaches disk", () => {
    const path = join(dir, "payloads.json");
    const store = createFileGrafanaPlanPayloadStore({ path });
    expect(() =>
      store.set("plan-1", { kind: "wormhole", action: "create", input: {} } as never),
    ).toThrow();
    expect(existsSync(path)).toBe(false);
  });
});

describe("createFileGrafanaRollbackSnapshotStore", () => {
  it("round-trips a captured snapshot across instances", () => {
    const path = join(dir, "snapshots.json");
    createFileGrafanaRollbackSnapshotStore({ path }).capture("plan-1", SNAPSHOT);
    expect(createFileGrafanaRollbackSnapshotStore({ path }).get("plan-1")).toEqual(SNAPSHOT);
  });

  it("round-trips a snapshot with no canonicalUrl (the field is optional)", () => {
    const path = join(dir, "snapshots.json");
    const store = createFileGrafanaRollbackSnapshotStore({ path });
    const bare: GrafanaParsedResource = {
      kind: "annotation",
      externalId: "a-1",
      revision: "1",
      fields: {},
    };
    store.capture("plan-1", bare);
    // `toStrictEqual`, not `toEqual`: `toEqual` treats `{ canonicalUrl:
    // undefined }` as equal to an object with no such key at all, so it
    // cannot tell a faithful round-trip from one that reintroduces the
    // field as explicit `undefined` — which `exactOptionalPropertyTypes`
    // makes a different type.
    expect(store.get("plan-1")).toStrictEqual(bare);
    expect(Object.keys(store.get("plan-1")!)).not.toContain("canonicalUrl");
  });

  it("reports its size from disk, so a restart does not report an empty store", () => {
    const path = join(dir, "snapshots.json");
    createFileGrafanaRollbackSnapshotStore({ path }).capture("plan-1", SNAPSHOT);
    expect(createFileGrafanaRollbackSnapshotStore({ path }).size).toBe(1);
  });

  it("clear() removes only the named plan's snapshot", () => {
    const path = join(dir, "snapshots.json");
    const store = createFileGrafanaRollbackSnapshotStore({ path });
    store.capture("plan-1", SNAPSHOT);
    store.capture("plan-2", SNAPSHOT);
    store.clear("plan-1");
    expect(store.get("plan-1")).toBeUndefined();
    expect(store.size).toBe(1);
  });

  it("treats a missing file as an empty store of size 0", () => {
    const store = createFileGrafanaRollbackSnapshotStore({ path: join(dir, "absent.json") });
    expect(store.get("plan-1")).toBeUndefined();
    expect(store.size).toBe(0);
  });

  it("writes 0o600 — a rollback snapshot is a full copy of a remote resource body", () => {
    const path = join(dir, "snapshots.json");
    createFileGrafanaRollbackSnapshotStore({ path }).capture("plan-1", SNAPSHOT);
    expect(statSync(path).mode & 0o777).toBe(0o600);
  });

  it("FAILS CLOSED on a corrupted snapshot record", () => {
    const path = join(dir, "snapshots.json");
    writeFileSync(path, JSON.stringify([{ planId: "plan-1", snapshot: { kind: "dashboard" } }]));
    expect(() => createFileGrafanaRollbackSnapshotStore({ path }).get("plan-1")).toThrow();
  });
});
