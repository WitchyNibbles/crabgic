import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";

const execFile = promisify(execFileCb);

/**
 * Injectable seam over `npm pack` — roadmap/23-release-hardening.md work
 * item 10: "`npm pack` (dry-run / `--dry-run` or pack to a temp dir) the
 * release artifact." `RealPackRunner` below shells out for real (`npm
 * pack --json --pack-destination <dir>`, never `--dry-run` — packing to a
 * real temp dir is what lets this project read back the actual tarball
 * bytes for the comparator, whereas `--dry-run` alone never writes a
 * file); `FakePackRunner` is used for the bulk of this project's unit
 * tests so they run instantly and deterministically, without spawning
 * `npm` per case.
 */
export interface PackResult {
  readonly tarballPath: string;
  readonly name: string;
  readonly version: string;
  /** `npm`'s own reported shasum of the tarball — cross-checked, never solely trusted, against this project's own independent hash of the tarball bytes (see `tarballComparator.ts`). */
  readonly npmReportedShasum: string;
}

export interface PackRunner {
  /** Runs `npm pack` against `packageDir`, writing the tarball into `destDir`, and returns its path plus npm's own reported metadata. */
  pack(packageDir: string, destDir: string): Promise<PackResult>;
}

interface NpmPackJsonEntry {
  readonly filename: string;
  readonly name: string;
  readonly version: string;
  readonly shasum: string;
}

export class NpmPackFailedError extends Error {
  constructor(
    readonly packageDir: string,
    readonly stderr: string,
  ) {
    super(`"npm pack" failed for ${packageDir}: ${stderr}`);
    this.name = "NpmPackFailedError";
  }
}

/**
 * Parses `npm pack --json`'s stdout into the one `NpmPackJsonEntry` it
 * describes — split out from `RealPackRunner.pack`'s own subprocess
 * plumbing so the "empty array" defensive branch (npm's own documented
 * output shape is always a one-element array for a single-package pack,
 * but this is not statically provable) is directly unit-testable without
 * needing a real, contrived npm failure.
 */
export function parseNpmPackJson(packageDir: string, stdout: string): NpmPackJsonEntry {
  const parsed = JSON.parse(stdout) as readonly NpmPackJsonEntry[];
  const entry = parsed[0];
  if (entry === undefined) {
    throw new NpmPackFailedError(packageDir, "npm pack --json returned an empty array");
  }
  return entry;
}

/** Real `PackRunner`: a genuine `npm pack --json --pack-destination <destDir>` child process, run in `packageDir`. Never `npm install`/`npm publish` — packing alone touches no registry and no lockfile. */
export class RealPackRunner implements PackRunner {
  async pack(packageDir: string, destDir: string): Promise<PackResult> {
    await mkdir(destDir, { recursive: true });
    let stdout: string;
    try {
      const result = await execFile("npm", ["pack", "--json", "--pack-destination", destDir], {
        cwd: packageDir,
        maxBuffer: 16 * 1024 * 1024,
      });
      stdout = result.stdout;
    } catch (err) {
      const stderr =
        err instanceof Error && "stderr" in err
          ? String((err as { stderr: unknown }).stderr)
          : String(err);
      throw new NpmPackFailedError(packageDir, stderr);
    }
    const entry = parseNpmPackJson(packageDir, stdout);
    return {
      tarballPath: join(destDir, entry.filename),
      name: entry.name,
      version: entry.version,
      npmReportedShasum: entry.shasum,
    };
  }
}

/**
 * In-memory-backed fake `PackRunner`: no real `npm` process is ever
 * spawned. Writes a deterministic tarball-STAND-IN file (its content is
 * whatever `contentByPackageDir` says for that `packageDir` — letting a
 * test construct "two identical packs" or "a deliberately perturbed pack"
 * without needing a real npm registry or built `dist/`) and computes a
 * real sha1 over those exact bytes for `npmReportedShasum`, mirroring
 * npm's own reporting shape closely enough for `tarballComparator.ts`'s
 * logic to exercise every branch.
 */
export class FakePackRunner implements PackRunner {
  constructor(
    private readonly contentByPackageDir: ReadonlyMap<string, Buffer>,
    private readonly name = "fixture-package",
    private readonly version = "0.0.0",
  ) {}

  async pack(packageDir: string, destDir: string): Promise<PackResult> {
    const content = this.contentByPackageDir.get(packageDir);
    if (content === undefined) {
      throw new NpmPackFailedError(
        packageDir,
        "FakePackRunner: no fixture content registered for this packageDir",
      );
    }
    await mkdir(destDir, { recursive: true });
    const tarballPath = join(destDir, `${this.name}-${this.version}.tgz`);
    await writeFile(tarballPath, content);
    const npmReportedShasum = createHash("sha1").update(content).digest("hex");
    return { tarballPath, name: this.name, version: this.version, npmReportedShasum };
  }
}

/**
 * A fake `PackRunner` that ignores `packageDir` entirely and returns each
 * entry of `contents` in CALL ORDER (first call gets `contents[0]`, second
 * gets `contents[1]`, ...) — the shape `reproducibleBuildCheck.test.ts`'s
 * own composed-flow tests need, since `checkReproducibleBuild` mints a
 * fresh, unpredictable temp directory per checkout and a test cannot know
 * that path ahead of time to key a `Map` by it.
 */
export class SequentialFakePackRunner implements PackRunner {
  #index = 0;
  constructor(
    private readonly contents: readonly Buffer[],
    private readonly name = "fixture-package",
    private readonly version = "0.0.0",
  ) {}

  async pack(_packageDir: string, destDir: string): Promise<PackResult> {
    const content = this.contents[this.#index];
    if (content === undefined) {
      throw new NpmPackFailedError(
        _packageDir,
        `SequentialFakePackRunner: no fixture content registered for call index ${String(this.#index)}`,
      );
    }
    this.#index += 1;
    await mkdir(destDir, { recursive: true });
    const tarballPath = join(destDir, `${this.name}-${this.version}.tgz`);
    await writeFile(tarballPath, content);
    const npmReportedShasum = createHash("sha1").update(content).digest("hex");
    return { tarballPath, name: this.name, version: this.version, npmReportedShasum };
  }
}

/** Reads a tarball's raw bytes back off disk — the one filesystem read `tarballComparator.ts` needs, factored out so both `RealPackRunner`/`FakePackRunner` outputs are read identically. */
export async function readTarballBytes(tarballPath: string): Promise<Buffer> {
  return readFile(tarballPath);
}
