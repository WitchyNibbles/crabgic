import { z } from "zod";

/**
 * Vendor support-window prober — roadmap/23 Exit criteria: "Jira DC /
 * Grafana version-support windows re-confirmed current at release time;
 * fixtures refreshed if vendor support windows moved (19's deferred note)."
 *
 * WHY THIS EXISTS: until now, nothing in this repository re-confirmed a
 * vendor support window. The single prior check
 * (`docs/evidence/phase-23/provisioning/grafana-13.1-tag-check.txt`) was a
 * one-off manual capture. `e2e/attestation`'s support-window check
 * therefore had nothing to read and failed every target on coverage.
 *
 * THE HONEST SPLIT. A vendor support window has two halves, and they are
 * knowable in different ways:
 *
 *   - MECHANICAL — "is the pinned artifact actually published?" This is a
 *     real HTTP fact (a registry tag either resolves or 404s), so it is
 *     probed here and never taken on trust. It is also the half that
 *     catches the currently-open Grafana OSS 13.1 gap.
 *   - ATTESTED — "when does the vendor's support for this version end?"
 *     Atlassian and Grafana publish this as prose on policy pages, not as
 *     a stable machine API. Scraping prose and calling the result a
 *     verified fact would be exactly the kind of aspirational evidence this
 *     phase forbids, so the date is instead read from a committed,
 *     human-maintained policy file that must cite its source — and
 *     `e2e/attestation`'s check independently enforces that the date is
 *     fresh and actually covers the release.
 *
 * This module deliberately does NOT judge. It observes and records; the
 * release gate decides. That split is what lets the probe run weekly from
 * drift-ci without any notion of a release date.
 */

/** Minimal HTTP port — injected so every unit test runs offline and deterministically. */
export type HttpProbe = (url: string) => Promise<{ readonly status: number }>;

export interface SupportWindowTargetSpec {
  /** Matches `e2e/attestation`'s `REQUIRED_SUPPORT_WINDOW_TARGETS`. */
  readonly target: string;
  /** The version this release pins. */
  readonly pinnedVersion: string;
  /**
   * Registry coordinates for the mechanical half. Absent for hosted
   * targets (Jira Cloud, Grafana Cloud), which have no pinned artifact to
   * resolve — those are recorded as published by definition, since there is
   * no tag that could fail to exist.
   */
  readonly image?: string;
  readonly tag?: string;
}

/**
 * The release's pinned targets, matching `docker/` and
 * `docs/compatibility-matrix.md`.
 *
 * `grafana-11.6` was retired 2026-07-26 (owner-ratified): this probe itself
 * found it out of vendor support since 2026-06-25, and roadmap/23:134's
 * "fixtures refreshed if vendor support windows moved" is the prescribed
 * response. Kept in step with `REQUIRED_SUPPORT_WINDOW_TARGETS` in
 * `e2e/attestation/src/versionSupportWindows.ts` — the consumer of what this
 * probe records.
 */
export const SUPPORT_WINDOW_TARGETS: readonly SupportWindowTargetSpec[] = [
  { target: "jira-cloud", pinnedVersion: "v3" },
  { target: "jira-dc-10.3", pinnedVersion: "10.3", image: "atlassian/jira-software", tag: "10.3" },
  { target: "jira-dc-11.3", pinnedVersion: "11.3", image: "atlassian/jira-software", tag: "11.3" },
  { target: "grafana-cloud", pinnedVersion: "cloud" },
  { target: "grafana-12.4", pinnedVersion: "12.4.0", image: "grafana/grafana-oss", tag: "12.4.0" },
  { target: "grafana-13.1", pinnedVersion: "13.1.0", image: "grafana/grafana-oss", tag: "13.1.0" },
];

/** Human-maintained, source-cited vendor support-end dates. */
export const VendorSupportPolicyEntrySchema = z
  .object({
    target: z.string().min(1),
    /**
     * `versioned` — a self-managed release the vendor publishes an EOL date
     * for. `continuous` — a hosted service (Jira Cloud, Grafana Cloud) with
     * no per-version EOL, where recording a date would mean inventing one.
     */
    lifecycle: z.enum(["versioned", "continuous"]).default("versioned"),
    /** ISO `YYYY-MM-DD` — the vendor's stated end-of-support date. Omitted for a `continuous` target. */
    supportEndsOn: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
    /** The vendor page or document the date came from. Required: an uncited date is not a confirmation. */
    source: z.string().min(1),
    /** Recorded follow-up when a window has moved or an artifact is unpublished. */
    fixtureRefresh: z.string().min(1).optional(),
  })
  .strict();
export type VendorSupportPolicyEntry = z.infer<typeof VendorSupportPolicyEntrySchema>;

export const VendorSupportPolicySchema = z.array(VendorSupportPolicyEntrySchema);

/** Docker Hub's public tag endpoint — a 200 means the tag genuinely resolves, a 404 that it does not. */
export function dockerHubTagUrl(image: string, tag: string): string {
  return `https://hub.docker.com/v2/repositories/${image}/tags/${tag}`;
}

/**
 * Probes whether the pinned artifact is published. A target with no
 * registry coordinates is treated as published: there is no tag that could
 * be missing, so reporting `false` would be a fabricated failure.
 *
 * A non-200/404 response (rate limit, outage) is reported as `undefined` —
 * "not determined" — rather than being collapsed into `false`. A transient
 * registry outage must never be recorded as "the vendor unpublished this
 * version".
 */
export async function probeTagPublished(
  spec: SupportWindowTargetSpec,
  http: HttpProbe,
): Promise<boolean | undefined> {
  if (spec.image === undefined || spec.tag === undefined) return true;
  const { status } = await http(dockerHubTagUrl(spec.image, spec.tag));
  if (status === 200) return true;
  if (status === 404) return false;
  return undefined;
}

/** One observation, in exactly the shape `e2e/attestation`'s record file expects. */
export interface SupportWindowObservation {
  readonly target: string;
  readonly pinnedVersion: string;
  readonly lifecycle: "versioned" | "continuous";
  readonly supportEndsOn?: string;
  readonly confirmedOn: string;
  readonly source: string;
  readonly tagPublished: boolean;
  readonly fixtureRefresh?: string;
}

export interface BuildSupportWindowRecordsOptions {
  readonly targets: readonly SupportWindowTargetSpec[];
  readonly policy: readonly VendorSupportPolicyEntry[];
  readonly http: HttpProbe;
  /** The date this probe ran, ISO `YYYY-MM-DD`. Injected so runs are reproducible. */
  readonly probedOn: string;
}

export interface BuildSupportWindowRecordsResult {
  readonly records: readonly SupportWindowObservation[];
  /** Targets that could not be recorded, with why — never silently dropped. */
  readonly skipped: readonly string[];
}

/**
 * Merges the mechanical probe with the attested policy into the record set
 * the release gate reads.
 *
 * A target with no policy entry is SKIPPED, not defaulted: inventing a
 * support-end date is precisely the aspirational evidence this phase
 * forbids, and a missing record makes `e2e/attestation`'s coverage rule
 * fail that target — which is the correct, visible outcome. The same
 * applies when the probe could not determine publication status.
 */
export async function buildSupportWindowRecords(
  options: BuildSupportWindowRecordsOptions,
): Promise<BuildSupportWindowRecordsResult> {
  const records: SupportWindowObservation[] = [];
  const skipped: string[] = [];

  for (const spec of options.targets) {
    const policy = options.policy.find((entry) => entry.target === spec.target);
    if (policy === undefined) {
      skipped.push(
        `${spec.target}: no vendor support-policy entry — the support-end date is unknown and is not invented.`,
      );
      continue;
    }

    const tagPublished = await probeTagPublished(spec, options.http);
    if (tagPublished === undefined) {
      skipped.push(
        `${spec.target}: registry did not answer conclusively; publication status left undetermined ` +
          "rather than recorded as unpublished.",
      );
      continue;
    }

    records.push({
      target: spec.target,
      pinnedVersion: spec.pinnedVersion,
      lifecycle: policy.lifecycle,
      ...(policy.supportEndsOn !== undefined ? { supportEndsOn: policy.supportEndsOn } : {}),
      confirmedOn: options.probedOn,
      source: policy.source,
      tagPublished,
      ...(policy.fixtureRefresh !== undefined ? { fixtureRefresh: policy.fixtureRefresh } : {}),
    });
  }

  return { records, skipped };
}

/** The real HTTP port. Kept out of `buildSupportWindowRecords` so every test runs offline. */
export const fetchHttpProbe: HttpProbe = async (url) => {
  const response = await fetch(url, { method: "GET", redirect: "follow" });
  return { status: response.status };
};
