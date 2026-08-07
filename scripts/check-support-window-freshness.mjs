#!/usr/bin/env node
// Warns BEFORE the vendor-support-window bound expires, fails once it has, and
// refuses to let any workflow renew that bound by committing the probe's own
// output. Run with:
//   node scripts/check-support-window-freshness.mjs
//
// WHY THIS EXISTS (2026-08-07).
//
// `e2e/attestation`'s `checkVersionSupportWindows` fails a release when the
// committed record at `docs/evidence/phase-23/vendor-support-windows.json` is
// more than `DEFAULT_MAX_RECORD_AGE_DAYS` (30) old at the cut, or when a
// vendor's stated support window has closed. That check has NO production
// caller: its only invocation anywhere is `releaseAttestations.test.ts`, whose
// suite runs solely under `npm run test:e2e:release-evidence` — the release
// gate `.github/workflows/publish.yml` blocks on at a `v*` tag. `e2e/attestation`
// is not a `vitest.config.ts` project, so nothing per-push runs it.
//
// Consequence, stated plainly: from the 31st day after the record's date, no
// release can be cut — and nothing would have said a word beforehand. The
// failure would land inside a tag-triggered publish, which is the most
// expensive moment to learn it.
//
// So this runs per-push, in `meta-checks`, and does two things nothing else did:
//
//   1. ADVANCE WARNING. It warns from `WARN_LEAD_DAYS` (21) before the bound
//      expires, and from `EXPIRY_WARN_DAYS` (90) before a vendor window closes,
//      naming the exact date each target turns red. It FAILS on the same
//      conditions the release gate fails on, so the two cannot disagree.
//
//   2. THE AUTO-RENEWAL TRIPWIRE, which is the durable half. The freshness
//      bound is only worth anything if refreshing it is a deliberate,
//      reviewable act. `.github/workflows/drift-ci.yml` runs
//      `npm run probe:support-windows` weekly and uploads the rewritten file as
//      an ARTIFACT; the release gate reads the COMMITTED file. Nothing pinned
//      that distinction. ONE `git commit` step added to that workflow would
//      make the 30-day bound renew itself forever, silently, and the gate would
//      be green by construction. This check fails if any workflow both runs the
//      probe and can commit or push its output.
//
// ⚠️ WHAT `confirmedOn` ACTUALLY IS, because the name oversells it and the
// owner ruled the wording must say so (2026-08-07). It is the date the
// AUTOMATED PROBE last ran — `e2e/provisioning/src/supportWindows.ts` sets
// `confirmedOn: options.probedOn`. The probe re-checks a real HTTP fact: that
// the pinned container tag still resolves. It does NOT re-read the vendor's
// support-end date; that value is copied out of the committed
// `docs/vendor-support-policy.json`. So a fresh `confirmedOn` proves the
// artifact is still published and the record was regenerated recently. It does
// NOT prove the support dates themselves are unchanged. Probe-based
// confirmation is the accepted design; this comment is the accepted limitation,
// and neither is softened into the other.
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const REPO_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

export const SUPPORT_WINDOW_RECORD_PATH = "docs/evidence/phase-23/vendor-support-windows.json";
export const WORKFLOWS_DIR = ".github/workflows";

/**
 * Must equal `DEFAULT_MAX_RECORD_AGE_DAYS` in
 * `e2e/attestation/src/versionSupportWindows.ts`. Duplicated rather than
 * imported because `e2e/attestation` is a self-contained TypeScript project
 * this build-free script cannot reach — and BOUND to it by
 * `check-support-window-freshness.test.mjs`, which reads that file and fails if
 * the two ever disagree. A warning lane calibrated against a different limit
 * than the gate it warns about is worse than no warning lane.
 */
export const MAX_RECORD_AGE_DAYS = 30;

/** How many days before the freshness bound expires the warning starts. */
export const WARN_LEAD_DAYS = 21;

/** How many days before a vendor support window closes the warning starts. */
export const EXPIRY_WARN_DAYS = 90;

/**
 * The targets a record must cover. Must equal
 * `REQUIRED_SUPPORT_WINDOW_TARGETS` in `versionSupportWindows.ts:63-70` —
 * likewise duplicated and likewise bound by the suite. Without the coverage
 * rule, deleting a target from the record file would silence its warning
 * instead of raising one, which is the wrong direction to fail in.
 */
export const REQUIRED_SUPPORT_WINDOW_TARGETS = [
  "jira-cloud",
  "jira-dc-10.3",
  "jira-dc-11.3",
  "grafana-cloud",
  "grafana-12.4",
  "grafana-13.1",
];

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Whole days from `earlier` to `later`. Same arithmetic as `versionSupportWindows.ts`'s `daysBetween`. */
export function daysBetween(earlier, later) {
  const from = Date.parse(`${earlier}T00:00:00.000Z`);
  const to = Date.parse(`${later}T00:00:00.000Z`);
  return (to - from) / 86_400_000;
}

/** `iso` advanced by `days`, as an ISO `YYYY-MM-DD`. */
export function addDays(iso, days) {
  const at = new Date(`${iso}T00:00:00.000Z`);
  at.setUTCDate(at.getUTCDate() + days);
  return at.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// ⚖️ THE TWO ARMS ARE ENFORCED AT DIFFERENT PLACES, AND THAT IS THE RULING.
//
// OWNER RULING, 2026-08-07, and it corrects this lane's first version.
//
// The two things this file measures carry different risks and must not share a
// blast radius:
//
//   A. A STALE PROBE STAMP. The record has not been refreshed inside the 30-day
//      bound. The risk is "we would be SHIPPING on evidence nobody re-checked".
//      That is a release-time risk and nothing else.
//
//   B. AN ACTUALLY-EXPIRED VENDOR WINDOW. The vendor has stopped supporting a
//      version this repository still pins. The risk is real right now, for
//      everyone, whether or not anyone is cutting a release.
//
// The first version failed on BOTH, per-push, in a required `meta-checks` step.
// The undisclosed consequence: from the 31st day, EVERY PULL REQUEST IN THE
// REPOSITORY would have gone red until a human ran the probe and committed —
// an escalation from "cannot cut a release" to "cannot merge anything", for
// work with no connection to releasing. A 30-day clock must not be able to
// brick the repository.
//
// So the arms are split:
//
//   A. staleness  -> WARNS here, per-push, from 21 days out and thereafter.
//                    It FAILS at release/tag time, where it already did and
//                    still does: `e2e/attestation`'s `checkVersionSupportWindows`,
//                    which `publish.yml` blocks on at a `v*` tag. That is not a
//                    promise in a comment — `check-support-window-freshness.test.mjs`
//                    imports the REAL gate and drives a stale record through it.
//   B. expiry     -> FAILS everywhere, per-push included. You cannot merge a
//                    repository that pins an out-of-support version, because
//                    that is not a fact about releasing.
//
// Malformed records (future-dated, missing target, versioned target with no
// support-end date) FAIL everywhere too: they are integrity errors, not clocks.
//
// `enforceStaleness: true` puts arm A back on FAIL, for a caller that IS a
// release cut. It is exercised by the suite rather than left as an unreachable
// flag, and it is what keeps the two halves' arithmetic provably identical.
// ---------------------------------------------------------------------------

/**
 * Assesses one target against `today`.
 *
 * The thresholds are deliberately the release gate's own, not a stricter
 * approximation of them: `age > maxAgeDays` and `supportEndsOn <= today`. What
 * differs between here and the gate is the LEVEL the staleness threshold
 * produces — see the ruling above — never the threshold itself.
 */
export function assessTarget(record, today, options = {}) {
  const maxAgeDays = options.maxAgeDays ?? MAX_RECORD_AGE_DAYS;
  const leadDays = options.leadDays ?? WARN_LEAD_DAYS;
  const expiryWarnDays = options.expiryWarnDays ?? EXPIRY_WARN_DAYS;
  /** Arm A's level. `false` (the per-push default) warns; `true` is the release-cut caller. */
  const staleLevel = options.enforceStaleness === true ? "fail" : "warn";

  const age = daysBetween(record.confirmedOn, today);
  // The gate fails at `age > maxAgeDays`, so the first failing day is
  // `confirmedOn + maxAgeDays + 1`. Computed rather than described, because the
  // whole value of this lane is naming that date before it arrives.
  const staleOn = addDays(record.confirmedOn, maxAgeDays + 1);
  // ...and the first day this lane says anything at all, which is `staleOn`
  // minus the lead. Computed and PRINTED, because a reader of the passing
  // output should not have to do this arithmetic to know when it will speak.
  const warnFrom = addDays(record.confirmedOn, maxAgeDays - leadDays + 1);

  const findings = [];
  if (age < 0) {
    findings.push({
      level: "fail",
      message:
        `${record.target}: the record is dated ${record.confirmedOn}, in the FUTURE relative to ` +
        `${today} — it cannot describe anything that has happened.`,
    });
  } else if (age > maxAgeDays) {
    findings.push({
      level: staleLevel,
      message:
        `${record.target}: the support-window probe last ran ${Math.floor(age)} days ago ` +
        `(${record.confirmedOn}, limit ${String(maxAgeDays)}) — a RELEASE CUT HAS BEEN BLOCKED ` +
        `SINCE ${staleOn}. ` +
        (staleLevel === "warn"
          ? "This does NOT block your push: a stale probe stamp bars shipping, not merging. "
          : "") +
        `Re-run \`npm run probe:support-windows\` and commit the result.`,
    });
  } else if (age > maxAgeDays - leadDays) {
    findings.push({
      level: "warn",
      message:
        `${record.target}: the support-window record turns the release gate RED on ${staleOn} ` +
        `(probed ${record.confirmedOn}, ${String(Math.floor(maxAgeDays - age + 1))} day(s) left). ` +
        `Re-run \`npm run probe:support-windows\` and commit the result before then.`,
    });
  }

  if (record.lifecycle !== "continuous") {
    const endsOn = record.supportEndsOn ?? "";
    const remaining = daysBetween(today, endsOn);
    if (!ISO_DATE.test(endsOn)) {
      findings.push({
        level: "fail",
        message: `${record.target}: a versioned target carries no vendor support-end date.`,
      });
    } else if (remaining <= 0) {
      findings.push({
        level: "fail",
        message:
          `${record.target}: vendor support for ${record.pinnedVersion} ENDED ${endsOn} — ` +
          "this repository pins an out-of-support version. Unlike a stale probe stamp, this " +
          "BLOCKS EVERYWHERE, per-push included: it is a fact about what is pinned today, not " +
          "about releasing. The remedy is a fixture refresh (retire or move the pinned " +
          "version), never a weakened bound.",
      });
    } else if (remaining <= expiryWarnDays) {
      findings.push({
        level: "warn",
        message:
          `${record.target}: vendor support for ${record.pinnedVersion} ends ${endsOn}, in ` +
          `${String(Math.floor(remaining))} day(s). Plan the fixture refresh.`,
      });
    }
  }

  return { target: record.target, age, staleOn, warnFrom, findings };
}

const WORST = { pass: 0, warn: 1, fail: 2 };

/** Assesses every required target, reporting a missing one as a coverage FAIL rather than skipping it. */
export function assessSupportWindows(input) {
  const today = input.today;
  const required = input.requiredTargets ?? REQUIRED_SUPPORT_WINDOW_TARGETS;
  const findings = [];
  const perTarget = [];

  for (const target of required) {
    const record = input.records.find((candidate) => candidate.target === target);
    if (record === undefined) {
      findings.push({
        level: "fail",
        message:
          `${target}: no support-window record at ${SUPPORT_WINDOW_RECORD_PATH} — ` +
          "the release gate fails this target on coverage.",
      });
      continue;
    }
    const assessed = assessTarget(record, today, input);
    perTarget.push(assessed);
    findings.push(...assessed.findings);
  }

  const level = findings.reduce(
    (worst, finding) => (WORST[finding.level] > WORST[worst] ? finding.level : worst),
    "pass",
  );
  return { level, findings, perTarget };
}

// ---------------------------------------------------------------------------
// THE AUTO-RENEWAL TRIPWIRE
// ---------------------------------------------------------------------------

/** Ways a workflow could run the probe. */
const RUNS_PROBE = [/probe:support-windows/, /supportWindowsCli/];

/**
 * Ways a workflow could commit or push what the probe wrote.
 *
 * Deliberately over-inclusive, and in the safe direction: a false positive
 * costs one conversation, while a miss silently converts a 30-day evidence
 * bound into a self-renewing formality. `contents: write` is listed even though
 * it only GRANTS the ability — a workflow that runs the probe has no business
 * holding write permission, and requiring that to be argued for is the point.
 */
const COMMITS_OUTPUT = [
  // `-C <dir>` is the spelling a workflow that checks out into a subdirectory
  // would naturally use, and the first version matched only `-c <cfg>`. Both
  // flags repeat, hence the `*`.
  { label: "`git commit`", pattern: /git\s+(?:-[cC]\s+\S+\s+)*commit\b/ },
  { label: "`git push`", pattern: /git\s+(?:-[cC]\s+\S+\s+)*push\b/ },
  { label: "`contents: write` permission", pattern: /contents:\s*write/ },
  { label: "git-auto-commit-action", pattern: /git-auto-commit-action/ },
  { label: "add-and-commit action", pattern: /add-and-commit/ },
  { label: "create-pull-request action", pattern: /create-pull-request/ },
  { label: "`gh pr create`", pattern: /gh\s+pr\s+create/ },
  // The two API spellings that write a file without ever invoking git.
  { label: "`gh api` contents write", pattern: /gh\s+api[^\n]*\/contents\// },
  { label: "github-script createOrUpdateFileContents", pattern: /createOrUpdateFileContents/ },
];

/**
 * ⚠️ WHAT THIS SCAN DOES NOT COVER, stated rather than left to be discovered.
 *
 * It is a textual scan over workflow YAML, so it sees spellings, not
 * capabilities. A workflow could still persist the probe's output by a route
 * none of the patterns above name — a third-party action wrapping a commit, a
 * shell script in the repository invoked from a `run:` step, `curl` against the
 * contents API, or a `git` alias. The `contents: write` arm is the broad net
 * underneath all of those, and it catches them ONLY when the workflow declares
 * that permission explicitly rather than inheriting a permissive default.
 *
 * That residual is real and is not claimed away. What the scan buys is that the
 * ORDINARY spellings — the ones someone would actually reach for when adding
 * "and commit the refreshed record" to `drift-ci.yml` — cannot land silently.
 */

/**
 * Workflows that both RUN the probe and CAN commit its output.
 *
 * The conjunction is the whole rule. Plenty of workflows legitimately commit
 * things; plenty legitimately run probes. What must never coexist in one
 * workflow is the thing that writes the gate's input and the ability to persist
 * it — that is a gate renewing itself.
 */
export function scanWorkflowsForAutoRenewal(workflows) {
  const offenders = [];
  for (const { path: workflowPath, text } of workflows) {
    if (!RUNS_PROBE.some((pattern) => pattern.test(text))) continue;
    const mechanisms = COMMITS_OUTPUT.filter(({ pattern }) => pattern.test(text)).map(
      ({ label }) => label,
    );
    if (mechanisms.length > 0) offenders.push({ path: workflowPath, mechanisms });
  }
  return offenders;
}

/** Every workflow file, as `{ path, text }`. */
export function readWorkflows(repoRoot = REPO_ROOT) {
  const dir = path.join(repoRoot, ...WORKFLOWS_DIR.split("/"));
  return readdirSync(dir)
    .filter((name) => name.endsWith(".yml") || name.endsWith(".yaml"))
    .sort()
    .map((name) => ({
      path: `${WORKFLOWS_DIR}/${name}`,
      text: readFileSync(path.join(dir, name), "utf8"),
    }));
}

/** Reads the COMMITTED record — never the probe's fresh output. That distinction is the point. */
export function readCommittedRecords(repoRoot = REPO_ROOT) {
  return JSON.parse(
    readFileSync(path.join(repoRoot, ...SUPPORT_WINDOW_RECORD_PATH.split("/")), "utf8"),
  );
}

/**
 * `options.enforceStaleness` selects the arm-A level — see the ruling above.
 * The default (`false`) is the per-push posture this script is wired into
 * `meta-checks` with: a stale probe stamp warns and does not block a merge.
 */
export function runSupportWindowFreshnessCheck(
  repoRoot = REPO_ROOT,
  today = undefined,
  options = {},
) {
  const at = today ?? new Date().toISOString().slice(0, 10);
  const assessment = assessSupportWindows({
    records: readCommittedRecords(repoRoot),
    today: at,
    ...options,
  });
  const offenders = scanWorkflowsForAutoRenewal(readWorkflows(repoRoot));

  for (const finding of assessment.findings) {
    if (finding.level === "warn") {
      // `::warning::` so it lands on the job summary and on the diff of any PR
      // that touches these files, not only in a log nobody opens.
      console.log(`::warning::check-support-window-freshness: ${finding.message}`);
    } else {
      console.error(`check-support-window-freshness: FAIL — ${finding.message}`);
    }
  }

  for (const offender of offenders) {
    console.error(
      `check-support-window-freshness: FAIL — ${offender.path} both RUNS the support-window ` +
        `probe and can commit its output (${offender.mechanisms.join(", ")}). That would let the ` +
        "release gate's own 30-day freshness bound renew itself, silently and forever. A refresh " +
        "must land through a deliberate, reviewable change — upload the probe's output as an " +
        "artifact instead.",
    );
  }

  if (assessment.level === "fail" || offenders.length > 0) return 1;

  for (const entry of assessment.perTarget) {
    // BOTH dates, printed rather than implied. The first version printed only
    // the red date, while a committed transcript claimed both were printed —
    // and got the warn day wrong by eleven days in the process. A reader should
    // not have to redo this arithmetic to check a claim about it.
    console.log(
      `check-support-window-freshness: ${entry.target} — probed ${Math.floor(entry.age)} day(s) ` +
        `ago, warns from ${entry.warnFrom}, release cut blocked from ${entry.staleOn}`,
    );
  }
  console.log(
    assessment.level === "warn"
      ? `check-support-window-freshness: WARN — ${String(assessment.findings.length)} advance ` +
          `warning(s) above. A stale probe stamp does NOT block this push; it blocks a release ` +
          `cut, where \`e2e/attestation\`'s own gate refuses it. No workflow can renew the bound ` +
          `by committing the probe's output.`
      : "check-support-window-freshness: PASS — every target is inside the freshness bound and " +
          "inside its vendor support window; no workflow can renew the bound by committing the " +
          "probe's output.",
  );
  return 0;
}

/* c8 ignore start — entry point; the exported functions above are what the suite drives. */
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(runSupportWindowFreshnessCheck());
}
/* c8 ignore stop */
