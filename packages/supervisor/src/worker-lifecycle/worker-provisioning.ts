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

export const WORKER_PROVISION_DIR_MODE = 0o700;

export interface WorkerProvisioning {
  readonly HOME: string;
  readonly TMP: string;
  readonly CLAUDE_CONFIG_DIR: string;
}

/** Creates (idempotently) the three isolated, `0700` dirs a single worker's engine process runs under, nested at `<baseDir>/<workerId>/{home,tmp,claude-config}`. */
export async function provisionWorkerDirs(
  baseDir: string,
  workerId: string,
): Promise<WorkerProvisioning> {
  const root = join(baseDir, workerId);
  const provisioning: WorkerProvisioning = {
    HOME: join(root, "home"),
    TMP: join(root, "tmp"),
    CLAUDE_CONFIG_DIR: join(root, "claude-config"),
  };
  await Promise.all(
    Object.values(provisioning).map((dir) =>
      mkdir(dir, { recursive: true, mode: WORKER_PROVISION_DIR_MODE }),
    ),
  );
  return provisioning;
}
