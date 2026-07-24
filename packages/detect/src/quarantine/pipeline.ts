/**
 * `runQuarantinePipeline` — roadmap/12 work item 4's top-level entry
 * point: runs stages 1-6 STRICTLY in order (`PIPELINE_STAGES`), never
 * skipping ahead. §Test plan, "Property" bullet: "quarantine stage
 * ordering is total — no fixture reaches a manifest entry having skipped
 * an earlier stage." Enforced structurally here: each stage only runs if
 * every prior stage's `StageResult` was `passed:true`; the FIRST failing
 * stage stops the pipeline — `report.stages` is always an exact prefix of
 * `PIPELINE_STAGES`, and `report.decision`/a manifest entry are only ever
 * reachable when that prefix is the full 6-stage list, every one passed.
 */
import { createFakeSandboxRunner } from "./sandbox/fake-sandbox-runner.js";
import type { SandboxRunner } from "./sandbox/types.js";
import { runFetchStage } from "./stages/fetch.js";
import { runPinStage } from "./stages/pin.js";
import { runVerifyProvenanceStage, type SignatureVerifier } from "./stages/verify-provenance.js";
import { DEFAULT_SCANNERS, runScanStage } from "./stages/scan-stage.js";
import { runSandboxStage } from "./stages/sandbox-stage.js";
import { buildManifestEntry } from "./manifest-entry.js";
import type { Scanner } from "./scanners/types.js";
import type { AuditReport, ScanFinding, StageResult } from "./types.js";
import type { CapabilityManifestEntry } from "@eo/contracts";

export interface QuarantinePipelineOptions {
  readonly scanners?: readonly Scanner[];
  readonly sandboxRunner?: SandboxRunner;
  readonly signatureVerifier?: SignatureVerifier;
  /** The digest this same candidate name was previously pinned at, if any (read from the capability store) — stage 3's tamper-detection input. */
  readonly previousDigest?: string;
  readonly clock?: () => string;
}

export interface QuarantinePipelineResult {
  readonly report: AuditReport;
  readonly manifestEntry?: CapabilityManifestEntry;
}

export function runQuarantinePipeline(
  rawSource: unknown,
  options: QuarantinePipelineOptions = {},
): QuarantinePipelineResult {
  const clock = options.clock ?? (() => new Date().toISOString());
  const stages: StageResult[] = [];

  const fetchOutcome = runFetchStage(rawSource);
  stages.push(fetchOutcome.result);
  if (!fetchOutcome.result.passed || fetchOutcome.candidate === undefined) {
    return { report: buildFailedReport(stages, clock()) };
  }
  const candidate = fetchOutcome.candidate;

  const pinOutcome = runPinStage(candidate);
  stages.push(pinOutcome.result);
  const pinned = pinOutcome.pinned;
  // Stage 2 (pin) cannot itself fail (see ./stages/pin.ts), but the loop
  // shape below stays uniform with the rest of the pipeline regardless.

  const provenanceResult = runVerifyProvenanceStage(pinned, {
    ...(options.signatureVerifier !== undefined ? { verifier: options.signatureVerifier } : {}),
    ...(options.previousDigest !== undefined ? { previousDigest: options.previousDigest } : {}),
  });
  stages.push(provenanceResult);
  if (!provenanceResult.passed) {
    return {
      report: buildFailedReport(stages, clock(), {
        candidateName: pinned.name,
        kind: pinned.kind,
        digest: pinned.digest,
      }),
    };
  }

  const scanOutcome = runScanStage(candidate, options.scanners ?? DEFAULT_SCANNERS);
  stages.push(scanOutcome.result);
  if (!scanOutcome.result.passed) {
    return {
      report: buildFailedReport(stages, clock(), {
        candidateName: pinned.name,
        kind: pinned.kind,
        digest: pinned.digest,
        scanFindings: scanOutcome.findings,
      }),
    };
  }

  const sandboxOutcome = runSandboxStage(
    candidate,
    options.sandboxRunner ?? createFakeSandboxRunner(),
  );
  stages.push(sandboxOutcome.result);
  if (!sandboxOutcome.result.passed) {
    return {
      report: buildFailedReport(stages, clock(), {
        candidateName: pinned.name,
        kind: pinned.kind,
        digest: pinned.digest,
        scanFindings: scanOutcome.findings,
        sandboxResult: sandboxOutcome.sandboxResult,
      }),
    };
  }

  const manifestEntry = buildManifestEntry(pinned);
  stages.push({
    stage: "manifest_entry",
    passed: true,
    detail: `entry produced for "${pinned.name}"`,
  });

  const report: AuditReport = {
    candidateName: pinned.name,
    kind: pinned.kind,
    digest: pinned.digest,
    permissionFootprint: pinned.permissionFootprint,
    stages,
    scanFindings: scanOutcome.findings,
    sandboxResult: sandboxOutcome.sandboxResult,
    decision: "pending",
    auditedAt: clock(),
  };

  return { report, manifestEntry };
}

function buildFailedReport(
  stages: readonly StageResult[],
  auditedAt: string,
  partial: {
    readonly candidateName?: string;
    readonly kind?: AuditReport["kind"];
    readonly digest?: string;
    readonly scanFindings?: readonly ScanFinding[];
    readonly sandboxResult?: AuditReport["sandboxResult"];
  } = {},
): AuditReport {
  return {
    candidateName: partial.candidateName ?? "(unknown — failed before fetch validation)",
    kind: partial.kind ?? "skill",
    digest: partial.digest ?? "(unpinned — failed before stage 2)",
    permissionFootprint: [],
    stages,
    scanFindings: partial.scanFindings ?? [],
    ...(partial.sandboxResult !== undefined ? { sandboxResult: partial.sandboxResult } : {}),
    decision: "rejected",
    auditedAt,
  };
}
