import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { buildCheckResult, type AttestationCheckResult } from "./checkResult.js";

/**
 * `arm64-verification` — roadmap/23 Exit criteria: "ARM64 build+test
 * verified on real hardware/CI, **or an explicitly documented substitute
 * recorded** — closes 01's deferred ARM64 gate."
 *
 * Two routes satisfy this, and the check takes whichever applies:
 *
 *   1. NATIVE. The release cut is running on an ARM64 host, so the check
 *      runs a real build+test and reports what it observes.
 *   2. REAL CI. `.github/workflows/ci.yml` runs the `unit-test+coverage`
 *      job on `ubuntu-24.04-arm` — a genuine aarch64 runner. Its ARM64 leg
 *      writes a run record (see `Arm64RunRecordSchema`) that this check
 *      verifies.
 *
 * WHAT CHANGED, AND WHY (2026-07-25): this check previously scanned
 * `docs/evidence/` for a FILE NAME matching `/arm64|aarch64/i`. That was a
 * heuristic standing in for evidence — a file called `arm64-notes.txt`
 * would have satisfied it, and a real green ARM64 CI run whose artifact was
 * named otherwise would not. It now consumes a structured record and checks
 * the three things that actually matter: the leg ran on genuine aarch64
 * hardware (`uname -m`, recorded, never assumed from the runner label), it
 * concluded successfully, and it ran against the exact release candidate.
 *
 * A documented substitute MECHANISM with no execution behind it does not
 * pass. `docs/compatibility-matrix.md`'s own "ARM64 close-out" section makes
 * that distinction itself ("Until that run exists, ARM64 support is a
 * documented, CI-gated intent, not a verified fact"), so this check agrees
 * with the release doc rather than overriding it. The section's presence is
 * still reported in `details` — disclosure is worth recording even when it
 * is not sufficient.
 */
export const ARM64_ARCH = "arm64";

/** The heading that documents ARM64 status. Recorded, but never sufficient on its own. */
export const ARM64_CLOSE_OUT_HEADING = "### ARM64 close-out";

/** Where a CI-produced run record is looked for; `$EO_ARM64_RUN_RECORD` overrides it. */
export const ARM64_RUN_RECORD_PATH = "docs/evidence/phase-23/arm64-run-record.json";
export const ARM64_RUN_RECORD_ENV = "EO_ARM64_RUN_RECORD";

/** Matches what `uname -m` genuinely reports on 64-bit ARM. */
const AARCH64 = /^(aarch64|arm64)$/i;

/** Produced by `ci.yml`'s ARM64 matrix leg — see that workflow's `record ARM64 build+test evidence` step. */
export const Arm64RunRecordSchema = z
  .object({
    workflow: z.string().min(1),
    jobName: z.string().min(1),
    runId: z.string().min(1),
    runAttempt: z.string().min(1).optional(),
    /** The exact commit the ARM64 leg built and tested. */
    commitSha: z.string().min(1),
    /** `uname -m` as observed on the runner — the proof it was really aarch64. */
    arch: z.string().min(1),
    kernel: z.string().min(1).optional(),
    nodeVersion: z.string().min(1).optional(),
    conclusion: z.string().min(1),
    capturedAt: z.string().min(1),
  })
  .strict();
export type Arm64RunRecord = z.infer<typeof Arm64RunRecordSchema>;

export interface Arm64NativeRunResult {
  readonly command: string;
  readonly exitStatus: number;
}

export interface CheckArm64VerificationInput {
  /** `process.arch` on the host executing the release cut. */
  readonly hostArch: string;
  /** The release candidate the ARM64 run must correspond to. */
  readonly releaseCandidateObjectId: string;
  /** The `### ARM64 close-out` section, if the docs disclose ARM64 status. Reported, never sufficient alone. */
  readonly closeOutSection: string | undefined;
  /** A CI run record proving an ARM64 build+test actually executed. */
  readonly runRecord: Arm64RunRecord | undefined;
  /** Present only when `hostArch` is arm64: the result of the native build+test this check ran. */
  readonly nativeRun?: Arm64NativeRunResult;
}

/** Pure core — every input injected, so both routes are testable from an x86-64 host. */
export function checkArm64Verification(input: CheckArm64VerificationInput): AttestationCheckResult {
  const reasons: string[] = [];
  const details: string[] = [`host arch: ${input.hostArch}`];

  if (input.closeOutSection !== undefined && input.closeOutSection.trim() !== "") {
    details.push(`ARM64 status documented (${input.closeOutSection.trim().length} chars).`);
  }

  // Route 1: a genuinely ARM64 host — the hardware route, taken directly.
  if (input.hostArch === ARM64_ARCH) {
    if (input.nativeRun === undefined) {
      reasons.push(
        "host is ARM64 but no native build+test was run — the hardware route was available and not taken.",
      );
    } else {
      details.push(`native run: ${input.nativeRun.command} -> exit ${input.nativeRun.exitStatus}`);
      if (input.nativeRun.exitStatus !== 0) {
        reasons.push(
          `native ARM64 build+test FAILED (${input.nativeRun.command} exited ${input.nativeRun.exitStatus}).`,
        );
      }
    }
    return buildCheckResult(reasons, details);
  }

  // Route 2: a real ARM64 CI run.
  if (input.runRecord === undefined) {
    reasons.push(
      `host is ${input.hostArch} and no ARM64 CI run record was found (expected ${ARM64_RUN_RECORD_PATH} ` +
        `or $${ARM64_RUN_RECORD_ENV}). A documented substitute MECHANISM is not a substitute ` +
        "VERIFICATION — the run itself is still owed.",
    );
    return buildCheckResult(reasons, details);
  }

  const record = input.runRecord;
  details.push(
    `CI run ${record.workflow}#${record.runId} (${record.jobName}) on ${record.arch}, ` +
      `conclusion=${record.conclusion}, commit=${record.commitSha}.`,
  );

  if (!AARCH64.test(record.arch)) {
    reasons.push(
      `the recorded run reports arch "${record.arch}", which is not aarch64 — a runner label alone ` +
        "does not prove the build+test executed on ARM64 hardware.",
    );
  }
  if (record.conclusion !== "success") {
    reasons.push(`the recorded ARM64 run concluded "${record.conclusion}", not success.`);
  }
  if (record.commitSha !== input.releaseCandidateObjectId) {
    reasons.push(
      `the recorded ARM64 run built ${record.commitSha}, not the release candidate ` +
        `${input.releaseCandidateObjectId} — it verifies a different artifact.`,
    );
  }

  return buildCheckResult(reasons, details);
}

/** Extracts the `### ARM64 close-out` section (up to the next same-or-higher heading). */
export function extractCloseOutSection(markdown: string): string | undefined {
  const start = markdown.indexOf(ARM64_CLOSE_OUT_HEADING);
  if (start === -1) return undefined;
  const rest = markdown.slice(start + ARM64_CLOSE_OUT_HEADING.length);
  const next = rest.search(/\n#{1,3} /);
  return next === -1 ? rest : rest.slice(0, next);
}

/** Reads the CI-produced run record, if one has been archived or downloaded into the workspace. */
export function readArm64RunRecord(repoRoot: string): Arm64RunRecord | undefined {
  const override = process.env[ARM64_RUN_RECORD_ENV];
  const path =
    override !== undefined && override.length > 0
      ? override
      : join(repoRoot, ARM64_RUN_RECORD_PATH);
  if (!existsSync(path)) return undefined;
  return Arm64RunRecordSchema.parse(JSON.parse(readFileSync(path, "utf-8")));
}

/** Runs the real native build+test on an ARM64 host. Never invoked on other architectures. */
function runNativeBuildAndTest(repoRoot: string): Arm64NativeRunResult {
  const command = "npm run typecheck && npm test";
  try {
    execFileSync("npm", ["run", "typecheck"], { cwd: repoRoot, stdio: "pipe" });
    execFileSync("npm", ["test"], { cwd: repoRoot, stdio: "pipe" });
    return { command, exitStatus: 0 };
  } catch (error) {
    const status = (error as { status?: number }).status;
    return { command, exitStatus: typeof status === "number" ? status : 1 };
  }
}

export function readArm64VerificationInput(
  repoRoot: string,
  releaseCandidateObjectId: string,
  hostArch: string = process.arch,
): CheckArm64VerificationInput {
  const matrixPath = join(repoRoot, "docs", "compatibility-matrix.md");
  const closeOutSection = existsSync(matrixPath)
    ? extractCloseOutSection(readFileSync(matrixPath, "utf-8"))
    : undefined;

  return {
    hostArch,
    releaseCandidateObjectId,
    closeOutSection,
    runRecord: readArm64RunRecord(repoRoot),
    ...(hostArch === ARM64_ARCH ? { nativeRun: runNativeBuildAndTest(repoRoot) } : {}),
  };
}
