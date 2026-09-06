import { chmod, mkdtemp, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { EvalCaseSchema } from "../eval/case-schema.js";
import { CaseFixtureStore } from "../store/case-fixture-store.js";
import { LEARNING_SEALED_DIR_MODE } from "../store/layout.js";

/**
 * `@learning-redteam` — the seal, attacked through this package's OWN door.
 *
 * `./grader-isolation.redteam.test.ts` proves a hostile process
 * calling `node:fs` directly cannot write into a sealed directory. It never
 * asks the question this suite asks: what happens when the attacker uses
 * `CaseFixtureStore` itself?
 *
 * `CaseFixtureStore`'s own doc comment claims the seal is "a REAL OS-level
 * permission change, not an in-process flag", binding on "this exact class's
 * own `write()` method". Measured 2026-09-06 it was not. `write()`'s first
 * filesystem act is `ensureDir(this.#dir, LEARNING_DIR_MODE)`, and `ensureDir`
 * ran `chmod(dir, 0o700)` unconditionally — restoring write permission before
 * the write it was supposed to refuse. The only thing that actually stopped
 * it was `#sealed`, a per-INSTANCE boolean, so a second instance over the same
 * directory sailed past the guard and un-sealed it. That is exactly the
 * "in-process flag" the comment says it is not.
 */
const evalCase = EvalCaseSchema.parse({
  id: "case-1",
  input: { scenario: "sealed" },
  expectedJudgment: true,
  provenanceId: "prov-1",
});

const replacement = EvalCaseSchema.parse({
  id: "case-1",
  input: { scenario: "replaced-after-seal" },
  expectedJudgment: false,
  provenanceId: "prov-1",
});

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "eo-learning-grader-unseal-"));
});

afterEach(async () => {
  // `rm -rf` needs write+execute on every directory it unlinks from; a sealed
  // 0o500 subdirectory would fail its own cleanup with the EACCES this suite
  // provoked on purpose.
  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (entry.isDirectory()) {
      await chmod(join(root, entry.name), 0o700).catch(() => undefined);
    }
  }
  await rm(root, { recursive: true, force: true });
});

describe("@learning-redteam a sealed held-out directory survives this package's own write path", () => {
  it("a SECOND CaseFixtureStore over a sealed directory cannot replace the fixture", async () => {
    const heldOutDir = join(root, "held-out");
    const sealer = new CaseFixtureStore(heldOutDir);
    await sealer.write([evalCase]);
    await sealer.seal();

    // A fresh instance: `#sealed` is false, so the in-process guard is silent
    // and only the OS stands between this call and the graded fixture.
    const attacker = new CaseFixtureStore(heldOutDir);
    await expect(attacker.write([replacement])).rejects.toThrow(/EACCES|EPERM|EROFS/);

    expect(await sealer.read()).toEqual([evalCase]);
  });

  it("leaves the sealed directory's mode exactly as seal() set it", async () => {
    const heldOutDir = join(root, "held-out");
    const sealer = new CaseFixtureStore(heldOutDir);
    await sealer.write([evalCase]);
    await sealer.seal();

    const attacker = new CaseFixtureStore(heldOutDir);
    await attacker.write([replacement]).catch(() => undefined);

    expect((await stat(heldOutDir)).mode & 0o777).toBe(LEARNING_SEALED_DIR_MODE);
  });
});
