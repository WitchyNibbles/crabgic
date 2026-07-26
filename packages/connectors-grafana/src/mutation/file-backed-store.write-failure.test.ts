import { mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFileGrafanaPlanPayloadStore } from "./file-backed-store.js";
import type { GrafanaPlanPayload } from "./plan-payload-store.js";

/**
 * ADVERSARIAL-REVIEW FIX (2026-07-26). `./file-backed-store.ts`'s write
 * path has a `catch` that does two distinct things — best-effort
 * `unlinkSync(tmpPath)` so a failed write leaks no temp file, then a
 * rethrow so the failure is never swallowed. Both were exercised only by a
 * test guarded with `it.skipIf(process.getuid?.() === 0)`, which made the
 * failure depend on directory mode bits that uid 0 ignores: in the many CI
 * containers that run as root the branch was SILENTLY SKIPPED while the
 * suite still reported green, and a validator's mutation dropping the
 * `unlinkSync` survived.
 *
 * The failure is injected at the syscall boundary instead, so the test is
 * uid-independent and deterministic. `renameSync` is the right injection
 * point rather than `writeFileSync`: it is the step that fails on a real
 * host (EXDEV, a target whose parent went away mid-operation, a full
 * filesystem flushing on close), and it is reached only AFTER the temp file
 * exists — which is precisely the state whose cleanup is under test.
 *
 * Module-wide `node:fs` mocking lives in its own file, exactly as
 * `./file-backed-store.atomicity.test.ts` does, so the pure behavioural
 * suite in `./file-backed-store.test.ts` never inherits it.
 */
vi.mock("node:fs", async (importActual) => {
  const actual = await importActual<typeof import("node:fs")>();
  return { ...actual, renameSync: vi.fn(actual.renameSync) };
});

const PAYLOAD: GrafanaPlanPayload = {
  kind: "dashboard",
  action: "create",
  input: { title: "SLO overview" },
};

const EXISTING_STORE = "[]\n";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "eo-grafana-write-fail-"));
  vi.mocked(renameSync).mockReset();
  vi.mocked(renameSync).mockImplementation(() => {
    throw Object.assign(new Error("EXDEV: simulated cross-device rename"), { code: "EXDEV" });
  });
});

afterEach(() => {
  vi.mocked(renameSync).mockReset();
  rmSync(dir, { recursive: true, force: true });
});

describe("file-backed store write-failure rollback", () => {
  function seedStore(): string {
    const path = join(dir, "payloads.json");
    writeFileSync(path, EXISTING_STORE, { encoding: "utf8", mode: 0o600 });
    return path;
  }

  it("PROPAGATES a write failure — it is never swallowed into a silent success", () => {
    const path = seedStore();
    expect(() => createFileGrafanaPlanPayloadStore({ path }).set("plan-1", PAYLOAD)).toThrow(
      /EXDEV/,
    );
  });

  it("leaves NO temp file behind when the write fails", () => {
    const path = seedStore();
    expect(() => createFileGrafanaPlanPayloadStore({ path }).set("plan-1", PAYLOAD)).toThrow();
    // The temp file demonstrably existed before the failure — the rename is
    // reached only after `writeFileSync(tmpPath, …)` returns — so an empty
    // listing here is the `catch`'s `unlinkSync` having run, not the temp
    // file never having been created.
    expect(vi.mocked(renameSync)).toHaveBeenCalledTimes(1);
    expect(readdirSync(dir).filter((name) => name.endsWith(".tmp"))).toEqual([]);
  });

  it("leaves the PRE-EXISTING store byte-identical — a failed write is not a half-applied one", () => {
    const path = seedStore();
    expect(() => createFileGrafanaPlanPayloadStore({ path }).set("plan-1", PAYLOAD)).toThrow();
    expect(readFileSync(path, "utf8")).toBe(EXISTING_STORE);
    expect(createFileGrafanaPlanPayloadStore({ path }).get("plan-1")).toBeUndefined();
  });
});
