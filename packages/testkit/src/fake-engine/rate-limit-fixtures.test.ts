import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  RATE_LIMIT_ALLOWED_FIVE_HOUR,
  RATE_LIMIT_ALLOWED_WARNING_96,
  RATE_LIMIT_ALLOWED_WARNING_98,
  RATE_LIMIT_ALLOWED_WARNING_99,
  RECORDED_RATE_LIMIT_PAYLOADS,
} from "./rate-limit-fixtures.js";

/**
 * docs/engine-baseline.md §8 checks over the four constants the fake engine
 * replays.
 *
 * (Corrected 2026-08-06.) This comment previously read "verbatim schema check",
 * which the file's own first case did not deliver: it asserted
 * `RECORDED_RATE_LIMIT_PAYLOADS` equals an array of its own four members — a
 * tautology over a literal, since the array is DEFINED as exactly those four
 * constants one file over, so it could not fail. Defect record
 * `06-criteria-name-suites-that-do-not-carry-them.md` §"Finding 2b" recorded
 * that. The case is replaced below by one that reads the committed phase-00
 * fixture bytes off disk, which is what makes "verbatim" a claim about
 * evidence rather than about this module's own literal.
 */

/** The committed phase-00 fixtures (docs/engine-baseline.md §12's fixture index). */
function fixtureUrl(name: string): URL {
  return new URL(`../../../../spikes/fixtures/${name}`, import.meta.url);
}

/**
 * The distinct `rate_limit_info` payloads across the four committed transcript
 * files docs/engine-baseline.md §8 counts its 16 samples over, first-seen order.
 */
function capturedDistinctPayloads(): readonly Record<string, unknown>[] {
  const messages: { readonly type?: string; readonly rate_limit_info?: unknown }[] = [];
  for (const name of ["02-hermeticity.transcript.sanitized.jsonl"]) {
    const raw = readFileSync(fixtureUrl(name), "utf8");
    for (const line of raw.trim().split("\n")) {
      messages.push(JSON.parse(line) as Record<string, unknown>);
    }
  }
  for (const name of [
    "03-permissions.transcripts.sanitized.json",
    "04-sandbox.transcripts.sanitized.json",
    "05-structured-output.transcripts.sanitized.json",
  ]) {
    const runs = JSON.parse(readFileSync(fixtureUrl(name), "utf8")) as Record<
      string,
      readonly Record<string, unknown>[]
    >;
    for (const run of Object.values(runs)) {
      messages.push(...run);
    }
  }
  const byKey = new Map<string, Record<string, unknown>>();
  for (const message of messages) {
    if (message.type !== "rate_limit_event") continue;
    const info = message.rate_limit_info as Record<string, unknown>;
    const key = JSON.stringify(Object.entries(info).sort(([a], [b]) => a.localeCompare(b)));
    if (!byKey.has(key)) byKey.set(key, info);
  }
  return [...byKey.values()];
}

describe("RECORDED_RATE_LIMIT_PAYLOADS", () => {
  it("is exactly the distinct payload set captured in the committed phase-00 fixtures", () => {
    const captured = capturedDistinctPayloads();
    // Anti-vacuity floor: a broken fixture path yields zero captured payloads
    // and every assertion below would certify nothing.
    expect(captured.length).toBeGreaterThan(0);
    expect(captured).toHaveLength(RECORDED_RATE_LIMIT_PAYLOADS.length);
    // Both directions, so neither a constant invented here nor a captured
    // payload dropped from this module can pass.
    for (const payload of RECORDED_RATE_LIMIT_PAYLOADS) {
      expect(captured).toContainEqual(payload);
    }
    for (const payload of captured) {
      expect(RECORDED_RATE_LIMIT_PAYLOADS).toContainEqual(payload);
    }
  });

  it("exports the four constants the barrel names, in docs/engine-baseline.md §8's order", () => {
    // Not a tautology like the case this replaced: the RHS is the ORDER the
    // baseline lists them in, written out independently of the array literal,
    // and the members are identified by their distinguishing recorded field
    // rather than by re-naming the same constants the array is built from.
    expect(RECORDED_RATE_LIMIT_PAYLOADS.map((p) => p.status)).toEqual([
      "allowed",
      "allowed_warning",
      "allowed_warning",
      "allowed_warning",
    ]);
    expect(RECORDED_RATE_LIMIT_PAYLOADS.map((p) => p.utilization)).toEqual([
      undefined,
      0.96,
      0.98,
      0.99,
    ]);
    expect(RATE_LIMIT_ALLOWED_FIVE_HOUR.status).toBe("allowed");
    expect(RATE_LIMIT_ALLOWED_WARNING_96.utilization).toBe(0.96);
    expect(RATE_LIMIT_ALLOWED_WARNING_98.utilization).toBe(0.98);
    expect(RATE_LIMIT_ALLOWED_WARNING_99.utilization).toBe(0.99);
  });

  it("no payload carries status 'rejected' (baseline §8: never synthesize the unobserved variant)", () => {
    for (const payload of RECORDED_RATE_LIMIT_PAYLOADS) {
      expect(payload.status).not.toBe("rejected");
    }
  });

  it("every payload's resetsAt matches the verbatim recorded epoch", () => {
    for (const payload of RECORDED_RATE_LIMIT_PAYLOADS) {
      expect(payload.resetsAt).toBe(1784135400);
    }
  });

  it("the allowed_warning payloads carry a monotonically distinct utilization set {0.96, 0.98, 0.99}", () => {
    const utilizations = [
      RATE_LIMIT_ALLOWED_WARNING_96,
      RATE_LIMIT_ALLOWED_WARNING_98,
      RATE_LIMIT_ALLOWED_WARNING_99,
    ].map((p) => p.utilization);
    expect(utilizations).toEqual([0.96, 0.98, 0.99]);
  });
});
