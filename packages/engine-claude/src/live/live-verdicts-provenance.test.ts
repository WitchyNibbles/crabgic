/**
 * OFFLINE unit tests for `live-harness.ts`'s live-verdicts provenance gate.
 * Runs in the DEFAULT gate — the filename deliberately does NOT end in
 * `.live.test.ts`, so `vitest.config.ts`'s `*.live.test.ts` exclusion does not
 * apply and nothing here spawns an engine.
 *
 * Subject: defect record `06-live-verdicts-source-label-not-provenance.md`.
 * `writeLiveVerdicts` used to take a bare `"live" | "offline-baseline"` string,
 * so the committed fixture's provenance label was a hand-typed claim — and an
 * unrelated commit flipped it from honest to false without anyone noticing,
 * because nothing anywhere read it. `"live"` now requires a `CanaryResult`
 * witness of a real engine invocation.
 *
 * These cases pin BOTH directions (the playbook's "pin a FAILS ruling with a
 * DOES NOT FAIL control"): a well-formed witness and an offline-baseline
 * provenance are accepted, every malformed witness is refused with its own
 * distinctive message, and a refused write leaves the committed bytes
 * byte-identical.
 *
 * RESIDUAL, stated so it is not read wider than it is. This gate binds the
 * WRITER, not the committed artifact. Nothing here (and nothing anywhere) reads
 * `live-verdicts.json`'s own `source` field, so a hand-edit of that string in
 * the JSON is still undetectable — which is exactly what `29b3c46` did. What
 * changed is that no CODE PATH can mint the label any more: the only writer
 * demands a witness only a real canary produces. The criterion's provenance
 * remains what the record says it is — the green run, the moved mtime and the
 * clean `git diff` — never the string. Deriving provenance from the artifact
 * itself would need the file to carry something a fake cannot reproduce, which
 * is a larger design change than this record proposes.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { TESTED_ENGINE_VERSION } from "../version-gate.js";
import {
  LIVE_VERDICTS_PATH,
  LiveVerdictsProvenanceError,
  assertLiveVerdictsProvenance,
  deriveOfflineBaselineVerdicts,
  writeLiveVerdicts,
  type CanaryResult,
  type LiveVerdictsProvenance,
} from "./live-harness.js";

/** The shape `runCanary()` returns after exactly one real engine invocation. */
function wellFormedWitness(overrides: Partial<CanaryResult> = {}): CanaryResult {
  return {
    engineVersion: TESTED_ENGINE_VERSION,
    capabilitiesEngineVersion: TESTED_ENGINE_VERSION,
    rateLimit: { statuses: [], maxUtilization: 0 },
    invocations: 1,
    ...overrides,
  } as CanaryResult;
}

function digest(): string {
  return createHash("sha256").update(readFileSync(LIVE_VERDICTS_PATH)).digest("hex");
}

describe("assertLiveVerdictsProvenance — the controls that must NOT fail", () => {
  it("accepts an offline-baseline provenance, which carries no witness at all", () => {
    expect(() => assertLiveVerdictsProvenance({ source: "offline-baseline" })).not.toThrow();
  });

  it("accepts a live provenance carrying a well-formed CanaryResult witness", () => {
    expect(() =>
      assertLiveVerdictsProvenance({ source: "live", witness: wellFormedWitness() }),
    ).not.toThrow();
  });

  it("accepts a witness that consumed more than one invocation", () => {
    expect(() =>
      assertLiveVerdictsProvenance({
        source: "live",
        witness: wellFormedWitness({ invocations: 3 }),
      }),
    ).not.toThrow();
  });
});

describe("assertLiveVerdictsProvenance — a hand-minted 'live' label is refused", () => {
  // Every case asserts the TYPED error AND its own distinctive message, never
  // a bare `toThrow()`: the playbook's "assert the rule's distinctive message,
  // never just the offending filename" ruling — otherwise one broadened check
  // could absorb every other case's subject and nothing would notice.
  const cases: readonly (readonly [string, unknown, RegExp])[] = [
    ["a non-object witness", "live", /non-object/],
    ["a null witness", null, /non-object/],
    ["an empty object", {}, /`invocations` is at least 1/],
    ["zero invocations", wellFormedWitness({ invocations: 0 }), /`invocations` is at least 1/],
    [
      "an engine version outside the tested one",
      wellFormedWitness({ engineVersion: "2.1.999" }),
      /observing the tested engine/,
    ],
    [
      "a missing capabilitiesEngineVersion",
      { ...wellFormedWitness(), capabilitiesEngineVersion: "" },
      /`capabilitiesEngineVersion`/,
    ],
    [
      "a missing rateLimit snapshot",
      { ...wellFormedWitness(), rateLimit: undefined },
      /`rateLimit` snapshot/,
    ],
  ];

  for (const [label, witness, message] of cases) {
    it(`refuses ${label}`, () => {
      const provenance = { source: "live", witness } as unknown as LiveVerdictsProvenance;
      expect(() => assertLiveVerdictsProvenance(provenance)).toThrow(LiveVerdictsProvenanceError);
      expect(() => assertLiveVerdictsProvenance(provenance)).toThrow(message);
    });
  }

  it("cannot be spelled at all without a witness — the compile-time half", () => {
    // If `writeLiveVerdicts`'s provenance parameter is ever widened back to a
    // bare string, or the witness made optional, this directive becomes unused
    // and `tsc` fails the build with TS2578. That is the assertion; the runtime
    // expression below is unreachable by design.
    // @ts-expect-error `source: "live"` without a `witness` must not typecheck.
    const forged: LiveVerdictsProvenance = { source: "live" };
    expect(() => assertLiveVerdictsProvenance(forged)).toThrow(LiveVerdictsProvenanceError);
  });
});

describe("writeLiveVerdicts — refuses BEFORE touching the committed file", () => {
  it("leaves live-verdicts.json byte-identical when the witness is forged", async () => {
    const before = digest();
    await expect(
      writeLiveVerdicts(deriveOfflineBaselineVerdicts(), {
        source: "live",
        witness: {} as CanaryResult,
      }),
    ).rejects.toBeInstanceOf(LiveVerdictsProvenanceError);
    // The whole point of ordering the check first: a rejected provenance must
    // not truncate or rewrite the artifact the parity criterion rests on.
    expect(digest()).toBe(before);
  });
});
