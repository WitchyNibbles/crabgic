import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

/**
 * Injectable seam between the reproducible-build comparator and "produce an
 * independent directory tree representing a clean checkout of a package's
 * committed source at a given commit-ish" — roadmap/23-release-hardening.md
 * work item 10: "compare ... from two independent clean checkouts."
 * `./testing/fakeCheckoutExporter.ts`-style fakes are used for the bulk of
 * this project's unit tests; `GitArchiveExporter` below is the real
 * implementation, exercised directly by `reproducibleBuildCheck.test.ts`'s
 * own genuine integration test.
 */
export interface CheckoutExporter {
  /** Exports the committed tree at `commitIsh:subPath` into a FRESH, independent directory (never the same directory twice) and returns its path. */
  exportCheckout(commitIsh: string, subPath: string): Promise<string>;
  /** Removes a directory this exporter previously returned. Safe to call more than once. */
  cleanup(exportedDir: string): Promise<void>;
}

export interface GitArchiveExporterOptions {
  /** The real git repository root `git archive` runs against. */
  readonly repoRoot: string;
  /** Injectable purely for this class's own test suite (proving the "git"/"tar" spawn-error and non-zero-exit branches, both otherwise unreachable in a healthy environment) — defaults to the real `"git"`/`"tar"` binaries. */
  readonly gitBinary?: string;
  readonly tarBinary?: string;
}

/**
 * Real `CheckoutExporter`: `git archive <commitIsh>:<subPath> | tar -x`,
 * piped without a shell, into a fresh `os.tmpdir()` scratch directory. Two
 * calls with the same `commitIsh`/`subPath` always extract byte-identical
 * committed content into two INDEPENDENT directories — exactly "two
 * independent clean checkouts of the same commit" (never a working-tree
 * copy, which could carry local uncommitted edits; `git archive` reads only
 * what is actually committed).
 */
export class GitArchiveExporter implements CheckoutExporter {
  constructor(private readonly options: GitArchiveExporterOptions) {}

  async exportCheckout(commitIsh: string, subPath: string): Promise<string> {
    const destDir = await mkdtemp(join(tmpdir(), "eo-release-checkout-"));
    await new Promise<void>((resolve, reject) => {
      const archive = spawn(
        this.options.gitBinary ?? "git",
        ["archive", "--format=tar", `${commitIsh}:${subPath}`],
        { cwd: this.options.repoRoot, stdio: ["ignore", "pipe", "pipe"] },
      );
      const extract = spawn(this.options.tarBinary ?? "tar", ["-x", "-C", destDir], {
        stdio: ["pipe", "ignore", "pipe"],
      });

      // A consumer that exits before draining all of `archive`'s stdout
      // (e.g. a real "tar -x" failure, or this class's own fail-first test
      // fixture swapping in a trivially-exiting binary) closes
      // `extract.stdin` while `.pipe()` is still writing to it — an EPIPE
      // on that underlying stream is an ordinary, EXPECTED outcome here
      // (the real failure signal is `extract`'s own exit code, handled
      // below via `extractExit`), never an uncaught process-crashing
      // exception.
      extract.stdin.on("error", () => undefined);

      let archiveStderr = "";
      let extractStderr = "";
      archive.stderr.on("data", (chunk: Buffer) => {
        archiveStderr += chunk.toString("utf8");
      });
      extract.stderr.on("data", (chunk: Buffer) => {
        extractStderr += chunk.toString("utf8");
      });
      archive.stdout.pipe(extract.stdin);

      let archiveExit: number | null = null;
      let extractExit: number | null = null;
      let settled = false;
      const maybeSettle = (): void => {
        if (settled || archiveExit === null || extractExit === null) return;
        settled = true;
        if (archiveExit !== 0) {
          reject(new Error(`"git archive" failed (exit ${String(archiveExit)}): ${archiveStderr}`));
        } else if (extractExit !== 0) {
          reject(new Error(`"tar -x" failed (exit ${String(extractExit)}): ${extractStderr}`));
        } else {
          resolve();
        }
      };
      archive.on("error", (err) => {
        settled = true;
        reject(err);
      });
      extract.on("error", (err) => {
        settled = true;
        reject(err);
      });
      archive.on("close", (code) => {
        archiveExit = code ?? -1;
        maybeSettle();
      });
      extract.on("close", (code) => {
        extractExit = code ?? -1;
        maybeSettle();
      });
    });
    return destDir;
  }

  async cleanup(exportedDir: string): Promise<void> {
    await rm(exportedDir, { recursive: true, force: true });
  }
}

/**
 * In-memory-backed fake `CheckoutExporter` for unit tests: no real
 * git/tar process is ever spawned. Each call still writes real files to a
 * real temp directory (so downstream `PackRunner`/`tarballComparator`
 * logic under test operates on genuine filesystem paths), but the CONTENT
 * written is whatever `files` says for that `commitIsh` — letting a test
 * construct "two identical checkouts" or "a deliberately perturbed
 * checkout" deterministically, without needing a real git history.
 */
export class FakeCheckoutExporter implements CheckoutExporter {
  constructor(
    private readonly filesByCommit: ReadonlyMap<string, Readonly<Record<string, string>>>,
  ) {}

  async exportCheckout(commitIsh: string, _subPath: string): Promise<string> {
    const files = this.filesByCommit.get(commitIsh);
    if (files === undefined) {
      throw new Error(
        `FakeCheckoutExporter: no fixture files registered for commit-ish "${commitIsh}"`,
      );
    }
    const destDir = await mkdtemp(join(tmpdir(), "eo-release-checkout-fake-"));
    for (const [relPath, content] of Object.entries(files)) {
      const fullPath = join(destDir, relPath);
      await mkdir(dirname(fullPath), { recursive: true });
      await writeFile(fullPath, content, "utf8");
    }
    return destDir;
  }

  async cleanup(exportedDir: string): Promise<void> {
    await rm(exportedDir, { recursive: true, force: true });
  }
}
