/**
 * Per-worker `HOME`/`TMP`/`CLAUDE_CONFIG_DIR` provisioning — roadmap/05-
 * supervisor-daemon.md §Worker management: "per-worker `HOME`/`TMP`/
 * `CLAUDE_CONFIG_DIR` provisioning, which 06 later points its SDK
 * `env`/`cwd` at directly." Each worker gets its own isolated triple of
 * directories, `0700`-permissioned, nested under a supervisor-owned base
 * dir — never shared between workers, and never the supervisor's own
 * process `HOME`/`TMPDIR`.
 */
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";

export const WORKER_PROVISION_DIR_MODE = 0o700;

export interface WorkerProvisioning {
  readonly HOME: string;
  readonly TMP: string;
  readonly CLAUDE_CONFIG_DIR: string;
}

/**
 * `TMPDIR` must fit a UNIX DOMAIN SOCKET, which is why it does not live beside
 * the other two.
 *
 * `sun_path` in `sockaddr_un` is **108 bytes** on Linux. The engine's command
 * sandbox creates its bridge sockets under `TMPDIR`, so the length of this path
 * is a hard OS constraint rather than a preference. Nested under the cache root
 * like its siblings it measured **101 characters**
 * (`<cache>/<projectHash>/worktrees/workers/<work-unit-uuid>/tmp`), leaving
 * seven bytes for a socket name — and every worker `Bash` call died with
 * "Failed to create bridge sockets after 5 attempts".
 *
 * WHAT THAT COST, because the failure mode is the interesting part: it did not
 * look like a broken sandbox. Workers could not run their granted commands,
 * reported success anyway, and runs integrated and published work no test had
 * ever been run against (`docs/evidence/phase-25/published-unverified.md`).
 *
 * Isolation is preserved: the digest covers BOTH the base dir and the worker
 * id, so two projects and two workers never share a directory, and the mode
 * stays `0700`. What changes is only the location — the system temp root, which
 * is short by construction and is where a transient socket belongs anyway.
 * `HOME` and `CLAUDE_CONFIG_DIR` are deliberately left under the cache: they
 * hold a session transcript worth finding later, and neither carries a socket.
 */
function shortWorkerTmpDir(baseDir: string, workerId: string): string {
  const digest = createHash("sha256").update(`${baseDir}\u0000${workerId}`).digest("hex");
  return join(tmpdir(), `crabgic-w${digest.slice(0, 12)}`);
}

/** Creates (idempotently) the three isolated, `0700` dirs a single worker's engine process runs under, nested at `<baseDir>/<workerId>/{home,tmp,claude-config}`. */
export async function provisionWorkerDirs(
  baseDir: string,
  workerId: string,
): Promise<WorkerProvisioning> {
  const root = join(baseDir, workerId);
  const provisioning: WorkerProvisioning = {
    HOME: join(root, "home"),
    TMP: shortWorkerTmpDir(baseDir, workerId),
    CLAUDE_CONFIG_DIR: join(root, "claude-config"),
  };
  await Promise.all(
    Object.values(provisioning).map((dir) =>
      mkdir(dir, { recursive: true, mode: WORKER_PROVISION_DIR_MODE }),
    ),
  );
  return provisioning;
}
