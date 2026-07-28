import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  EnvelopePolicySchema,
  GRANTABLE_COMMAND_PREFIXES,
  isVacuousPolicy,
  type EnvelopePolicy,
  type GrantableCommandPrefix,
} from "@crabgic/contracts";

/**
 * Deriving a CANDIDATE `EnvelopePolicy` from what a repository already says
 * about itself (ledger Gap 18; roadmap/10's install-time scope amendment).
 *
 * WHAT THIS IS NOT. It is not an approval. `install` renders the candidate
 * and the owner confirms it; nothing here writes anything, and nothing
 * reachable from a manager session may call the writer that does. The
 * derivation exists so that confirming a policy is reading one sentence per
 * line rather than authoring a schema from scratch — an owner who cannot see
 * what they are granting is not meaningfully granting it.
 *
 * DEFAULT DENY SURVIVES DERIVATION. Network destinations, credential
 * references, remote resources and unix sockets are never derived. There is
 * no signal in a repository that reliably distinguishes "this project talks
 * to the network" from "this project may talk to any network destination
 * without review", and guessing in that direction is the one place a wrong
 * default is unrecoverable. They stay empty and are widened by hand or not at
 * all.
 */

/** Source directories worth granting when present. Ordinary, boring, and deliberately short. */
const CANDIDATE_SOURCE_DIRS = [
  "src",
  "lib",
  "app",
  "packages",
  "apps",
  "components",
  "test",
  "tests",
  "docs",
] as const;

/**
 * Build output and cache directories worth granting as scratch.
 *
 * This list is exactly what `sandbox-profile.ts` says it cannot know: the
 * compiler's inputs are one envelope's four fields, so `dist`/`coverage`/
 * `.turbo` are unknowable there and knowable here. Being wrong in this list
 * is a *reliability* failure (a build breaks and the owner adds an entry),
 * not a security one — nothing here is outside the worktree.
 */
const CANDIDATE_SCRATCH_DIRS = [
  "dist",
  "build",
  "out",
  "coverage",
  ".next",
  ".turbo",
  ".cache",
  "target",
  "node_modules/.cache",
] as const;

/**
 * Workspace container directories whose children each get their own build
 * output. Roast round 3 (F1) found what their absence cost: on this very
 * repo every package sets `outDir: "./dist"`, so `tsc -b` writes
 * `packages/<name>/dist` for all 15 projects — none of which a top-level
 * `dist` grant covers, and the top-level `dist` it does grant does not exist
 * here at all. The owner's obvious repair — a `packages` glob — grants nothing, and
 * grants nothing. Enumerating the children at derive time keeps every grant a
 * literal path, which is the property that makes a policy readable.
 */
const WORKSPACE_CONTAINER_DIRS = ["packages", "apps"] as const;

export interface DerivePolicyOptions {
  readonly projectDir: string;
  readonly id: string;
  readonly createdAt: string;
  /** Injected so derivation is testable without a real tree. Returns the entries directly under `projectDir`. */
  readonly listDirectories: (projectDir: string) => readonly string[];
}

export interface DerivedPolicy {
  readonly policy: EnvelopePolicy;
  /**
   * True when the derivation found nothing to grant, so every dispatch would
   * be refused. `install` must NOT write one of these silently: roast round 1
   * (F9) established that an all-empty policy passes every structural check a
   * doctor can make — it exists, it parses, it is 0600, it is untracked —
   * while making the product completely non-functional. A repo with no
   * recognisable source directory produces exactly this.
   */
  readonly vacuous: boolean;
}

/** Reads the project's own script names, so `allowedCommands` reflects what it can actually run. */
function readPackageScripts(projectDir: string): ReadonlySet<string> {
  try {
    const raw = readFileSync(join(projectDir, "package.json"), "utf8");
    const parsed = JSON.parse(raw) as { scripts?: Record<string, unknown> };
    return new Set(Object.keys(parsed.scripts ?? {}));
  } catch {
    return new Set();
  }
}

/**
 * Maps the project's own scripts onto the four command prefixes a compiled
 * profile can actually grant.
 *
 * `git status`/`git diff` are granted unconditionally: they are read-only
 * inspections a worker needs to describe its own change, and withholding them
 * buys nothing — the sandbox already bounds where anything may be written.
 * `npm run test`/`npm run build` are granted only when the project declares a
 * script of that name, so a repo with no build step does not carry a grant it
 * cannot use.
 */
function deriveCommands(scripts: ReadonlySet<string>): readonly GrantableCommandPrefix[] {
  const granted: GrantableCommandPrefix[] = ["git status", "git diff"];
  if (scripts.has("test")) granted.push("npm run test");
  if (scripts.has("build")) granted.push("npm run build");
  return GRANTABLE_COMMAND_PREFIXES.filter((prefix) => granted.includes(prefix));
}

/**
 * Per-package build output for a workspace repo — `packages/<name>/dist` and
 * friends, one literal entry each.
 *
 * Enumerated rather than pattern-matched. A glob here would be a second
 * matching language on the write-grant surface, and `validateOwnedPath`
 * rejects one anyway, so a pattern would be silently dropped at compile time
 * while still appearing in the policy an owner reads.
 */
function deriveWorkspaceScratchPaths(
  options: DerivePolicyOptions,
  present: ReadonlySet<string>,
): readonly string[] {
  const paths: string[] = [];
  for (const container of WORKSPACE_CONTAINER_DIRS) {
    if (!present.has(container)) continue;
    for (const child of options.listDirectories(join(options.projectDir, container))) {
      for (const output of CANDIDATE_SCRATCH_DIRS) {
        // Only the shallow build outputs; `node_modules/.cache` is a
        // top-level concern and is already granted above.
        if (output.includes("/")) continue;
        paths.push(`${container}/${child}/${output}`);
      }
    }
  }
  return paths;
}

export function derivePolicy(options: DerivePolicyOptions): DerivedPolicy {
  const present = new Set(options.listDirectories(options.projectDir));

  const policy = EnvelopePolicySchema.parse({
    schemaVersion: 1,
    id: options.id,
    createdAt: options.createdAt,
    allowedPathPrefixes: CANDIDATE_SOURCE_DIRS.filter((dir) => present.has(dir)),
    // Scratch paths are granted whether or not they exist yet: a build output
    // directory is created BY the build, so requiring it to be present at
    // install time would deny exactly the directory the first run needs.
    allowedWriteScratchPaths: [
      ...CANDIDATE_SCRATCH_DIRS,
      ...deriveWorkspaceScratchPaths(options, present),
    ],
    allowedCommands: deriveCommands(readPackageScripts(options.projectDir)),
    // Deliberately not derived — see the file-level note.
    allowedNetworkDestinations: [],
    allowedCredentialReferences: [],
    allowedRemoteResourceReferences: [],
    allowUnixSockets: false,
  });

  return { policy, vacuous: isVacuousPolicy(policy) };
}
