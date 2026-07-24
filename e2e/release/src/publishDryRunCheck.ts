import { execFile as execFileCb } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";

const execFile = promisify(execFileCb);

/**
 * Publication dry-run — roadmap/23-release-hardening.md work item 10:
 * "`npm publish --dry-run` wiring (asserts provenance config present,
 * package metadata, Apache-2.0, public access) — capture output, DO NOT
 * actually publish." `npm publish --provenance` itself needs a supported
 * CI's OIDC identity token and would simply fail outside one — this
 * module therefore never passes `--provenance` for real; it asserts the
 * STATIC config prerequisites a provenance-attested publish needs
 * (license, `publishConfig.access`, a `repository` field) and captures a
 * real `npm publish --dry-run`'s output (which itself never touches the
 * registry — `npm`'s own dry-run semantics — and is additionally
 * structurally incapable of a real publish here regardless, since
 * `packages/cli/package.json` is `"private": true"`, which `npm publish`
 * itself refuses).
 */

export interface PublishDryRunOutput {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

/** Injectable seam over the real `npm publish --dry-run` child process — mirrors `packRunner.ts`'s identical real/fake split. */
export interface PublishRunner {
  publishDryRun(packageDir: string): Promise<PublishDryRunOutput>;
}

/** Real `PublishRunner`: shells `npm publish --dry-run` in `packageDir`. Never `--provenance` (see this module's file-level doc comment) and never omits `--dry-run`. */
export class RealPublishRunner implements PublishRunner {
  async publishDryRun(packageDir: string): Promise<PublishDryRunOutput> {
    try {
      const { stdout, stderr } = await execFile("npm", ["publish", "--dry-run"], {
        cwd: packageDir,
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

/** Fake `PublishRunner` for unit tests — no real npm process spawned. */
export class FakePublishRunner implements PublishRunner {
  constructor(private readonly output: PublishDryRunOutput) {}

  async publishDryRun(_packageDir: string): Promise<PublishDryRunOutput> {
    return this.output;
  }
}

export interface PackageMetadataCheck {
  readonly hasLicenseApache2: boolean;
  readonly hasPublicAccess: boolean;
  /** A `repository` field is required for npm's own provenance-attestation to resolve the source repo — see the exit criterion this checks against. */
  readonly hasRepositoryField: boolean;
  readonly hasName: boolean;
  /** `true` iff every check above is `true`. Provenance-attestation-ready today only when this is `true`. */
  readonly ready: boolean;
  readonly findings: readonly string[];
}

/** Reads `packageJsonPath` and checks the static metadata prerequisites a real, provenance-attested `npm publish` needs. Never throws for a MISSING prerequisite (that is an ordinary, structurally-reported finding) — only for an unreadable/malformed manifest file. */
export function checkPackageMetadata(packageJsonPath: string): PackageMetadataCheck {
  const manifest = JSON.parse(readFileSync(packageJsonPath, "utf8")) as {
    readonly name?: string;
    readonly license?: string;
    readonly repository?: unknown;
    readonly publishConfig?: { readonly access?: string };
  };

  const hasName = typeof manifest.name === "string" && manifest.name.length > 0;
  const hasLicenseApache2 = manifest.license === "Apache-2.0";
  const hasPublicAccess = manifest.publishConfig?.access === "public";
  const hasRepositoryField = manifest.repository !== undefined;

  const findings: string[] = [];
  if (!hasName) findings.push('"name" is missing.');
  if (!hasLicenseApache2) findings.push('"license" is not exactly "Apache-2.0".');
  if (!hasPublicAccess) findings.push('"publishConfig.access" is not exactly "public".');
  if (!hasRepositoryField) {
    findings.push(
      '"repository" field is missing — npm provenance attestation needs it to resolve the ' +
        "source repo; a real provenance-attested publish would not be ready until this is added.",
    );
  }

  return {
    hasName,
    hasLicenseApache2,
    hasPublicAccess,
    hasRepositoryField,
    ready: hasName && hasLicenseApache2 && hasPublicAccess && hasRepositoryField,
    findings,
  };
}

export interface PublishDryRunResult {
  readonly metadata: PackageMetadataCheck;
  readonly dryRun: PublishDryRunOutput;
  /** Structural guarantee this module upholds regardless of any check's outcome — see `runPublishDryRun`'s own doc comment. */
  readonly realPublishAttempted: false;
  /** `true` when npm's own dry-run output reports skipping the publish because the package is `"private": true"` — this repo's own `packages/cli/package.json` today, and a deliberate belt-and-suspenders safety net (roadmap/23's "PREPARE-DON'T-PUBLISH" owner decision) independent of anything this tooling does. */
  readonly skippedDueToPrivate: boolean;
}

const PRIVATE_SKIP_PATTERN = /marked as private/i;

/**
 * Runs the metadata check + a real `npm publish --dry-run` and folds both
 * into one result. `realPublishAttempted` is always `false` — this
 * function never passes any flag other than `--dry-run` to `npm publish`,
 * so a real publish is categorically impossible through this code path,
 * independent of `metadata`/`dryRun`'s own outcomes.
 */
export async function runPublishDryRun(options: {
  readonly runner: PublishRunner;
  readonly packageDir: string;
}): Promise<PublishDryRunResult> {
  const metadata = checkPackageMetadata(join(options.packageDir, "package.json"));
  const dryRun = await options.runner.publishDryRun(options.packageDir);
  const skippedDueToPrivate = PRIVATE_SKIP_PATTERN.test(`${dryRun.stdout}\n${dryRun.stderr}`);
  return { metadata, dryRun, realPublishAttempted: false, skippedDueToPrivate };
}
