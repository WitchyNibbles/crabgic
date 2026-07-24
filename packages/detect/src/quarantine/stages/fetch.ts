/**
 * Stage 1 (fetch) — roadmap/12 §In scope, "Quarantine pipeline" bullet:
 * "(1) fetch without credentials." This package has no real network
 * transport of its own (a real fetch integration is out of this phase's
 * file-scope authority — see the phase-12 final report's deferred-
 * dependency notes); this stage's job is the structural half of "without
 * credentials": reject a raw candidate descriptor that carries ANY
 * credential-shaped top-level field before it ever enters the pipeline,
 * and validate its shape against `CandidateSourceSchema` (02-style
 * boundary validation — CLAUDE.md: "validate/sandbox all parsing").
 */
import { CandidateSourceSchema, type CandidateSource } from "../types.js";
import type { StageResult } from "../types.js";

const DISALLOWED_TOP_LEVEL_KEYS = new Set([
  "credentials",
  "token",
  "apiKey",
  "api_key",
  "authorization",
  "secret",
  "password",
]);

export interface FetchStageOutcome {
  readonly result: StageResult;
  readonly candidate?: CandidateSource;
}

/** Validates `raw` as a well-shaped, credential-free `CandidateSource`. Never throws — a malformed or credential-carrying input yields a failing `StageResult` with no `candidate`. */
export function runFetchStage(raw: unknown): FetchStageOutcome {
  if (typeof raw === "object" && raw !== null) {
    const offendingKey = Object.keys(raw).find((key) => DISALLOWED_TOP_LEVEL_KEYS.has(key));
    if (offendingKey !== undefined) {
      return {
        result: {
          stage: "fetch",
          passed: false,
          detail: `candidate descriptor carries a disallowed credential-shaped field: "${offendingKey}"`,
        },
      };
    }
  }

  const parsed = CandidateSourceSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      result: {
        stage: "fetch",
        passed: false,
        detail: `candidate descriptor failed shape validation: ${parsed.error.issues.map((i) => i.message).join("; ")}`,
      },
    };
  }

  return {
    result: { stage: "fetch", passed: true, detail: `fetched candidate "${parsed.data.name}"` },
    candidate: parsed.data,
  };
}
