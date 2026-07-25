import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { buildCheckResult, type AttestationCheckResult } from "./checkResult.js";

/**
 * `jira-grafana-version-support-windows` — roadmap/23 Exit criteria: "Jira
 * DC / Grafana version-support windows re-confirmed current at release
 * time; fixtures refreshed if vendor support windows moved (19's deferred
 * note)."
 *
 * WHAT CHANGED, AND WHY (2026-07-25): the first version of this check
 * recorded a `status: supported | moved | eol` enum and a bare
 * `confirmedOn` date, and judged freshness against an invented 30-day
 * constant. That let a record claim "supported" without ever saying *until
 * when* — so a window could expire the week after the release and the gate
 * would still be green, which is precisely the drift this criterion exists
 * to catch. The record now carries the vendor's **stated support-end
 * date**, and support is COMPUTED against the release date rather than
 * asserted.
 *
 * Four obligations, each independently checkable:
 *
 *   1. COVERAGE — every Jira/Grafana target the compatibility matrix
 *      commits to has a re-confirmation record.
 *   2. FRESHNESS — the confirmation was taken close enough to the release
 *      cut to still be meaningful, and is not dated after it.
 *   3. THE WINDOW COVERS THE RELEASE — `supportEndsOn` is after the
 *      release date. A version already out of vendor support at the moment
 *      it ships is the failure this item names.
 *   4. THE ARTIFACT EXISTS — the pinned container tag is actually
 *      published. This is the mechanically-probeable half (see
 *      `e2e/provisioning/src/supportWindows/`), and it directly covers the
 *      known-open Grafana OSS 13.1 case, where the recipe is pinned to a
 *      tag the vendor has not published: `tagPublished: false` then demands
 *      an explicitly recorded follow-up rather than passing quietly.
 */
export const VENDOR_SUPPORT_WINDOWS_RECORD_PATH =
  "docs/evidence/phase-23/vendor-support-windows.json";

/** The targets `docs/compatibility-matrix.md` commits this release to supporting. */
export const REQUIRED_SUPPORT_WINDOW_TARGETS = [
  "jira-cloud",
  "jira-dc-10.3",
  "jira-dc-11.3",
  "grafana-cloud",
  "grafana-11.6",
  "grafana-12.4",
  "grafana-13.1",
] as const;

/** How recent a re-confirmation must be to count as "current at release time". */
export const DEFAULT_MAX_RECORD_AGE_DAYS = 30;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export const SupportWindowRecordSchema = z
  .object({
    target: z.string().min(1),
    /** The version this release pins for that target, e.g. `11.6.0`. */
    pinnedVersion: z.string().min(1),
    /**
     * `versioned` — a self-managed release with a vendor-stated end-of-support
     * date. `continuous` — a hosted service (Jira Cloud, Grafana Cloud) that
     * the vendor updates continuously and publishes no per-version EOL for.
     *
     * The distinction is load-bearing rather than cosmetic: forcing a date
     * onto a hosted service would mean inventing one, and inventing a
     * support-end date is exactly the aspirational evidence this phase
     * forbids. A `continuous` target still has to be freshly re-confirmed
     * and sourced — it is exempt only from the window-coverage rule, which
     * is not a meaningful question for it.
     */
    lifecycle: z.enum(["versioned", "continuous"]).default("versioned"),
    /**
     * The vendor's own stated end-of-support date for `pinnedVersion`, ISO
     * `YYYY-MM-DD`. Required for a `versioned` target: a re-confirmation
     * that does not say *until when* cannot answer whether the window
     * covers this release. Omitted for a `continuous` one.
     */
    supportEndsOn: z.string().regex(ISO_DATE).optional(),
    /** When this confirmation was taken, ISO `YYYY-MM-DD`. */
    confirmedOn: z.string().regex(ISO_DATE),
    /** Where the support-end date came from — a vendor policy URL or an evidence artifact path. */
    source: z.string().min(1),
    /** Whether the pinned artifact (container tag) is actually published by the vendor. */
    tagPublished: z.boolean(),
    /** Required when the window has passed or the artifact is unpublished: what follow-up was recorded. */
    fixtureRefresh: z.string().min(1).optional(),
  })
  .strict()
  .superRefine((record, ctx) => {
    if (record.lifecycle === "versioned" && record.supportEndsOn === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["supportEndsOn"],
        message: `${record.target}: a versioned target must carry the vendor's stated support-end date.`,
      });
    }
  });
export type SupportWindowRecord = z.infer<typeof SupportWindowRecordSchema>;

export const SupportWindowRecordFileSchema = z.array(SupportWindowRecordSchema);

export interface CheckVersionSupportWindowsInput {
  /** ISO date of the release cut — what "current at release time" is measured against. */
  readonly releaseCutDate: string;
  readonly records: readonly SupportWindowRecord[];
  readonly requiredTargets: readonly string[];
  readonly maxAgeDays?: number;
}

function daysBetween(earlier: string, later: string): number {
  const from = Date.parse(`${earlier}T00:00:00.000Z`);
  const to = Date.parse(`${later}T00:00:00.000Z`);
  return (to - from) / 86_400_000;
}

/** Pure core — every date injected, never `Date.now()`, so the verdict is reproducible. */
export function checkVersionSupportWindows(
  input: CheckVersionSupportWindowsInput,
): AttestationCheckResult {
  const maxAgeDays = input.maxAgeDays ?? DEFAULT_MAX_RECORD_AGE_DAYS;
  const reasons: string[] = [];
  const details: string[] = [];

  for (const target of input.requiredTargets) {
    const record = input.records.find((candidate) => candidate.target === target);
    if (record === undefined) {
      reasons.push(
        `${target}: no vendor support-window re-confirmation recorded for this release.`,
      );
      continue;
    }

    const age = daysBetween(record.confirmedOn, input.releaseCutDate);
    if (age < 0) {
      reasons.push(
        `${target}: re-confirmation is dated ${record.confirmedOn}, AFTER the release cut ` +
          `(${input.releaseCutDate}) — it cannot attest to the candidate being cut.`,
      );
    } else if (age > maxAgeDays) {
      reasons.push(
        `${target}: re-confirmation is ${Math.floor(age)} days stale at the release cut ` +
          `(confirmed ${record.confirmedOn}, limit ${maxAgeDays} days) — not "current at release time".`,
      );
    }

    // A hosted, continuously-updated service has no per-version window to
    // check — only that the confirmation itself is fresh and sourced.
    if (record.lifecycle === "versioned") {
      const endsOn = record.supportEndsOn ?? "";
      const remaining = daysBetween(input.releaseCutDate, endsOn);
      if (remaining <= 0) {
        reasons.push(
          `${target}: vendor support for ${record.pinnedVersion} ended ${endsOn}, ` +
            `on or before the release cut (${input.releaseCutDate}) — shipping an out-of-support version.`,
        );
        if (record.fixtureRefresh === undefined) {
          reasons.push(
            `${target}: the support window has passed and no fixture refresh is recorded — ` +
              "19's deferred note requires fixtures be refreshed when a support window moves.",
          );
        }
      }
    }

    if (!record.tagPublished && record.fixtureRefresh === undefined) {
      reasons.push(
        `${target}: the pinned artifact for ${record.pinnedVersion} is NOT published by the vendor, ` +
          "and no follow-up is recorded — the recipe cannot be provisioned as pinned.",
      );
    }

    const window =
      record.lifecycle === "continuous"
        ? "continuously supported (hosted service, no version EOL)"
        : `supported until ${record.supportEndsOn ?? "?"}`;
    details.push(
      `${target}: pinned ${record.pinnedVersion}, ${window}, ` +
        `tagPublished=${String(record.tagPublished)}, confirmed ${record.confirmedOn}, ` +
        `source ${record.source}.`,
    );
  }

  return buildCheckResult(reasons, details);
}

/** Reads the record file if present; a missing file yields zero records, which fails every target on coverage. */
export function readSupportWindowRecords(repoRoot: string): readonly SupportWindowRecord[] {
  const path = join(repoRoot, VENDOR_SUPPORT_WINDOWS_RECORD_PATH);
  if (!existsSync(path)) return [];
  return SupportWindowRecordFileSchema.parse(JSON.parse(readFileSync(path, "utf-8")));
}

export function readVersionSupportWindowsInput(
  repoRoot: string,
  releaseCutDate: string,
): CheckVersionSupportWindowsInput {
  return {
    releaseCutDate,
    records: readSupportWindowRecords(repoRoot),
    requiredTargets: REQUIRED_SUPPORT_WINDOW_TARGETS,
  };
}
