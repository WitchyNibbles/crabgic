import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { defaultDebounceStatePath, defaultProposalsOutputPath, runDriftCiCli } from "./cli.js";

let dir: string;
let stateRoot: string;
let previousStateRoot: string | undefined;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "eo-drift-ci-"));
  // Round 30 moved the DEFAULT paths under the XDG state root, so the test
  // that exercises the default would otherwise write into the developer's real
  // `~/.local/state/crabgic/`. Redirected for every test in this file, not just
  // that one — the point of moving off `os.tmpdir()` is lost if the suite is
  // the thing that has to remember.
  stateRoot = await mkdtemp(join(tmpdir(), "eo-drift-state-"));
  previousStateRoot = process.env["XDG_STATE_HOME"];
  process.env["XDG_STATE_HOME"] = stateRoot;
});

afterEach(async () => {
  if (previousStateRoot === undefined) delete process.env["XDG_STATE_HOME"];
  else process.env["XDG_STATE_HOME"] = previousStateRoot;
  await rm(dir, { recursive: true, force: true });
  await rm(stateRoot, { recursive: true, force: true });
});

describe("runDriftCiCli — real fs I/O, scoped to its own state/output paths only", () => {
  it("green path: no env overrides -> no proposals, empty proposals file, non-red result", async () => {
    const debounceStatePath = join(dir, "debounce-state.json");
    const proposalsOutputPath = join(dir, "drift-proposals.json");

    const result = await runDriftCiCli({ debounceStatePath, proposalsOutputPath });
    expect(result.redCheck).toBe(false);

    const proposals = JSON.parse(await readFile(proposalsOutputPath, "utf-8")) as unknown[];
    expect(proposals).toEqual([]);
  });

  it("an observed jira version override drifts, debounced across two runs against the SAME persisted state file", async () => {
    const debounceStatePath = join(dir, "debounce-state.json");
    const proposalsOutputPath = join(dir, "drift-proposals.json");
    const previous = process.env["JIRA_OBSERVED_VERSION"];
    process.env["JIRA_OBSERVED_VERSION"] = "1001.0.0";
    try {
      const first = await runDriftCiCli({
        debounceStatePath,
        proposalsOutputPath,
        debounceThreshold: 2,
      });
      expect(first.redCheck).toBe(false);

      const second = await runDriftCiCli({
        debounceStatePath,
        proposalsOutputPath,
        debounceThreshold: 2,
      });
      expect(second.redCheck).toBe(true);

      const proposals = JSON.parse(await readFile(proposalsOutputPath, "utf-8")) as ReadonlyArray<{
        connector: string;
      }>;
      expect(proposals).toHaveLength(1);
      expect(proposals[0]?.connector).toBe("jira");
    } finally {
      if (previous === undefined) delete process.env["JIRA_OBSERVED_VERSION"];
      else process.env["JIRA_OBSERVED_VERSION"] = previous;
    }
  });

  it("a GRAFANA_OBSERVED_VERSION override drifts too", async () => {
    const debounceStatePath = join(dir, "debounce-state.json");
    const proposalsOutputPath = join(dir, "drift-proposals.json");
    const previous = process.env["GRAFANA_OBSERVED_VERSION"];
    process.env["GRAFANA_OBSERVED_VERSION"] = "14.0.0";
    try {
      const result = await runDriftCiCli({
        debounceStatePath,
        proposalsOutputPath,
        debounceThreshold: 1,
      });
      expect(result.redCheck).toBe(true);
    } finally {
      if (previous === undefined) delete process.env["GRAFANA_OBSERVED_VERSION"];
      else process.env["GRAFANA_OBSERVED_VERSION"] = previous;
    }
  });

  it("uses the documented default (outside the repo tree, under the XDG state root) when no explicit paths are supplied", async () => {
    const result = await runDriftCiCli({ debounceThreshold: 1 });
    expect(result.redCheck).toBe(false);
    expect(defaultDebounceStatePath()).toContain("drift-ci");
    expect(defaultProposalsOutputPath()).toContain("drift-ci");
    const proposals = JSON.parse(
      await readFile(defaultProposalsOutputPath(), "utf-8"),
    ) as unknown[];
    expect(proposals).toEqual([]);
  });
});

/**
 * Roast round 30 — the same class the doctor's sweep cursor had.
 *
 * The two defaults were fixed, predictable names under the world-writable
 * `os.tmpdir()`, and `writeJsonFile` did `mkdir(dirname, {recursive:true})` +
 * `writeFile`, both of which follow symlinks. Driven through the REAL exported
 * entry point with no options, so the defaults were the thing under test:
 *
 *   ln -s $ATTACKER_DIR $TMPDIR/eo-drift-ci
 *     -> both `debounce-state.json` and `drift-proposals.json` landed inside
 *        $ATTACKER_DIR.
 *   ln -s ~/victim.json $TMPDIR/eo-drift-ci/debounce-state.json
 *     -> the victim's contents were rewritten with the debounce state.
 *
 * `cli.ts`'s own comment claimed the scheduled workflow "points both paths at
 * `runner.temp` explicitly", which would have confined this to local runs. It
 * does not and never did — `.github/workflows/drift-ci.yml` invokes the CLI
 * with no arguments and hard-codes the DEFAULT paths in its cache and artifact
 * steps — so the scheduled job was exposed too, and a stale comment was doing
 * the work of a mitigation.
 */
describe("runDriftCiCli — its default paths are not attacker-plantable", () => {
  // `stateRoot` comes from the file-level `beforeEach`: one owner of the
  // redirected state home, not two kept in agreement.
  it("resolves its defaults under the XDG state root, never under os.tmpdir()", () => {
    // Resolved per call, not pinned at import: a module-level constant derived
    // from the environment cannot be corrected by the environment, and one
    // derived from `readXdgEnvFromProcess` would throw at IMPORT time wherever
    // HOME is unset, breaking every consumer of this package.
    expect(defaultDebounceStatePath().startsWith(stateRoot)).toBe(true);
    expect(defaultProposalsOutputPath().startsWith(stateRoot)).toBe(true);

    // And with no `XDG_STATE_HOME` at all it falls back to the XDG spec's own
    // default under HOME — never to `os.tmpdir()`. Asserted here rather than
    // as `not.toContain(tmpdir())` against `stateRoot`, which is itself a
    // `mkdtemp` under `tmpdir()`: that assertion could only ever have passed by
    // accident of where the temp dir happened to be.
    const previous = process.env["XDG_STATE_HOME"];
    const previousHome = process.env["HOME"];
    delete process.env["XDG_STATE_HOME"];
    process.env["HOME"] = "/home/stub";
    try {
      expect(defaultDebounceStatePath()).toBe(
        "/home/stub/.local/state/crabgic/drift-ci/debounce-state.json",
      );
    } finally {
      if (previous === undefined) delete process.env["XDG_STATE_HOME"];
      else process.env["XDG_STATE_HOME"] = previous;
      if (previousHome === undefined) delete process.env["HOME"];
      else process.env["HOME"] = previousHome;
    }
  });

  it("refuses to write through a symlink planted at the output path", async () => {
    const { symlink, writeFile, mkdir, readFile, lstat } = await import("node:fs/promises");
    const victim = join(stateRoot, "victim.json");
    const ORIGINAL = '{"do":"not clobber me"}\n';
    await writeFile(victim, ORIGINAL);

    const target = defaultProposalsOutputPath();
    await mkdir(dirname(target), { recursive: true });
    await symlink(victim, target);

    // The run must not clobber the victim. Whether it completes or reports the
    // refusal is a policy question; following the link is not.
    await runDriftCiCli({ debounceThreshold: 1 }).catch(() => undefined);

    expect(await readFile(victim, "utf-8")).toBe(ORIGINAL);
    // Refused, not "fixed" by unlinking — that would be a second write primitive.
    expect((await lstat(target)).isSymbolicLink()).toBe(true);
  });

  it("does not block when its state file is a FIFO", async () => {
    const { mkdir } = await import("node:fs/promises");
    const { execFileSync } = await import("node:child_process");
    const target = defaultDebounceStatePath();
    await mkdir(dirname(target), { recursive: true });
    execFileSync("mkfifo", [target]);

    // `readFile` on a writerless FIFO blocks in `open(2)`. Racing a timer is
    // the only assertion that can FAIL on a hang rather than time the test out.
    const settled = await Promise.race([
      runDriftCiCli({ debounceThreshold: 1 }).then(
        () => true,
        () => true,
      ),
      new Promise<boolean>((resolve) => {
        setTimeout(() => resolve(false), 5_000);
      }),
    ]);
    expect(settled).toBe(true);
  }, 20_000);

  it("creates its state directory unreadable by other accounts", async () => {
    const { stat } = await import("node:fs/promises");
    await runDriftCiCli({ debounceThreshold: 1 });
    expect((await stat(dirname(defaultDebounceStatePath()))).mode & 0o077).toBe(0);
  });
});
