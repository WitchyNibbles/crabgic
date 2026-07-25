import { execFile as execFileCb } from "node:child_process";
import { readFileSync } from "node:fs";
import { promisify } from "node:util";

const execFile = promisify(execFileCb);

/**
 * "package published" — the one clause of roadmap/23-release-hardening.md's
 * reproducible-build exit criterion (`:136`, restated verbatim in
 * `e2e/report/src/checklist.ts`) that had NO check of any kind. The gate
 * scored the tarball comparison, the SDK pin, publish metadata, the three
 * prepared artifacts, the CHANGELOG, the tag, the marketplace pin and the
 * npm-name record — and asserted publication on the strength of nothing.
 * Once the owner performs the four release actions, the item would have
 * reported PASS with the package still unpublished.
 *
 * Unlike `npmNameRecheck.ts` — which deliberately does NOT shell out,
 * because a name-availability check that silently passes when the registry
 * is unreachable would be worse than none — this check queries the real
 * registry, because it can do so FAIL-CLOSED: no answer is a
 * release-blocking reason, never a pass. The two modules are opposite
 * halves of the same rule: never let an unreachable network manufacture a
 * green.
 *
 * `npm view` reads the registry only; it publishes nothing, mutates
 * nothing, and needs no credentials, so it is safe under roadmap/23's
 * PREPARE-DON'T-PUBLISH owner decision.
 */

/** Raw result of one `npm view <name> versions --json` invocation. */
export interface NpmViewOutput {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

/** Injectable seam over the real `npm view` child process — mirrors `packRunner.ts`/`publishDryRunCheck.ts`'s identical real/fake split. */
export interface NpmViewRunner {
  viewVersions(packageName: string): Promise<NpmViewOutput>;
}

/**
 * Real `NpmViewRunner`. Retries are disabled and both the fetch and the
 * child process are bounded, so an offline leg produces a prompt "no
 * answer" (which this check treats as a release blocker) rather than
 * stalling the gate on npm's default retry ladder.
 */
export class RealNpmViewRunner implements NpmViewRunner {
  async viewVersions(packageName: string): Promise<NpmViewOutput> {
    const args = [
      "view",
      packageName,
      "versions",
      "--json",
      "--fetch-retries=0",
      "--fetch-timeout=15000",
    ];
    try {
      const { stdout, stderr } = await execFile("npm", args, {
        timeout: 60_000,
        maxBuffer: 16 * 1024 * 1024,
      });
      return { stdout, stderr, exitCode: 0 };
    } catch (err) {
      const asExecErr = err as { stdout?: string; stderr?: string; code?: number };
      return {
        stdout: asExecErr.stdout ?? "",
        stderr: asExecErr.stderr ?? String(err),
        exitCode: asExecErr.code ?? 1,
      };
    }
  }
}

/** Fake `NpmViewRunner` for unit tests — no real npm process, no network. */
export class FakeNpmViewRunner implements NpmViewRunner {
  constructor(private readonly output: NpmViewOutput) {}

  async viewVersions(_packageName: string): Promise<NpmViewOutput> {
    return this.output;
  }
}

export interface PublicationCheckResult {
  readonly packageName: string;
  readonly version: string;
  /** `packages/cli/package.json`'s own `"private"` field — `true` today, which `npm publish` itself refuses. */
  readonly manifestPrivate: boolean;
  /** `true` only when the registry gave a usable answer (a version list, or an explicit 404). Offline runs are `false`. */
  readonly registryAnswered: boolean;
  readonly publishedVersions: readonly string[];
  /** `true` iff the registry answered AND lists exactly the release version being gated. */
  readonly published: boolean;
  /** Quotable release-blocking reasons — empty iff the clause is genuinely met. */
  readonly reasons: readonly string[];
}

export interface CheckPublicationOptions {
  /** Absolute path to the published package's `package.json`. */
  readonly packageJsonPath: string;
  readonly packageName: string;
  /** The release version being gated, e.g. `"1.0.0"` — presence of the NAME is not publication of the RELEASE. */
  readonly version: string;
  readonly runner: NpmViewRunner;
}

const E404_PATTERN = /\bE404\b|404 Not Found/;

interface RegistryAnswer {
  readonly answered: boolean;
  readonly versions: readonly string[];
  /** Whatever npm actually said when it gave no usable answer — quoted into the reason so an offline CI leg is diagnosable from the gate report alone. */
  readonly diagnostic: string;
}

/** First non-empty line of npm's output, trimmed to a quotable length. */
function firstLine(output: NpmViewOutput): string {
  const text = `${output.stderr}\n${output.stdout}`.trim();
  const line = text.split("\n").find((l) => l.trim().length > 0) ?? "(no output)";
  return line.trim().slice(0, 200);
}

/** Interprets one `npm view … versions --json` invocation. An explicit 404 IS an answer ("this name has nothing published"); anything else non-zero is treated as no answer at all. */
function interpretRegistryAnswer(output: NpmViewOutput): RegistryAnswer {
  if (output.exitCode !== 0) {
    return E404_PATTERN.test(`${output.stdout}\n${output.stderr}`)
      ? { answered: true, versions: [], diagnostic: "" }
      : { answered: false, versions: [], diagnostic: firstLine(output) };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(output.stdout) as unknown;
  } catch {
    // A zero exit whose payload is not JSON is not something this check can
    // read as a version list — a proxy error page, for instance. Refusing to
    // guess is the fail-closed answer.
    return { answered: false, versions: [], diagnostic: firstLine(output) };
  }
  if (Array.isArray(parsed)) {
    return { answered: true, versions: parsed.map((v) => String(v)), diagnostic: "" };
  }
  // npm collapses a SINGLE published version to a bare JSON string rather
  // than a one-element array; anything else is a shape this check does not
  // read as versions.
  if (typeof parsed === "string") return { answered: true, versions: [parsed], diagnostic: "" };
  return { answered: true, versions: [], diagnostic: "" };
}

function unmet(detail: string): string {
  return `${detail} — the exit criterion's "package published" clause is UNMET.`;
}

/**
 * Reads the package manifest and asks the real registry whether
 * `packageName@version` exists. Throws only for an unreadable/malformed
 * manifest; every release-relevant negative is a structured reason.
 */
export async function checkPublication(
  options: CheckPublicationOptions,
): Promise<PublicationCheckResult> {
  const manifest = JSON.parse(readFileSync(options.packageJsonPath, "utf8")) as {
    readonly private?: unknown;
  };
  const manifestPrivate = manifest.private === true;

  const { answered, versions, diagnostic } = interpretRegistryAnswer(
    await options.runner.viewVersions(options.packageName),
  );
  const published = answered && versions.includes(options.version);

  const reasons: string[] = [];
  if (manifestPrivate) {
    reasons.push(
      unmet(
        `${options.packageJsonPath} is \`"private": true\`, which \`npm publish\` itself refuses, ` +
          `so ${options.packageName} cannot have been published from this manifest at all`,
      ),
    );
  }
  if (!answered) {
    reasons.push(
      `the npm registry gave no usable answer for "${options.packageName}", so whether the ` +
        `package is published could not be verified — this check fails CLOSED, because an ` +
        `unreachable registry must never be read as a successful publication. npm said: ` +
        `${diagnostic}. The exit criterion's "package published" clause is therefore ` +
        `UNVERIFIED here.`,
    );
  } else if (!published) {
    reasons.push(
      unmet(
        `the npm registry reports that ${options.packageName}@${options.version} has never been ` +
          `published (registry-known versions: ${versions.length === 0 ? "none" : versions.join(", ")}); ` +
          `running the real \`npm publish --provenance\` is an owner release action this gate ` +
          `deliberately never performs`,
      ),
    );
  }

  return {
    packageName: options.packageName,
    version: options.version,
    manifestPrivate,
    registryAnswered: answered,
    publishedVersions: versions,
    published,
    reasons,
  };
}
