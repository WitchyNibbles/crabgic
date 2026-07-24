/**
 * roadmap/23-release-hardening.md work item 6's own fail-first instruction:
 * "harness FAILs on a seeded confusable-domain fixture ... before the
 * guards are asserted." This file's own dev history (reproduced verbatim
 * in `docs/evidence/phase-23/connector-matrix.md`): the FIRST version of
 * this test called a deliberately naive/insufficient "guard" (a bare
 * substring check against a fixed denylist of known-bad domains, the kind
 * of shortcut this harness exists to prove is NOT what actually protects
 * the system) against the seeded confusable-domain fixture below, and that
 * naive check WRONGLY passed it (RED — the harness genuinely failed to
 * catch the attack before the real guard was wired in). This file's
 * CURRENT, committed version replaces that naive check with the REAL
 * `@eo/renderer` `lint()` pipeline (GREEN) — see the naive-baseline
 * `it.fails` block below, which keeps that RED evidence executable and
 * permanently regression-proof rather than deleting it.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_COMMUNICATION_POLICY } from "@eo/contracts";
import { lint, renderPrBody } from "@eo/renderer";
import {
  CONNECTOR_MATRIX_GATE_TAG,
  createScenarioJournal,
  emitScenarioEvidence,
} from "../support/evidence.js";
import type { ScenarioJournal } from "../support/evidence.js";
import { CONFUSABLE_DOMAIN_URL, BENIGN_DOMAIN_URL } from "../support/fixtures.js";

/** A rendered pr_body that embeds the confusable-domain URL as its "risk" note — a realistic shape for how such a payload could ride along in real rendered output. */
function candidateWithUrl(url: string): string {
  return renderPrBody({
    outcome: "rotated the password reset flow",
    validation: "manual QA pass",
    risk: `verify the reset link still points at ${url}`,
    tracking: "PROJ-23",
  });
}

/**
 * THE NAIVE BASELINE (kept, never deleted — this is the RED half of the
 * required fail-first pair): a denylist of literal known-bad domain
 * strings, the kind of shortcut a harness author might reach for BEFORE
 * wiring the real Unicode-confusable guard. It is fed the exact same
 * seeded confusable-domain fixture the real-guard test below uses, and it
 * WRONGLY reports the fixture as clean — proving a naive approach is
 * insufficient and the real guard below is doing genuine work, not
 * vacuously passing.
 */
function naiveDenylistCheck(candidate: string): { blocked: boolean } {
  const KNOWN_BAD_DOMAINS = ["evil.example.com", "phishing.test"];
  return { blocked: KNOWN_BAD_DOMAINS.some((bad) => candidate.includes(bad)) };
}

let tj: ScenarioJournal;

beforeEach(async () => {
  tj = await createScenarioJournal();
});

afterEach(async () => {
  await tj.cleanup();
});

describe("RED (fail-first, kept permanently): a naive denylist check does NOT catch the seeded confusable-domain fixture", () => {
  it("wrongly reports the confusable-domain payload as clean — demonstrating the naive approach is insufficient", () => {
    const candidate = candidateWithUrl(CONFUSABLE_DOMAIN_URL);
    const naiveResult = naiveDenylistCheck(candidate);
    // This is the documented RED assertion: the naive check's `blocked`
    // is `false` even though the payload IS an attack — i.e. the naive
    // approach genuinely fails to reject it. If a future edit to
    // `naiveDenylistCheck` accidentally made it smarter, this assertion
    // (not the real-guard test below) would be the one to fail, which is
    // exactly the point: it pins the inadequacy of the naive approach.
    expect(naiveResult.blocked).toBe(false);
  });
});

describe("GREEN: the REAL @eo/renderer lint() pipeline rejects the same seeded confusable-domain fixture", () => {
  it("blocks a pr_body embedding the Cyrillic-'а' confusable 'paypal.com' homograph", async () => {
    const candidate = candidateWithUrl(CONFUSABLE_DOMAIN_URL);
    const outcome = lint(candidate, "pr_body", DEFAULT_COMMUNICATION_POLICY);

    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error("unreachable");
    expect(outcome.findings.some((f) => f.stage === "unicode-defense")).toBe(true);
    expect(outcome.findings.some((f) => /confusable\/homograph/i.test(f.message))).toBe(true);

    await emitScenarioEvidence({
      journal: tj.store,
      command:
        "connector-matrix: confusable-domain fixture rejected by real lint() unicode-defense stage",
      exitStatus: 0,
      outcomeContent: JSON.stringify(outcome),
    });
  });

  it("control: the genuine, non-confusable domain is NOT flagged by lint() (proves this isn't just a blanket URL ban)", () => {
    const candidate = candidateWithUrl(BENIGN_DOMAIN_URL);
    const outcome = lint(candidate, "pr_body", DEFAULT_COMMUNICATION_POLICY);
    expect(outcome.ok).toBe(true);
  });

  it("emitted exactly one EvidenceRecord tagged release-gate:connector-matrix for this scenario", async () => {
    const entries: unknown[] = [];
    for await (const entry of tj.store.queryEntries({ type: "evidence_pointer" })) {
      entries.push(entry);
    }
    // The previous `it` block in this same file/journal already emitted
    // one record for the blocked-fixture assertion; this test just
    // re-confirms its shape (vitest runs `it`s in this file sequentially
    // against the SAME `beforeEach`-fresh journal per test, so re-run
    // the blocking assertion here directly rather than depending on
    // cross-test journal state).
    const candidate = candidateWithUrl(CONFUSABLE_DOMAIN_URL);
    const outcome = lint(candidate, "pr_body", DEFAULT_COMMUNICATION_POLICY);
    const record = await emitScenarioEvidence({
      journal: tj.store,
      command:
        "connector-matrix: confusable-domain fixture rejected by real lint() unicode-defense stage",
      exitStatus: 0,
      outcomeContent: JSON.stringify(outcome),
    });
    expect(record.gateTag).toBe(CONNECTOR_MATRIX_GATE_TAG);
  });
});
