import { chmod, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CaseFixtureStore } from "../store/case-fixture-store.js";
import { EvalCaseSchema } from "../eval/case-schema.js";

/**
 * `@learning-redteam` — roadmap/22-learning-system.md §Test plan, Security:
 * "grader-tampering attempt (proposer process writes to held-out fixture or
 * grader path) must fail at the fs-permission boundary." §Exit criteria:
 * "fs-permission test proves the proposer namespace cannot write grader/
 * held-out paths."
 *
 * This suite deliberately does NOT go through any proposer-facing API at
 * all (there is none that even accepts a grader path — see
 * `../store/layout.ts`'s own doc comment) — it simulates the WORST case: a
 * hostile or buggy same-uid process that has somehow obtained the raw
 * held-out directory path and calls `node:fs` directly, bypassing every
 * one of this package's own abstractions. If even THAT fails, the
 * boundary is real, not merely a polite convention this package's own
 * code happens to respect.
 */
const evalCase = EvalCaseSchema.parse({
  id: "case-1",
  input: { scenario: "tampered" },
  expectedJudgment: true,
  provenanceId: "prov-1",
});

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "eo-learning-grader-isolation-"));
});

afterEach(async () => {
  // Restore write permission on every sealed subdirectory before cleanup —
  // `rm -rf` needs write+execute on EVERY directory it unlinks entries
  // from, not just the top-level tmp root; a sealed `held-out/` (0o500)
  // would otherwise make its own cleanup fail with the identical EACCES
  // this suite deliberately provoked.
  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (entry.isDirectory()) {
      await chmod(join(root, entry.name), 0o700).catch(() => undefined);
    }
  }
  await rm(root, { recursive: true, force: true });
});

describe("@learning-redteam grader isolation — real OS-level enforcement, not a convention", () => {
  it("before sealing: the held-out store accepts a legitimate write (sanity — the boundary isn't vacuously 'always fails')", async () => {
    const heldOutDir = join(root, "held-out");
    const store = new CaseFixtureStore(heldOutDir);
    await store.write([evalCase]);
    expect(await store.read()).toEqual([evalCase]);
  });

  it("after sealing: a hostile process calling node:fs DIRECTLY (bypassing this package entirely) cannot write a new file into the held-out directory", async () => {
    const heldOutDir = join(root, "held-out");
    const store = new CaseFixtureStore(heldOutDir);
    await store.write([evalCase]);
    await store.seal();

    await expect(
      writeFile(join(heldOutDir, "tamper.json"), JSON.stringify({ hacked: true }), "utf8"),
    ).rejects.toMatchObject({ code: "EACCES" });
  });

  it("after sealing: a hostile process cannot OVERWRITE the existing sealed cases file either", async () => {
    const heldOutDir = join(root, "held-out");
    const store = new CaseFixtureStore(heldOutDir);
    await store.write([evalCase]);
    await store.seal();

    await expect(writeFile(join(heldOutDir, "cases.jsonl"), "{}\n", "utf8")).rejects.toMatchObject({
      code: "EACCES",
    });
  });

  it("after sealing: this package's OWN write() method also refuses (in-process guard, layered on top of the OS boundary)", async () => {
    const heldOutDir = join(root, "held-out");
    const store = new CaseFixtureStore(heldOutDir);
    await store.write([evalCase]);
    await store.seal();

    await expect(store.write([evalCase])).rejects.toThrow(/sealed/);
  });

  it("after sealing: reads still succeed — sealing blocks writes only, never reads", async () => {
    const heldOutDir = join(root, "held-out");
    const store = new CaseFixtureStore(heldOutDir);
    await store.write([evalCase]);
    await store.seal();

    expect(await store.read()).toEqual([evalCase]);
  });

  it("the dev-case store and held-out store are independent instances over disjoint directories — one being sealed never affects the other", async () => {
    const devStore = new CaseFixtureStore(join(root, "dev"));
    const heldOutStore = new CaseFixtureStore(join(root, "held-out"));
    await devStore.write([evalCase]);
    await heldOutStore.write([evalCase]);
    await heldOutStore.seal();

    expect(heldOutStore.isSealed).toBe(true);
    expect(devStore.isSealed).toBe(false);
    // The dev store is still perfectly writable.
    await devStore.write([evalCase, { ...evalCase, id: "case-2" }]);
    expect(await devStore.read()).toHaveLength(2);
  });
});
