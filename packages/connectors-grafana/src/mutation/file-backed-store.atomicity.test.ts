import { dirname, join } from "node:path";
import { mkdtempSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import type { GrafanaPlanPayload } from "./plan-payload-store.js";
import { createFileGrafanaPlanPayloadStore } from "./file-backed-store.js";

/**
 * ADVERSARIAL-REVIEW FIX (2026-07-25). `./file-backed-store.ts`'s header
 * claims `@eo/supervisor`'s `createFileRegistry` discipline "copied
 * verbatim … temp file + atomic `renameSync` so a crash mid-write can
 * never leave a truncated store". A validator's mutation replaced the
 * `renameSync` with a plain `writeFileSync(path, readFileSync(tmpPath))`
 * and every one of the 23 behavioural tests in
 * `./file-backed-store.test.ts` stayed green: the two implementations are
 * observationally identical from outside, differing only in whether a
 * crash between the two syscalls can leave a half-written file.
 *
 * True atomicity cannot be asserted from a unit test without fault
 * injection at the syscall boundary. What CAN be asserted, and is here, is
 * the mechanism the claim rests on: the target path is never written in
 * place, and the only thing that ever creates it is a rename FROM A PATH
 * IN THE SAME DIRECTORY — same directory being what guarantees the same
 * filesystem, which is what makes `rename(2)` atomic at all. A
 * cross-device temp path would satisfy "it calls renameSync" and still not
 * be atomic, so the directory check is load-bearing rather than
 * decorative.
 *
 * This lives in its own file because it mocks `node:fs` module-wide, which
 * `./file-backed-store.test.ts` (a pure behavioural suite over real files)
 * must not inherit.
 */
vi.mock("node:fs", async (importActual) => {
  const actual = await importActual<typeof import("node:fs")>();
  return {
    ...actual,
    renameSync: vi.fn(actual.renameSync),
    writeFileSync: vi.fn(actual.writeFileSync),
  };
});

const PAYLOAD: GrafanaPlanPayload = {
  kind: "dashboard",
  action: "create",
  input: { title: "SLO overview" },
};

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "eo-grafana-atomic-"));
  vi.mocked(renameSync).mockClear();
  vi.mocked(writeFileSync).mockClear();
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("file-backed store write atomicity", () => {
  it("materialises the store by RENAMING a same-directory temp file, never by writing the target in place", () => {
    const path = join(dir, "grafana-plan-payloads.json");
    createFileGrafanaPlanPayloadStore({ path }).set("plan-1", PAYLOAD);

    expect(vi.mocked(renameSync)).toHaveBeenCalledTimes(1);
    const [from, to] = vi.mocked(renameSync).mock.calls[0]!;
    expect(to).toBe(path);
    // Same directory ⇒ same filesystem ⇒ `rename(2)` is atomic. A temp file
    // in `os.tmpdir()` would be a different device on many hosts and the
    // rename would degrade to a copy (or fail with EXDEV).
    expect(dirname(String(from))).toBe(dir);
    expect(String(from)).not.toBe(path);

    // The bytes only ever reach the temp path. If the target itself were
    // written directly, a crash mid-write would leave a truncated store —
    // exactly the failure the header says cannot happen.
    expect(vi.mocked(writeFileSync).mock.calls.map((call) => call[0])).not.toContain(path);
  });

  it("holds for an OVERWRITE too, not just for the file's creation", () => {
    const path = join(dir, "grafana-plan-payloads.json");
    const store = createFileGrafanaPlanPayloadStore({ path });
    store.set("plan-1", PAYLOAD);
    vi.mocked(renameSync).mockClear();
    vi.mocked(writeFileSync).mockClear();

    store.set("plan-2", PAYLOAD);

    expect(vi.mocked(renameSync)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(renameSync).mock.calls[0]![1]).toBe(path);
    expect(vi.mocked(writeFileSync).mock.calls.map((call) => call[0])).not.toContain(path);
    // …and the overwrite really did land, so this is not passing on a no-op.
    expect(store.get("plan-2")).toEqual(PAYLOAD);
  });
});
