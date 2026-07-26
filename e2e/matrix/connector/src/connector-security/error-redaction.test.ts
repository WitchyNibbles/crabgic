/**
 * roadmap/23-release-hardening.md work item 6: "error redaction." Drives
 * the REAL `@crabgic/gateway` canonical-error mapping
 * (`mapHttpStatusToConnectorError`/`mapUnknownErrorToConnectorError`) and
 * `@crabgic/contracts`'s `ConnectorError` (never a reimplementation), mirroring
 * `packages/gateway/src/security/leak-hunt.test.ts`'s own "live substring
 * search" technique against a synthetic secret marker embedded in a raw
 * provider response.
 */
import { describe, expect, it, afterEach, beforeEach } from "vitest";
import { ConnectorError } from "@crabgic/contracts";
import { mapHttpStatusToConnectorError, mapUnknownErrorToConnectorError } from "@crabgic/gateway";
import {
  CONNECTOR_MATRIX_GATE_TAG,
  createScenarioJournal,
  emitScenarioEvidence,
} from "../support/evidence.js";
import type { ScenarioJournal } from "../support/evidence.js";
import { SYNTHETIC_AWS_ACCESS_KEY } from "../support/fixtures.js";

const SECRET_MARKER = SYNTHETIC_AWS_ACCESS_KEY;

function collectStrings(value: unknown, out: string[] = []): string[] {
  if (typeof value === "string") {
    out.push(value);
  } else if (Array.isArray(value)) {
    for (const item of value) collectStrings(item, out);
  } else if (value !== null && typeof value === "object") {
    for (const v of Object.values(value)) collectStrings(v, out);
  }
  return out;
}

function assertNoLeak(label: string, value: unknown): void {
  const leaked = collectStrings(value).filter((s) => s.includes(SECRET_MARKER));
  expect(leaked, `${label} leaked the secret marker: ${JSON.stringify(leaked)}`).toEqual([]);
}

let tj: ScenarioJournal;

beforeEach(async () => {
  tj = await createScenarioJournal();
});

afterEach(async () => {
  await tj.cleanup();
});

describe("mapHttpStatusToConnectorError never echoes a raw provider body containing a secret", () => {
  it.each([401, 403, 404, 409, 429, 400, 501, 500])(
    "HTTP %i: neither .toData() nor the thrown error's own fields leak the embedded secret",
    (status) => {
      const err = mapHttpStatusToConnectorError({
        status,
        provider: "fake-provider",
        rawProviderResponse: { apiToken: SECRET_MARKER, nested: { deeper: SECRET_MARKER } },
      });
      expect(err).toBeInstanceOf(ConnectorError);
      assertNoLeak(`ConnectorError(${status}).toData()`, err.toData());
      assertNoLeak(`ConnectorError(${status}).message`, err.message);
      assertNoLeak(`ConnectorError(${status}).redactedDetail`, err.redactedDetail);
    },
  );

  it("the redactedDetail summary carries only structural info (key names), never the secret value itself", () => {
    const err = mapHttpStatusToConnectorError({
      status: 403,
      provider: "fake-provider",
      rawProviderResponse: { apiToken: SECRET_MARKER },
    });
    expect(err.redactedDetail).toContain("apiToken"); // the KEY NAME is fine to surface
    expect(err.redactedDetail).not.toContain(SECRET_MARKER); // the VALUE must never appear
  });
});

describe("mapUnknownErrorToConnectorError never echoes a secret carried in an already-constructed ConnectorError's rawProviderResponse", () => {
  it("re-wrapping an already-redacting ConnectorError never re-surfaces the original rawProviderResponse secret (mirrors @crabgic/gateway's own leak-hunt suite)", () => {
    // NOTE on this function's actual, narrower contract (verified against
    // `packages/gateway/src/security/leak-hunt.test.ts`'s own case): only
    // `rawProviderResponse`-DERIVED fields (`redactedDetail`) are redaction
    // targets — an arbitrary caught `Error`'s own `.message` is trusted,
    // caller-controlled operational text (per `ConnectorErrorInput.message`'s
    // own doc comment) and is NOT scrubbed by this function. This test
    // exercises the guarantee the real code actually makes, not a stronger
    // one it never claimed.
    const original = ConnectorError.transient({
      message: "upstream failure",
      provider: "fake-provider",
      retryable: true,
      rawProviderResponse: { secretField: SECRET_MARKER },
    });
    const err = mapUnknownErrorToConnectorError(original, "fake-provider");
    assertNoLeak("mapUnknownErrorToConnectorError(...).toData()", err.toData());
  });

  it("a ConnectorError passed straight through is returned as-is (never double-wrapped, never re-leaking)", () => {
    const original = ConnectorError.permission({
      message: "forbidden",
      provider: "fake-provider",
      retryable: false,
    });
    const result = mapUnknownErrorToConnectorError(original, "fake-provider");
    expect(result).toBe(original);
  });
});

describe("evidence emission", () => {
  it("emits one EvidenceRecord tagged release-gate:connector-matrix summarizing the redaction proof", async () => {
    const err = mapHttpStatusToConnectorError({
      status: 403,
      provider: "fake-provider",
      rawProviderResponse: { apiToken: SECRET_MARKER },
    });
    const record = await emitScenarioEvidence({
      journal: tj.store,
      command:
        "connector-matrix: error redaction — canonical ConnectorError mapping never leaks a raw provider-body secret",
      exitStatus: 0,
      outcomeContent: JSON.stringify(err.toData()),
    });
    expect(record.gateTag).toBe(CONNECTOR_MATRIX_GATE_TAG);
    assertNoLeak("emitted EvidenceRecord.artifactDigests source", err.toData());
  });
});
