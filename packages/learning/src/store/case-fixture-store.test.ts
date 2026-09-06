import { chmod, mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { EvalCaseSchema, type EvalCase } from "../eval/case-schema.js";
import { CaseFixtureStore } from "./case-fixture-store.js";

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "eo-learning-fixture-store-"));
});

afterEach(async () => {
  // A sealed directory is 0o500; widen it again or the cleanup cannot unlink.
  await chmod(join(root, "held-out"), 0o700).catch(() => undefined);
  await rm(root, { recursive: true, force: true });
});

function buildCase(id: string): EvalCase {
  return EvalCaseSchema.parse({
    id,
    input: { actualJudgment: true },
    expectedJudgment: true,
    provenanceId: `prov-${id}`,
  });
}

describe("CaseFixtureStore.read", () => {
  it("round-trips what write() stored", async () => {
    const store = new CaseFixtureStore(join(root, "dev"));
    await store.write([buildCase("c1")]);
    expect(await store.read()).toEqual([buildCase("c1")]);
  });

  it("returns an empty set when the fixture file has never been written", async () => {
    const store = new CaseFixtureStore(join(root, "never-written"));
    expect(await store.read()).toEqual([]);
  });

  /**
   * `read()` used to `catch { return []; }` around everything, so a fixture
   * file that EXISTS but does not decode — a truncated line, a hand-edit, a
   * `ZodError` from one bad record — read as zero cases. Downstream,
   * `runEvalSuite` graded that empty set, and (before it learned to refuse)
   * reported a clean pass. A corrupt grader must be loud, not empty.
   */
  it("throws rather than reporting zero cases when the fixture exists but does not decode", async () => {
    const dir = join(root, "corrupt");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "cases.jsonl"), "{ this is not json\n", "utf8");
    const store = new CaseFixtureStore(dir);
    await expect(store.read()).rejects.toThrow();
  });

  it("throws when a single record in an otherwise-valid fixture fails the schema", async () => {
    const dir = join(root, "half-valid");
    await mkdir(dir, { recursive: true });
    const good = JSON.stringify(buildCase("c1"));
    await writeFile(join(dir, "cases.jsonl"), `${good}\n{"id":"c2"}\n`, "utf8");
    const store = new CaseFixtureStore(dir);
    await expect(store.read()).rejects.toThrow();
  });

  it("throws when the fixture file cannot be read at all", async () => {
    const dir = join(root, "unreadable");
    await mkdir(dir, { recursive: true });
    const file = join(dir, "cases.jsonl");
    await writeFile(file, "", "utf8");
    await chmod(file, 0o000);
    const store = new CaseFixtureStore(dir);
    const mode = (await stat(file)).mode & 0o777;
    // Running as root makes the mode unenforceable; skip rather than lie.
    if (mode === 0 && process.getuid?.() !== 0) {
      await expect(store.read()).rejects.toThrow();
    }
    await chmod(file, 0o600);
  });
});
