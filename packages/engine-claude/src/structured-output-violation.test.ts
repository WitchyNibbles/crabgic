/**
 * Exit criterion: "Schema-violating `structured_output` triggers a typed
 * failure entering the repair-attempt path, never a silent pass —
 * `structured-output-violation.test`" (roadmap/06-claude-engine-adapter.md
 * §Exit criteria). Covers all three `schemaViolation` reasons
 * `validateWorkerResult` produces, plus the "never a silent pass" property
 * itself (docs/engine-baseline.md §5).
 */
import { describe, expect, it } from "vitest";
import type { EngineResultEvent } from "@eo/engine-core";
import { validateWorkerResult } from "./result-validation.js";

const VALID_WORKER_RESULT = {
  schemaVersion: 1,
  id: "11111111-1111-4111-8111-111111111111",
  workUnitId: "22222222-2222-4222-8222-222222222222",
  outcome: "succeeded",
  summary: "did the thing",
  diagnostics: [],
  usage: { turnsUsed: 3 },
};

function buildResultEvent(overrides: Partial<EngineResultEvent> = {}): EngineResultEvent {
  return {
    type: "result",
    sessionId: "session-1",
    subtype: "success",
    isError: false,
    permissionDenials: [],
    ...overrides,
  };
}

describe("validateWorkerResult — reason 'absent' (docs/engine-baseline.md §5's OBSERVED violation shape)", () => {
  it("subtype 'success' with structuredOutput absent is a schemaViolation, never a silent pass", () => {
    const validation = validateWorkerResult(buildResultEvent({ subtype: "success" }));
    expect(validation.kind).toBe("schemaViolation");
    if (validation.kind === "schemaViolation") {
      expect(validation.reason).toBe("absent");
      expect(validation.diagnostics.length).toBeGreaterThan(0);
    }
  });

  it("structuredOutput absent under a different (non-retries-exhausted) subtype is still 'absent', never a silent pass", () => {
    const validation = validateWorkerResult(
      buildResultEvent({ subtype: "error_during_execution" }),
    );
    expect(validation.kind).toBe("schemaViolation");
    if (validation.kind === "schemaViolation") {
      expect(validation.reason).toBe("absent");
    }
  });
});

describe("validateWorkerResult — reason 'invalid' (present but fails WorkerResultSchema)", () => {
  it("a structuredOutput missing required fields is 'invalid', never a silent pass", () => {
    const validation = validateWorkerResult(
      buildResultEvent({ structuredOutput: { schemaVersion: 1 } }),
    );
    expect(validation.kind).toBe("schemaViolation");
    if (validation.kind === "schemaViolation") {
      expect(validation.reason).toBe("invalid");
      expect(validation.diagnostics.length).toBeGreaterThan(0);
    }
  });

  it("a structuredOutput with a wrong-typed field is 'invalid'", () => {
    const malformed = { ...VALID_WORKER_RESULT, outcome: "not-a-real-outcome" };
    const validation = validateWorkerResult(buildResultEvent({ structuredOutput: malformed }));
    expect(validation.kind).toBe("schemaViolation");
    if (validation.kind === "schemaViolation") {
      expect(validation.reason).toBe("invalid");
    }
  });

  it("diagnostics carry only path+code, never the offending value (redaction — roadmap/06 §Security 'redact values, keep paths')", () => {
    const SECRET = "sk-ant-super-secret-token-value";
    const malformed = { ...VALID_WORKER_RESULT, summary: 12345, diagnostics: [SECRET] };
    const validation = validateWorkerResult(buildResultEvent({ structuredOutput: malformed }));
    expect(validation.kind).toBe("schemaViolation");
    if (validation.kind === "schemaViolation") {
      for (const diagnostic of validation.diagnostics) {
        expect(diagnostic).not.toContain(SECRET);
      }
      expect(validation.diagnostics.some((d) => d.startsWith("summary:"))).toBe(true);
    }
  });

  it("an extra/unexpected field on an otherwise-valid payload is 'invalid' (WorkerResultSchema is .strict())", () => {
    const withExtra = { ...VALID_WORKER_RESULT, unexpectedField: "surprise" };
    const validation = validateWorkerResult(buildResultEvent({ structuredOutput: withExtra }));
    expect(validation.kind).toBe("schemaViolation");
    if (validation.kind === "schemaViolation") {
      expect(validation.reason).toBe("invalid");
    }
  });
});

describe("validateWorkerResult — reason 'retriesExhausted' (SDK-typed, unobserved-live variant, docs/engine-baseline.md §5)", () => {
  it("subtype 'error_max_structured_output_retries' is 'retriesExhausted', never a silent pass", () => {
    const validation = validateWorkerResult(
      buildResultEvent({ subtype: "error_max_structured_output_retries", isError: true }),
    );
    expect(validation.kind).toBe("schemaViolation");
    if (validation.kind === "schemaViolation") {
      expect(validation.reason).toBe("retriesExhausted");
      expect(validation.diagnostics.length).toBeGreaterThan(0);
    }
  });

  it("subtype 'error_max_structured_output_retries' wins even if structuredOutput happens to be present", () => {
    const validation = validateWorkerResult(
      buildResultEvent({
        subtype: "error_max_structured_output_retries",
        isError: true,
        structuredOutput: VALID_WORKER_RESULT,
      }),
    );
    expect(validation.kind).toBe("schemaViolation");
    if (validation.kind === "schemaViolation") {
      expect(validation.reason).toBe("retriesExhausted");
    }
  });
});

describe("validateWorkerResult — never a silent pass, contrasted against the genuine valid case", () => {
  it("a well-formed structuredOutput under subtype 'success' is the ONLY case that returns 'valid'", () => {
    const valid = validateWorkerResult(buildResultEvent({ structuredOutput: VALID_WORKER_RESULT }));
    expect(valid.kind).toBe("valid");

    const absent = validateWorkerResult(buildResultEvent({}));
    const invalid = validateWorkerResult(buildResultEvent({ structuredOutput: { bogus: true } }));
    const retriesExhausted = validateWorkerResult(
      buildResultEvent({ subtype: "error_max_structured_output_retries" }),
    );
    expect(absent.kind).toBe("schemaViolation");
    expect(invalid.kind).toBe("schemaViolation");
    expect(retriesExhausted.kind).toBe("schemaViolation");
  });
});
