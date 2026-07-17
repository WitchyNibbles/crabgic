import { z } from "zod";
import { SchemaVersionField } from "../shared/schema-version.js";
import { IdSchema, NonEmptyStringSchema, TimestampSchema } from "../shared/ids.js";

/**
 * The 11 risk categories named verbatim by
 * roadmap/15-performance-contracts.md §In scope, "Risk detection" bullet:
 * "CPU, allocation, copying, I/O, networking, database, serialization,
 * concurrency, caching, dataset-size, user-visible hot paths."
 */
export const PERFORMANCE_RISK_CATEGORIES = [
  "cpu",
  "allocation",
  "copying",
  "io",
  "networking",
  "database",
  "serialization",
  "concurrency",
  "caching",
  "dataset_size",
  "user_visible_hot_path",
] as const;
export const PerformanceRiskCategorySchema = z.enum(PERFORMANCE_RISK_CATEGORIES);
export type PerformanceRiskCategory = z.infer<typeof PerformanceRiskCategorySchema>;

/**
 * The metric vocabulary drawn from roadmap/15 §In scope, "Methodology"
 * bullet: "Measured where applicable: latency percentiles, throughput,
 * error rate, CPU time, peak RSS/heap, allocations, fs/network ops+bytes,
 * query counts, capacity." `peak_rss`/`peak_heap` and `fs_ops`/`fs_bytes`
 * and `network_ops`/`network_bytes` split each "X/Y" pairing into 2 members
 * since a single budget entry measures one number.
 */
export const PERFORMANCE_METRICS = [
  "latency",
  "throughput",
  "error_rate",
  "cpu_time",
  "peak_rss",
  "peak_heap",
  "allocations",
  "fs_ops",
  "fs_bytes",
  "network_ops",
  "network_bytes",
  "query_count",
  "capacity",
] as const;
export const PerformanceMetricSchema = z.enum(PERFORMANCE_METRICS);
export type PerformanceMetric = z.infer<typeof PerformanceMetricSchema>;

/**
 * `budgetSource` — the 3-source resolution order from roadmap/15 §In scope,
 * "Budget sourcing" bullet: "1. The ChangeSet's IntentContract `performance`
 * section / Requirement acceptance criteria (11, ...). 2. Else ecosystem
 * research. 3. Else the base-revision benchmark run sets the budget
 * itself."
 */
export const PERFORMANCE_BUDGET_SOURCES = [
  "requirement_acceptance_criteria",
  "ecosystem_research",
  "base_revision_measurement",
] as const;
export const PerformanceBudgetSourceSchema = z.enum(PERFORMANCE_BUDGET_SOURCES);
export type PerformanceBudgetSource = z.infer<typeof PerformanceBudgetSourceSchema>;

/**
 * One budget entry, shared shape for both variants (see
 * `PerformanceContractSchema`). `percentile` is only meaningful when
 * `metric === "latency"` — roadmap/15 says "latency percentiles" (plural)
 * without pinning which ones, so this is a free `1..99` integer rather than
 * a fixed p50/p95/p99 set (minimal-shape choice). `unit` is free text (e.g.
 * "ms", "ops/sec", "bytes") since no fixed unit taxonomy is pinned upstream.
 * `riskCategory` optionally ties a budget to the risk category that
 * motivated tracking it (roadmap/15 §In scope, "Risk detection" bullet).
 */
export const ProvisionalPerformanceBudgetEntrySchema = z
  .object({
    metric: PerformanceMetricSchema,
    percentile: z.number().int().min(1).max(99).optional(),
    threshold: z.number(),
    unit: NonEmptyStringSchema,
    riskCategory: PerformanceRiskCategorySchema.optional(),
  })
  .strict();
export type ProvisionalPerformanceBudgetEntry = z.infer<
  typeof ProvisionalPerformanceBudgetEntrySchema
>;

/**
 * The enforced variant's budget entry adds `measuredValue` — the
 * gate-time-measured figure compared against `threshold`. Roadmap/15 §
 * Interfaces produced, "PerformanceContract instances, enforced variant"
 * bullet: "this phase builds the measurement-backed, hash-linked instance
 * at gate time."
 */
export const EnforcedPerformanceBudgetEntrySchema = ProvisionalPerformanceBudgetEntrySchema.extend({
  measuredValue: z.number(),
}).strict();
export type EnforcedPerformanceBudgetEntry = z.infer<typeof EnforcedPerformanceBudgetEntrySchema>;

/**
 * The 3 gate outcomes named verbatim by roadmap/15 §Interfaces produced,
 * "Performance gate handler" bullet: "Outcome is one of `pass` / `block` /
 * `inconclusive-blocking`." Hyphens normalized to underscores to match this
 * package's enum-member convention (e.g. `WorkUnitAttemptStatus`'s
 * `parked:rate_limit`, ../state-machines/work-unit-attempt-status.ts).
 */
export const PERFORMANCE_OUTCOMES = ["pass", "block", "inconclusive_blocking"] as const;
export const PerformanceOutcomeSchema = z.enum(PERFORMANCE_OUTCOMES);
export type PerformanceOutcome = z.infer<typeof PerformanceOutcomeSchema>;

const performanceContractCommonFields = {
  schemaVersion: SchemaVersionField,
  id: IdSchema,
  changeSetId: IdSchema,
  createdAt: TimestampSchema,
  budgetSource: PerformanceBudgetSourceSchema,
} as const;

/**
 * The provisional instance 11 creates at approval-preview time (roadmap/11
 * §In scope: "caption `PerformanceContract` budget previews"; roadmap/15 §
 * Interfaces consumed, "11" bullet: "the approved PerformanceContract's
 * provisional figure and envelope hash, embedded in ChangeSet (11
 * creates)"). `budgetHash` is the canonical hash of `budgets`, computed by
 * whichever phase builds this instance (11 here) — the field 15's enforced
 * variant hash-links against (see `EnforcedPerformanceContractSchema`).
 */
export const ProvisionalPerformanceContractSchema = z
  .object({
    ...performanceContractCommonFields,
    variant: z.literal("provisional"),
    budgets: z.array(ProvisionalPerformanceBudgetEntrySchema),
    budgetHash: NonEmptyStringSchema,
  })
  .strict();
export type ProvisionalPerformanceContract = z.infer<typeof ProvisionalPerformanceContractSchema>;

/**
 * The enforced instance 15 builds at `final_verifying` gate time.
 * `provisionalBudgetHash` must equal the provisional instance's own
 * `budgetHash` — the hash-link check roadmap/15 §In scope, "Budget
 * sourcing" bullet requires: "The enforced figure must hash-match the
 * provisional one 11's approval render already committed to (via
 * ChangeSet, 02); a mismatch fails closed rather than silently
 * re-sourcing" (reconfirmed by roadmap/15 §Exit criteria: "Enforced budgets
 * are hash-linked to the approved envelope; a tampered post-approval edit
 * fails closed"). Carrying both hashes on this instance keeps the
 * tamper-evidence check self-contained (no extra fetch of the provisional
 * record needed to verify it) — minimal-shape choice, since roadmap/15
 * never pins the exact hash-link storage mechanism, only the invariant it
 * must enforce. `outcome` is the gate verdict (see
 * `PerformanceOutcomeSchema`).
 */
export const EnforcedPerformanceContractSchema = z
  .object({
    ...performanceContractCommonFields,
    variant: z.literal("enforced"),
    budgets: z.array(EnforcedPerformanceBudgetEntrySchema),
    budgetHash: NonEmptyStringSchema,
    provisionalBudgetHash: NonEmptyStringSchema,
    outcome: PerformanceOutcomeSchema,
  })
  .strict();
export type EnforcedPerformanceContract = z.infer<typeof EnforcedPerformanceContractSchema>;

/**
 * `PerformanceContract` (roadmap/02-contracts-and-schemas.md §Interfaces
 * produced, row "PerformanceContract | 15 (builds), 11 (approval payload),
 * 23"): a discriminated union on `variant` because a `ChangeSet` carries
 * two distinct instances of this contract at different lifecycle points —
 * 11's provisional figure at approval time, and 15's measurement-backed
 * enforced figure at `final_verifying` — per roadmap/15 §Interfaces
 * produced, "PerformanceContract instances, enforced variant" bullet: "...
 * attaches it to the ChangeSet (02 schema; 11 creates) alongside the
 * provisional figure 11 already populated at approval time; this phase
 * never edits or re-derives 11's provisional figure, only hash-checks
 * against it."
 */
export const PerformanceContractSchema = z.discriminatedUnion("variant", [
  ProvisionalPerformanceContractSchema,
  EnforcedPerformanceContractSchema,
]);
export type PerformanceContract = z.infer<typeof PerformanceContractSchema>;
