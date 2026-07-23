/**
 * Canned fault-injection builders — roadmap/16-gateway-core.md work item 6:
 * "fault injection (429/401/409/412, malformed pages, mid-POST timeouts)."
 * Each builder returns a `FakeProviderScriptEntry` for
 * `./fake-provider-transport.js`'s script.
 */

import type { FakeProviderScriptEntry } from "./fake-provider-transport.js";

export function okResponse(bodyText = "{}"): FakeProviderScriptEntry {
  return { status: 200, bodyText };
}

export function rateLimitedResponse(retryAfterSeconds: number): FakeProviderScriptEntry {
  return { status: 429, headers: { "retry-after": String(retryAfterSeconds) }, bodyText: "" };
}

export function authFailureResponse(): FakeProviderScriptEntry {
  return { status: 401, bodyText: "" };
}

export function conflictResponse(): FakeProviderScriptEntry {
  return { status: 409, bodyText: "" };
}

export function preconditionFailedResponse(): FakeProviderScriptEntry {
  return { status: 412, bodyText: "" };
}

/** A page response whose body is not valid JSON, or whose shape drops a required pagination field — an upstream contract violation the caller's parsing must not silently coerce into an empty/duplicate page. */
export function malformedPageResponse(): FakeProviderScriptEntry {
  return { status: 200, bodyText: "{ this is not valid json" };
}

/** Simulates a mid-POST timeout — the fake transport rejects (never resolves with a status), forcing the caller into ambiguous-write handling rather than a clean HTTP failure. */
export function midPostTimeoutFault(): FakeProviderScriptEntry {
  return { status: 0, fault: "mid-post-timeout" };
}

export const FULL_FAULT_MATRIX: Readonly<Record<string, FakeProviderScriptEntry>> = {
  rateLimited: rateLimitedResponse(1),
  authFailure: authFailureResponse(),
  conflict: conflictResponse(),
  preconditionFailed: preconditionFailedResponse(),
  malformedPage: malformedPageResponse(),
  midPostTimeout: midPostTimeoutFault(),
};
