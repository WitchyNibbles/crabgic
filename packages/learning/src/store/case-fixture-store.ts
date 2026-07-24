import { chmod, readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { decodeCasesJsonl, encodeCasesJsonl, type EvalCase } from "../eval/case-schema.js";
import { atomicWriteFile, ensureDir } from "./fs-utils.js";
import {
  LEARNING_DIR_MODE,
  LEARNING_SEALED_DIR_MODE,
  LEARNING_SEALED_FILE_MODE,
} from "./layout.js";

const CASES_FILE_NAME = "cases.jsonl";

/**
 * `CaseFixtureStore` — GRADER-ONLY construction surface for dev/held-out
 * eval case fixtures (roadmap/22-learning-system.md §In scope, "Eval
 * infra"). This class's constructor takes only the ONE directory it is
 * scoped to (`dir`) — there is no parameter, method, or code path here
 * that can reference the SIBLING directory (dev vs. held-out), let alone
 * the proposer's own `registryDir`. Two separate instances, one per
 * directory, is the only way this store is ever used — a grading caller
 * constructs two separate instances, one per directory.
 *
 * SEALING (structural grader isolation, roadmap/22 §Test plan, Security:
 * "gate/fixture immutability to the proposer is what makes grader
 * isolation STRUCTURAL"): `seal()` `chmod`s this store's directory to
 * `LEARNING_SEALED_DIR_MODE` (0o500 — read+execute, no write) and every
 * file already in it to `LEARNING_SEALED_FILE_MODE` (0o400). This is a
 * REAL OS-level permission change, not an in-process flag: after `seal()`
 * resolves, ANY same-uid process attempting `fs.writeFile`/`fs.rename`
 * into this directory — including this exact class's own `write()` method,
 * including a completely different, hand-rolled `node:fs` call that never
 * goes through this package at all — fails with `EACCES`. Proven directly
 * (not merely asserted) in `./grader-isolation.test.ts`.
 */
export class CaseFixtureStore {
  readonly #dir: string;
  #sealed = false;

  constructor(dir: string) {
    this.#dir = dir;
  }

  get dir(): string {
    return this.#dir;
  }

  async write(cases: readonly EvalCase[]): Promise<void> {
    if (this.#sealed) {
      throw new Error(`learning: case fixture store at "${this.#dir}" is sealed — refusing write`);
    }
    await ensureDir(this.#dir, LEARNING_DIR_MODE);
    await atomicWriteFile(join(this.#dir, CASES_FILE_NAME), encodeCasesJsonl(cases), 0o600);
  }

  async read(): Promise<readonly EvalCase[]> {
    try {
      const content = await readFile(join(this.#dir, CASES_FILE_NAME), "utf8");
      return decodeCasesJsonl(content);
    } catch {
      return [];
    }
  }

  /** Seals this directory and every file in it read-only at the OS level — irreversible from within this class (there is no `unseal()`). */
  async seal(): Promise<void> {
    const entries = await readdir(this.#dir).catch(() => [] as string[]);
    for (const name of entries) {
      await chmod(join(this.#dir, name), LEARNING_SEALED_FILE_MODE);
    }
    await chmod(this.#dir, LEARNING_SEALED_DIR_MODE);
    this.#sealed = true;
  }

  get isSealed(): boolean {
    return this.#sealed;
  }
}
