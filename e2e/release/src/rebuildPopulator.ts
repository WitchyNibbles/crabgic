import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";
import {
  createCopyCurrentDistPopulator,
  type BuildOutputPopulator,
} from "./reproducibleBuildCheck.js";

const execFile = promisify(execFileCb);

/**
 * The REBUILDING `BuildOutputPopulator` `reproducibleBuildCheck.ts`'s own
 * file-level doc comment has always pointed at ("a real `release-e2e` CI
 * invocation is expected to inject a populator that actually re-runs the
 * build per checkout") and which no caller ever injected — so every run of
 * this gate has compared two copies of the SAME already-built `dist/`,
 * proving packer determinism but never the exit criterion's own words:
 * "two independent from-clean-checkout BUILDS."
 *
 * It is env-gated rather than default-on for one concrete reason: `npm ci`
 * needs the npm registry, and this repo's ordinary `npm run test:e2e` leg
 * runs offline. A default-on rebuild would turn every offline run into a
 * hard network ERROR instead of a check. `release-e2e.yml` — the one leg
 * with network, since it runs `npm ci` itself — is where
 * `EO_RELEASE_REBUILD_CHECKOUTS=1` belongs, and is where it is now set: on
 * that workflow's `npm run test:e2e` step. This module still does not
 * depend on the workflow; `releaseWorkflowWiring.test.ts` binds the two by
 * reading the real workflow file and asserting it against
 * `REBUILD_CHECKOUTS_ENV_VAR` below, so neither a rename nor a dropped
 * `env:` block can silently strand the flag. Everywhere else the
 * copy-current-dist populator is used AND the gate reports, as a
 * release-blocking reason, that the rebuild leg did not run. The clause is
 * never silently assumed, in either direction.
 */

export const REBUILD_CHECKOUTS_ENV_VAR = "EO_RELEASE_REBUILD_CHECKOUTS";

/** Injectable seam over a real child process — mirrors this project's other real/fake process seams. */
export type RunCommandFn = (command: string, args: readonly string[], cwd: string) => Promise<void>;

/** Real `RunCommandFn`: rejects with the command line and captured stderr on any non-zero exit, so a failed rebuild is never mistaken for a completed one. */
export const realRunCommand: RunCommandFn = async (command, args, cwd) => {
  try {
    await execFile(command, [...args], { cwd, maxBuffer: 64 * 1024 * 1024 });
  } catch (err) {
    const stderr =
      err !== null && typeof err === "object" && "stderr" in err
        ? String((err as { stderr: unknown }).stderr)
        : String(err);
    throw new Error(`"${command} ${args.join(" ")}" failed in ${cwd}: ${stderr}`, { cause: err });
  }
};

export interface RebuildPopulatorOptions {
  readonly runCommand?: RunCommandFn;
}

/**
 * Runs `npm ci` then `npm run build` in the checkout ROOT. Both commands
 * need the whole-repository export `CheckoutExporter.exportCheckout(commitIsh)`
 * now produces: the root manifest, the lockfile, `tsconfig.base.json`, and
 * every sibling `@eo/*` workspace `packages/cli`'s build depends on. A
 * `<commit>:packages/cli` sub-path export — what this project exported
 * before — has none of those, and `npm ci` there cannot run at all.
 */
export function createRebuildFromCleanCheckoutPopulator(
  options: RebuildPopulatorOptions = {},
): BuildOutputPopulator {
  const runCommand = options.runCommand ?? realRunCommand;
  return {
    rebuildsFromCleanCheckout: true,
    async populate(checkoutDir: string): Promise<void> {
      await runCommand("npm", ["ci"], checkoutDir);
      await runCommand("npm", ["run", "build"], checkoutDir);
    },
  };
}

export interface ResolveBuildOutputPopulatorOptions {
  readonly repoRoot: string;
  readonly packageSubPath: string;
  /** The environment to read `EO_RELEASE_REBUILD_CHECKOUTS` from — injected rather than read off `process.env` so the gate is testable both ways. */
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly runCommand?: RunCommandFn;
}

/** Picks the rebuilding populator iff `EO_RELEASE_REBUILD_CHECKOUTS` is exactly `"1"`; otherwise the copy-current-dist one. See this module's file-level doc comment for why the default is the weaker of the two and how the gate keeps that honest. */
export function resolveBuildOutputPopulator(
  options: ResolveBuildOutputPopulatorOptions,
): BuildOutputPopulator {
  if (options.env[REBUILD_CHECKOUTS_ENV_VAR] === "1") {
    return createRebuildFromCleanCheckoutPopulator(
      options.runCommand !== undefined ? { runCommand: options.runCommand } : {},
    );
  }
  return createCopyCurrentDistPopulator(options.repoRoot, options.packageSubPath);
}
