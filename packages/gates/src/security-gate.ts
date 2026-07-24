import type { CapabilityStore } from "@eo/detect";
import { parseGitleaksReport, type GitleaksReport } from "./security/gitleaks-adapter.js";
import { parseOsvScannerReport, type OsvScannerReport } from "./security/osv-scanner-adapter.js";
import { parseSemgrepReport, type SemgrepReport } from "./security/semgrep-adapter.js";
import {
  detectRootCausePolicyViolations,
  type RootCauseDetectorOptions,
} from "./security/root-cause-detector.js";
import { hasBlockingFinding, type ScanFinding } from "./security/types.js";
import { resolveDigestPinnedTool } from "./security/tool-resolution.js";
import { ToolDigestMismatchError, MissingCapabilityEntryError } from "./errors.js";
import type { GateHandler, GateVerdict } from "./types.js";

/**
 * Security adapters + root-cause detector — roadmap/14 §In scope, "Security
 * checks (SSDF-selected)" + "Root-cause policy detectors" bullets. Every
 * factory below resolves its scanner binary as a digest-pinned entry from
 * 12's capability store FIRST (fail-closed on a missing/mismatched digest —
 * `../security/tool-resolution.ts`), then parses the fixture report and
 * applies the shared CRITICAL/HIGH-blocks policy (`hasBlockingFinding`).
 */

function verdictFromFindings(
  command: string,
  toolchainFingerprint: string,
  findings: readonly ScanFinding[],
): GateVerdict {
  const blocked = hasBlockingFinding(findings);
  return {
    passed: !blocked,
    command,
    exitStatus: blocked ? 1 : 0,
    toolchainFingerprint,
    artifactDigests: findings.map((f) => `finding:${f.scanner}:${f.severity}:${f.detail}`),
    detail: blocked
      ? `${String(findings.filter((f) => f.severity === "critical" || f.severity === "high").length)} CRITICAL/HIGH finding(s) found — blocking`
      : `no CRITICAL/HIGH findings (${String(findings.length)} total finding(s))`,
  };
}

function digestFailureVerdict(command: string, error: unknown): GateVerdict {
  const message = error instanceof Error ? error.message : String(error);
  return {
    passed: false,
    command,
    exitStatus: 1,
    toolchainFingerprint: "unresolved",
    artifactDigests: [],
    detail: `tool resolution failed closed: ${message}`,
  };
}

/**
 * NIT-1 fix (adversarial-validation round): a real report can carry a
 * shape this package's own adapter parsers reject (e.g. an unexpected
 * severity string outside semgrep's `z.enum(["ERROR","WARNING","INFO"])`).
 * Before this fix, that thrown `ZodError` propagated straight out of the
 * async `GateHandler` — the firing REJECTS/crashes rather than blocks. For
 * a SECURITY gate, an unparseable/unexpected report must fail CLOSED (a
 * blocking finding), never throw: an attacker-controlled or corrupted
 * report is itself adversarial input, and a thrown exception here would
 * either crash the whole gate run or (worse, if some future caller wraps
 * it in a try/catch that swallows errors) silently skip the check
 * entirely — either way, never the intended "block" outcome. This wrapper
 * is the SOLE place a parser is invoked from any of the three factories
 * below.
 */
function verdictFromParseAttempt(
  command: string,
  toolchainFingerprint: string,
  parse: () => readonly ScanFinding[],
): GateVerdict {
  let findings: readonly ScanFinding[];
  try {
    findings = parse();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      passed: false,
      command,
      exitStatus: 1,
      toolchainFingerprint,
      artifactDigests: [],
      detail: `report parsing failed — failing CLOSED (blocking): ${message}`,
    };
  }
  return verdictFromFindings(command, toolchainFingerprint, findings);
}

export interface SemgrepGateInput {
  readonly capabilityStore: CapabilityStore;
  readonly observedDigest: string;
  readonly report: SemgrepReport;
}

export function createSemgrepGate(input: SemgrepGateInput): GateHandler {
  return async () => {
    try {
      resolveDigestPinnedTool(input.capabilityStore, "semgrep", input.observedDigest);
    } catch (error) {
      if (
        error instanceof ToolDigestMismatchError ||
        error instanceof MissingCapabilityEntryError
      ) {
        return digestFailureVerdict("semgrep", error);
      }
      throw error;
    }
    return verdictFromParseAttempt("semgrep", `semgrep@${input.observedDigest}`, () =>
      parseSemgrepReport(input.report),
    );
  };
}

export interface GitleaksGateInput {
  readonly capabilityStore: CapabilityStore;
  readonly observedDigest: string;
  readonly report: GitleaksReport;
}

export function createGitleaksGate(input: GitleaksGateInput): GateHandler {
  return async () => {
    try {
      resolveDigestPinnedTool(input.capabilityStore, "gitleaks", input.observedDigest);
    } catch (error) {
      if (
        error instanceof ToolDigestMismatchError ||
        error instanceof MissingCapabilityEntryError
      ) {
        return digestFailureVerdict("gitleaks", error);
      }
      throw error;
    }
    return verdictFromParseAttempt("gitleaks", `gitleaks@${input.observedDigest}`, () =>
      parseGitleaksReport(input.report),
    );
  };
}

export interface OsvScannerGateInput {
  readonly capabilityStore: CapabilityStore;
  readonly observedDigest: string;
  readonly report: OsvScannerReport;
}

export function createOsvScannerGate(input: OsvScannerGateInput): GateHandler {
  return async () => {
    try {
      resolveDigestPinnedTool(input.capabilityStore, "osv-scanner", input.observedDigest);
    } catch (error) {
      if (
        error instanceof ToolDigestMismatchError ||
        error instanceof MissingCapabilityEntryError
      ) {
        return digestFailureVerdict("osv-scanner", error);
      }
      throw error;
    }
    return verdictFromParseAttempt("osv-scanner", `osv-scanner@${input.observedDigest}`, () =>
      parseOsvScannerReport(input.report),
    );
  };
}

export interface RootCausePolicyGateInput extends RootCauseDetectorOptions {
  readonly diffText: string;
}

/** No digest-pinned binary to resolve — this detector is pure TypeScript logic over diff text, not an external scanner invocation. */
export function createRootCausePolicyGate(input: RootCausePolicyGateInput): GateHandler {
  return async () => {
    const findings = detectRootCausePolicyViolations(
      input.diffText,
      input.blocking !== undefined ? { blocking: input.blocking } : {},
    );
    return verdictFromFindings("root-cause-policy", "root-cause-policy@1", findings);
  };
}
