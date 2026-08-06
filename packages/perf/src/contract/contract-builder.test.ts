import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CURRENT_SCHEMA_VERSION, type ProvisionalPerformanceContract } from "@crabgic/contracts";
import {
  BudgetHashLinkMismatchError,
  BudgetJournalAnchorMissingError,
  EnvelopeBudgetBindingMissingError,
  MissingMeasurementError,
} from "../errors.js";
import { journalApprovedProvisionalContract } from "../test-support/journal-anchor-fixture.js";
import { createTestJournal, type TestJournal } from "../test-support/test-journal.js";
import { canonicalHash } from "./canonical-hash.js";
import { buildEnforcedPerformanceContract } from "./contract-builder.js";
import {
  verifyProvisionalBudgetIntegrity,
  type ApprovedEnvelopeBudgetBinding,
} from "./hash-link.js";

const CHANGE_SET_ID = "22222222-2222-4222-8222-222222222222";
const CREATED_AT = "2026-01-01T00:00:00.000Z";
const APPROVED_ENVELOPE_HASH = "sha256:test-approved-envelope";

/**
 * The slice of an approved `AuthorizationEnvelope` the binding check reads —
 * the digest the human's approval token signed, plus the provisional budget
 * hash that digest now covers (ledger Gap 22). `undefined` models the
 * legacy/unbound envelope shape.
 */
function envelopeBinding(provisionalBudgetHash: string | undefined): ApprovedEnvelopeBudgetBinding {
  return {
    canonicalHash: APPROVED_ENVELOPE_HASH,
    ...(provisionalBudgetHash !== undefined ? { provisionalBudgetHash } : {}),
  };
}

let tj: TestJournal;

beforeEach(async () => {
  tj = await createTestJournal();
});

afterEach(async () => {
  await tj.cleanup();
});

function validProvisional(
  budgets: ProvisionalPerformanceContract["budgets"],
  budgetSource: ProvisionalPerformanceContract["budgetSource"] = "requirement_acceptance_criteria",
  id: string = "11111111-1111-4111-8111-111111111111",
): ProvisionalPerformanceContract {
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    id,
    changeSetId: CHANGE_SET_ID,
    createdAt: CREATED_AT,
    variant: "provisional",
    budgetSource,
    budgets,
    budgetHash: canonicalHash(budgets.map((b) => ({ ...b }))),
  };
}

describe("buildEnforcedPerformanceContract", () => {
  it("builds a schema-valid enforced contract, carrying measuredValue + hash-linking to a journal-anchored provisional", async () => {
    const provisional = validProvisional([
      { metric: "latency", percentile: 95, threshold: 200, unit: "ms" },
    ]);
    await journalApprovedProvisionalContract(tj.store, provisional);

    const enforced = await buildEnforcedPerformanceContract({
      id: "33333333-3333-4333-8333-333333333333",
      createdAt: CREATED_AT,
      provisional,
      journal: tj.store,
      approvedEnvelope: envelopeBinding(provisional.budgetHash),
      outcome: "pass",
      measuredValues: [{ metric: "latency", percentile: 95, value: 180 }],
    });
    expect(enforced.variant).toBe("enforced");
    expect(enforced.budgets).toEqual([
      { metric: "latency", percentile: 95, threshold: 200, unit: "ms", measuredValue: 180 },
    ]);
    expect(enforced.provisionalBudgetHash).toBe(provisional.budgetHash);
    // DOES-NOT-FAIL CONTROL for the Gap 22 binding: a correctly-bound envelope
    // builds, and the enforced record carries the digest the token signed, so
    // the whole chain is inspectable on the artifact. Without this a
    // refuse-everything implementation would satisfy the fail-closed tests.
    expect(enforced.approvedEnvelopeHash).toBe(APPROVED_ENVELOPE_HASH);
    expect(enforced.outcome).toBe("pass");
  });

  it("FAIL-CLOSED (naive vector): budgets edited without recomputing budgetHash throws BudgetHashLinkMismatchError with reason self_consistency_mismatch", async () => {
    const provisional = validProvisional([{ metric: "cpu_time", threshold: 10, unit: "s" }]);
    await journalApprovedProvisionalContract(tj.store, provisional);
    // Simulate a post-approval tamper: widen the threshold, but the stored
    // budgetHash is left stale (the naive tamper/bug vector).
    const tampered: ProvisionalPerformanceContract = {
      ...provisional,
      budgets: [{ metric: "cpu_time", threshold: 999, unit: "s" }],
    };
    let caught: unknown;
    try {
      await buildEnforcedPerformanceContract({
        id: "33333333-3333-4333-8333-333333333333",
        createdAt: CREATED_AT,
        provisional: tampered,
        journal: tj.store,
        // Bound to the record's own (stale) hash, so checks 4-5 would PASS —
        // the reported reason can only come from check 1.
        approvedEnvelope: envelopeBinding(tampered.budgetHash),
        outcome: "pass",
        measuredValues: [{ metric: "cpu_time", value: 5 }],
      });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(BudgetHashLinkMismatchError);
    expect((caught as BudgetHashLinkMismatchError).reason).toBe("self_consistency_mismatch");
  });

  it("MAJOR FIX — FAIL-CLOSED (deliberate widening vector): a post-approval budget widening that ALSO recomputes its own budgetHash consistently is now caught via the journal anchor (reason journal_anchor_mismatch)", async () => {
    const provisional = validProvisional([{ metric: "cpu_time", threshold: 200, unit: "ms" }]);
    // 11's real approval-time commit — genuinely journaled, tamper-evident.
    await journalApprovedProvisionalContract(tj.store, provisional);

    // Adversary widens the threshold AND recomputes budgetHash consistently
    // — this is the exact vector the OLD self-checksum-only check MISSED
    // (empirically confirmed: recomputedHash === tampered.budgetHash, so
    // the naive self-consistency check alone reports "ok").
    const widenedBudgets: ProvisionalPerformanceContract["budgets"] = [
      { metric: "cpu_time", threshold: 2000, unit: "ms" },
    ];
    const deliberatelyTampered: ProvisionalPerformanceContract = {
      ...provisional,
      budgets: widenedBudgets,
      budgetHash: canonicalHash(widenedBudgets.map((b) => ({ ...b }))),
    };
    // Sanity: prove the self-consistency check ALONE would have passed this
    // (the exact gap the MAJOR fix closes) — otherwise this test wouldn't
    // be exercising the vector it claims to.
    expect(canonicalHash(deliberatelyTampered.budgets.map((b) => ({ ...b })))).toBe(
      deliberatelyTampered.budgetHash,
    );

    let caught: unknown;
    try {
      await buildEnforcedPerformanceContract({
        id: "33333333-3333-4333-8333-333333333333",
        createdAt: CREATED_AT,
        provisional: deliberatelyTampered,
        journal: tj.store,
        // Bound to the ORIGINAL, approved budget hash — so check 5 WOULD also
        // fire on this fixture. That it reports `journal_anchor_mismatch`
        // rather than `envelope_hash_mismatch` is the order proof: the three
        // journal checks keep their reasons, and the merged phase-15 evidence
        // that cites them keeps meaning what it said. Probe P2(b) measures the
        // reverse direction.
        approvedEnvelope: envelopeBinding(provisional.budgetHash),
        outcome: "pass",
        measuredValues: [{ metric: "cpu_time", value: 210 }],
      });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(BudgetHashLinkMismatchError);
    expect((caught as BudgetHashLinkMismatchError).reason).toBe("journal_anchor_mismatch");
  });

  it("FAIL-CLOSED: no journal anchor exists at all for this provisional id throws BudgetJournalAnchorMissingError", async () => {
    const provisional = validProvisional([{ metric: "cpu_time", threshold: 10, unit: "s" }]);
    // Deliberately never journaled — no approval-time commit exists.
    await expect(
      buildEnforcedPerformanceContract({
        id: "33333333-3333-4333-8333-333333333333",
        createdAt: CREATED_AT,
        provisional,
        journal: tj.store,
        approvedEnvelope: envelopeBinding(provisional.budgetHash),
        outcome: "pass",
        measuredValues: [{ metric: "cpu_time", value: 5 }],
      }),
    ).rejects.toThrow(BudgetJournalAnchorMissingError);
  });

  it("throws MissingMeasurementError when a budget entry has no corresponding measured value", async () => {
    const provisional = validProvisional([{ metric: "latency", threshold: 200, unit: "ms" }]);
    await journalApprovedProvisionalContract(tj.store, provisional);
    await expect(
      buildEnforcedPerformanceContract({
        id: "33333333-3333-4333-8333-333333333333",
        createdAt: CREATED_AT,
        provisional,
        journal: tj.store,
        approvedEnvelope: envelopeBinding(provisional.budgetHash),
        outcome: "pass",
        measuredValues: [],
      }),
    ).rejects.toThrow(MissingMeasurementError);
  });

  it("the base-revision-measurement fallback: an empty, journal-anchored provisional budget set is populated from baseRevisionFallbackBudgets", async () => {
    const provisional = validProvisional([], "base_revision_measurement", randomUUID());
    await journalApprovedProvisionalContract(tj.store, provisional);

    const enforced = await buildEnforcedPerformanceContract({
      id: "33333333-3333-4333-8333-333333333333",
      createdAt: CREATED_AT,
      provisional,
      journal: tj.store,
      approvedEnvelope: envelopeBinding(provisional.budgetHash),
      outcome: "pass",
      measuredValues: [{ metric: "cpu_time", value: 10 }],
      baseRevisionFallbackBudgets: [{ metric: "cpu_time", threshold: 10, unit: "s" }],
    });
    expect(enforced.budgetSource).toBe("base_revision_measurement");
    expect(enforced.budgets).toEqual([
      { metric: "cpu_time", threshold: 10, unit: "s", measuredValue: 10 },
    ]);
    // The enforced record's own budgetHash need not equal the (empty-array)
    // provisional budgetHash in this fallback case — provisionalBudgetHash
    // still faithfully carries 11's original (empty) hash forward.
    expect(enforced.provisionalBudgetHash).toBe(provisional.budgetHash);
  });

  it("an untampered, journal-anchored empty-base-revision-measurement provisional still passes the integrity check (canonicalHash([]) is self-consistent AND anchor-matched)", async () => {
    const provisional = validProvisional([], "base_revision_measurement", randomUUID());
    await journalApprovedProvisionalContract(tj.store, provisional);

    await expect(
      buildEnforcedPerformanceContract({
        id: "33333333-3333-4333-8333-333333333333",
        createdAt: CREATED_AT,
        provisional,
        journal: tj.store,
        approvedEnvelope: envelopeBinding(provisional.budgetHash),
        outcome: "pass",
        measuredValues: [],
        baseRevisionFallbackBudgets: [],
      }),
    ).resolves.toBeDefined();
  });

  it("DEFECT FIXTURE — an approval envelope signed over budget A + a provisional contract carrying budget B + NO post-approval edit fails closed (reason envelope_hash_mismatch)", async () => {
    const budgetsA: ProvisionalPerformanceContract["budgets"] = [
      { metric: "latency", percentile: 95, threshold: 200, unit: "ms" },
    ];
    const budgetsB: ProvisionalPerformanceContract["budgets"] = [
      { metric: "latency", percentile: 95, threshold: 2000, unit: "ms" },
    ];
    // What intake committed and journaled: budget B — self-consistent,
    // anchored, and NEVER edited afterwards. Checks 1-3 pass this by
    // construction.
    const provisional = validProvisional(budgetsB);
    await journalApprovedProvisionalContract(tj.store, provisional);

    // Anti-strawman sanity (mirrors this file's own self-consistency-alone
    // precedent above): the pre-existing checks accept this exact contract —
    // the new check is the only thing standing between it and enforcement.
    const boundToItself = await verifyProvisionalBudgetIntegrity(
      tj.store,
      provisional,
      envelopeBinding(provisional.budgetHash),
    );
    expect(boundToItself.ok).toBe(true);

    // The envelope the human's token actually signed covers budget A's hash.
    const approvedEnvelope = envelopeBinding(canonicalHash(budgetsA.map((b) => ({ ...b }))));

    let caught: unknown;
    try {
      await buildEnforcedPerformanceContract({
        id: "33333333-3333-4333-8333-333333333333",
        createdAt: CREATED_AT,
        provisional,
        journal: tj.store,
        approvedEnvelope,
        outcome: "pass",
        measuredValues: [{ metric: "latency", percentile: 95, value: 180 }],
      });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(BudgetHashLinkMismatchError);
    expect((caught as BudgetHashLinkMismatchError).reason).toBe("envelope_hash_mismatch");
  });

  it("FAIL-CLOSED: no approved envelope could be resolved at all throws EnvelopeBudgetBindingMissingError", async () => {
    const provisional = validProvisional([{ metric: "cpu_time", threshold: 10, unit: "s" }]);
    await journalApprovedProvisionalContract(tj.store, provisional);

    let caught: unknown;
    try {
      await buildEnforcedPerformanceContract({
        id: "33333333-3333-4333-8333-333333333333",
        createdAt: CREATED_AT,
        provisional,
        journal: tj.store,
        approvedEnvelope: undefined,
        outcome: "pass",
        measuredValues: [{ metric: "cpu_time", value: 5 }],
      });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(EnvelopeBudgetBindingMissingError);
    expect((caught as BudgetHashLinkMismatchError).reason).toBe("no_envelope_budget_binding");
  });

  it("FAIL-CLOSED: an envelope that RESOLVES but carries no binding (the legacy shape) is refused, never trusted", async () => {
    // The fail-open shape this axis exists to forbid: "we found the envelope,
    // it says nothing about budgets, so enforce whatever the record holds."
    const provisional = validProvisional([{ metric: "cpu_time", threshold: 10, unit: "s" }]);
    await journalApprovedProvisionalContract(tj.store, provisional);

    const result = await verifyProvisionalBudgetIntegrity(
      tj.store,
      provisional,
      envelopeBinding(undefined),
    );
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("no_envelope_budget_binding");

    await expect(
      buildEnforcedPerformanceContract({
        id: "33333333-3333-4333-8333-333333333333",
        createdAt: CREATED_AT,
        provisional,
        journal: tj.store,
        approvedEnvelope: envelopeBinding(undefined),
        outcome: "pass",
        measuredValues: [{ metric: "cpu_time", value: 5 }],
      }),
    ).rejects.toThrow(EnvelopeBudgetBindingMissingError);
  });

  it("CONJUNCT-2 STRENGTHENING: tampering the STORED ENVELOPE's binding after approval fails closed (envelope_hash_mismatch)", async () => {
    // The new tamper vector the binding itself creates, and closes. Everything
    // on the contract side is untouched — intake-consistent, journal-anchored,
    // anchor-matched — and the edit is made to the approved envelope record
    // instead. Checks 1-3 cannot see it; check 5 does.
    const provisional = validProvisional([{ metric: "cpu_time", threshold: 200, unit: "ms" }]);
    await journalApprovedProvisionalContract(tj.store, provisional);

    const asApproved = envelopeBinding(provisional.budgetHash);
    expect((await verifyProvisionalBudgetIntegrity(tj.store, provisional, asApproved)).ok).toBe(
      true,
    );

    const tamperedEnvelope: ApprovedEnvelopeBudgetBinding = {
      ...asApproved,
      provisionalBudgetHash: canonicalHash([{ metric: "cpu_time", threshold: 2000, unit: "ms" }]),
    };

    let caught: unknown;
    try {
      await buildEnforcedPerformanceContract({
        id: "33333333-3333-4333-8333-333333333333",
        createdAt: CREATED_AT,
        provisional,
        journal: tj.store,
        approvedEnvelope: tamperedEnvelope,
        outcome: "pass",
        measuredValues: [{ metric: "cpu_time", value: 210 }],
      });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(BudgetHashLinkMismatchError);
    expect((caught as BudgetHashLinkMismatchError).reason).toBe("envelope_hash_mismatch");
  });
});
