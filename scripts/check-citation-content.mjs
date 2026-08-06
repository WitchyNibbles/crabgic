#!/usr/bin/env node
/**
 * Content-checks every citation in `docs/evidence/criteria-closeout/phase-NN.json`
 * against the tree, and every `path:NN` written in the roadmap and defect prose.
 *
 * WHY THIS EXISTS. This repository's verification method is line-anchored
 * citation, and line-anchored citations rot silently. `check-criteria-closeout`
 * resolves a citation's `ref` to a real file and checks the cited line is not
 * past the end of it — it never reads what is ON that line. `check-citation-runs`
 * checks a run URL's shape. Neither reads a single quoted character. So the
 * moment any later PR inserts lines above cited text, the merged record keeps
 * validating and keeps pointing at the wrong place, forever. That is not a
 * hypothesis. Measured by this tool over the 25 records at `e5a65ba`: of 1292
 * content-checkable citations, **182 quote text that is verifiably present in
 * the cited file and verifiably NOT at the cited line** — 154 of them under
 * ticked criteria — caused by at least five separate merged PRs, one of which is
 * the PR whose own pass filed the defect record asking for this check
 * (`defects/17-merged-citations-stale-after-later-prs.md`). A further 42 quote
 * text that repeats in the cited file, so their position cannot be verified by
 * content at all. The per-record burn-down is pinned in
 * `docs/evidence/citation-resolver/seed-census-batchN.txt`.
 *
 * WHAT IT DOES.
 *   `--check` (default)   the blocking lane. Two parts:
 *                         (a) the citation ratchet — see `citation-content/
 *                             baseline.mjs`. Fails when a PR moves the ground
 *                             under a citation, when a new or edited citation
 *                             does not resolve where it claims, or when the
 *                             baseline stops describing the corpus.
 *                         (b) the prose lane — every `path:NN` in `roadmap/*.md`
 *                             and `defects/*.md` outside a fenced block must
 *                             name a real file at a line that exists. Measured
 *                             at zero failures, so it starts silent.
 *   `--report`            the four-rule sweep, non-blocking: content, line
 *                         anchoring + span containment, group consecutiveness,
 *                         repeat-text census, plus ready-to-paste dated
 *                         corrections for every moved citation.
 *   `--update-baseline`   regenerate the pinned baseline. Refuses to bless a new
 *                         or edited citation that does not resolve where it
 *                         claims (that is what stops the ratchet being paper).
 *   `--fix`              rewrite drifted line markers, **only** in records this
 *                         branch itself has modified. Merged records are never
 *                         touched: annotate-never-rewrite is the repo's evidence
 *                         discipline, a re-anchored citation silently claims a
 *                         pass verified code it never read, and 42 of the moved
 *                         citations quote repeat text where a mechanical
 *                         re-anchor picks a line by luck.
 *
 * Dependency-free ESM: `meta-checks` runs `npm ci` with no build step.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  BASELINE_FILE,
  buildBaseline,
  diffAgainstBaseline,
  serializeBaseline,
  shortHash,
} from "./citation-content/baseline.mjs";
import { createFileLoader } from "./citation-content/file-index.mjs";
import { logReachedTheSuite, matchJobLogLine } from "./citation-content/job-log.mjs";
import { checkProseFile } from "./citation-content/prose-refs.mjs";
import { extractFragments } from "./citation-content/quoted-assertion.mjs";
import {
  RESOLVABLE_KINDS,
  STALE_STATUSES,
  anchorOccurrence,
  createPathResolver,
  resolveRecord,
} from "./citation-content/resolver.mjs";

const REPO_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const RECORD_DIRECTORY = "docs/evidence/criteria-closeout";
const PROSE_SOURCES = [
  { directory: "roadmap", match: (name) => name.endsWith(".md") },
  { directory: `${RECORD_DIRECTORY}/defects`, match: (name) => name.endsWith(".md") },
];

const REPAIR_COMMAND = "npm run check:citation-content -- --update-baseline";

function listRecords(repoRoot) {
  return readdirSync(path.join(repoRoot, RECORD_DIRECTORY))
    .filter((name) => /^phase-\d+\.json$/.test(name))
    .sort();
}

/** Resolves every content-checkable citation in every record, at the given tree. */
export function resolveCorpus(repoRoot) {
  const load = createFileLoader(repoRoot);
  const resolvePath = createPathResolver(repoRoot, load);
  const entries = [];
  for (const name of listRecords(repoRoot)) {
    const record = JSON.parse(readFileSync(path.join(repoRoot, RECORD_DIRECTORY, name), "utf8"));
    for (const entry of resolveRecord(name, record, load, resolvePath)) {
      const citation = record.criteria
        .find((criterion) => criterion.index === entry.criterion)
        .citations.filter((each) => RESOLVABLE_KINDS.has(each.kind) && each.ref === entry.ref)[
        entry.ordinal
      ];
      entry.quotedAssertionHash = shortHash(citation?.quotedAssertion ?? "");
      entries.push(entry);
    }
  }
  return { entries, load };
}

export function sweepProse(repoRoot) {
  const load = createFileLoader(repoRoot);
  const resolvePath = createPathResolver(repoRoot, load);
  const rows = [];
  for (const source of PROSE_SOURCES) {
    const directory = path.join(repoRoot, source.directory);
    for (const name of readdirSync(directory).filter(source.match).sort()) {
      const relative = `${source.directory}/${name}`;
      rows.push(
        ...checkProseFile(
          relative,
          readFileSync(path.join(repoRoot, relative), "utf8"),
          load,
          resolvePath,
        ),
      );
    }
  }
  return rows;
}

function headSha(repoRoot) {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "unknown";
  }
}

function censusOf(entries) {
  const census = {
    citations: entries.length,
    fragments: 0,
    anchored: 0,
    seededStale: 0,
    outsideSpan: 0,
    repeatText: 0,
    crossFile: 0,
    skipped: 0,
  };
  for (const entry of entries) {
    for (const fragment of entry.fragments) {
      census.fragments += 1;
      const { resolution } = fragment;
      if (resolution.status.startsWith("SKIP")) census.skipped += 1;
      else if (STALE_STATUSES.has(resolution.status)) census.seededStale += 1;
      else census.anchored += 1;
      if (resolution.outsideSpan === true) census.outsideSpan += 1;
      if (resolution.repeat === true) census.repeatText += 1;
      if (resolution.crossFile === true) census.crossFile += 1;
    }
  }
  return census;
}

/** `path:NN → :MM` lines a maintainer can paste beside a merged citation. */
export function datedCorrections(entries, today) {
  const lines = [];
  for (const entry of entries) {
    for (const fragment of entry.fragments) {
      const { resolution } = fragment;
      if (resolution.status !== "MOVED") continue;
      const anchor = anchorOccurrence(resolution);
      if (anchor === null) continue;
      const to =
        anchor[0] === anchor[1] ? String(anchor[0]) : `${String(anchor[0])}-${String(anchor[1])}`;
      lines.push(
        `${entry.record} c${String(entry.criterion)}: ${resolution.filePath}:${String(resolution.low)} → :${to}` +
          ` — corrected ${today}; quote ${JSON.stringify(fragment.text.slice(0, 60))}`,
      );
    }
  }
  return lines;
}

/**
 * Byte-compares each `ci-run` citation's quoted log lines against logs already
 * downloaded to `directory` as `<jobId>.txt`.
 *
 * Not part of any CI lane and deliberately so: it needs the network and a token,
 * and `meta-checks` gets neither. It exists because the alternative — a closeout
 * pass eyeballing quoted log lines — has a measured failure rate of 16 wrong
 * quotes in 18 (`docs/verification-playbook.md`). Run it from a closeout pass:
 *   gh api repos/WitchyNibbles/crabgic/actions/jobs/<id>/logs > logs/<id>.txt
 *   npm run check:citation-content -- --report --job-logs logs
 */
export function sweepJobLogs(repoRoot, directory) {
  const output = [];
  for (const name of listRecords(repoRoot)) {
    const record = JSON.parse(readFileSync(path.join(repoRoot, RECORD_DIRECTORY, name), "utf8"));
    for (const criterion of record.criteria) {
      for (const citation of criterion.citations ?? []) {
        if (citation.kind !== "ci-run") continue;
        const jobId = /job (\d+)/.exec(citation.ref)?.[1];
        if (jobId === undefined) continue;
        let logLines;
        try {
          logLines = readFileSync(path.resolve(repoRoot, directory, `${jobId}.txt`), "utf8").split(
            "\n",
          );
        } catch {
          output.push(
            `${name} c${String(criterion.index)}: job ${jobId} — log not downloaded, skipped`,
          );
          continue;
        }
        if (!logReachedTheSuite(logLines)) {
          output.push(
            `${name} c${String(criterion.index)}: job ${jobId} — the job never reached the suite ` +
              "(setup/infra failure); its quoted lines are NOT checkable against this log, and their " +
              "absence says nothing about the record",
          );
          continue;
        }
        for (const fragment of extractFragments(citation.quotedAssertion ?? "").fragments) {
          const forms = logLines
            .map((line) => matchJobLogLine(line, fragment.text))
            .filter(Boolean);
          output.push(
            `${name} c${String(criterion.index)}: job ${jobId} ${forms.length === 0 ? "NOT FOUND" : `matched (${forms[0]})`} ` +
              JSON.stringify(fragment.text.slice(0, 70)),
          );
        }
      }
    }
  }
  return output;
}

function readBaseline(repoRoot) {
  try {
    return JSON.parse(readFileSync(path.join(repoRoot, BASELINE_FILE), "utf8"));
  } catch {
    return null;
  }
}

function describeDivergence(divergence) {
  if (divergence.class === "removed") {
    return `  ${divergence.key}\n      the baseline pins a citation this corpus no longer has`;
  }
  if (divergence.class === "unanchored") {
    return (
      `  ${divergence.key}${divergence.edited === true ? " (quotedAssertion edited)" : " (new citation)"}\n` +
      divergence.offending.map((pin) => `      ${pin}`).join("\n")
    );
  }
  if (divergence.class === "added") {
    return `  ${divergence.key} — resolves cleanly, but is not in the baseline`;
  }
  const before = divergence.before ?? [];
  const after = divergence.after ?? [];
  const rows = [];
  for (let i = 0; i < Math.max(before.length, after.length); i += 1) {
    if (before[i] === after[i]) continue;
    rows.push(`      ${before[i] ?? "(none)"}  →  ${after[i] ?? "(none)"}`);
  }
  return `  ${divergence.key} (${divergence.entry.ref})\n${rows.join("\n")}`;
}

const BLOCKING_HEADINGS = [
  [
    "unanchored",
    "NEW OR EDITED CITATIONS THAT DO NOT RESOLVE WHERE THEY CLAIM",
    "Fix the record — this is not repairable by regenerating the baseline. A citation added or " +
      "edited in this PR must quote text that is present, at the line its marker names, inside the " +
      "span its `ref` declares. `--report` prints where each quote actually is.",
  ],
  [
    "frozen",
    "COMMITTED EVIDENCE UNDER docs/evidence/** HAS CHANGED",
    "A citation is quoting a committed transcript and the transcript no longer reads that way. " +
      "Committed evidence is frozen by the annotate-never-rewrite discipline: add a dated " +
      "correction beside the original rather than editing it, and say so in the PR body.",
  ],
  [
    "regressed",
    "THIS PR MOVED LINES UNDER A MERGED CITATION",
    "This is the failure this check exists for. The record's claim is probably still true and its " +
      "pointer is now wrong. Paste the dated correction `--report` prints beside the merged " +
      `citation (never rewrite it), then run \`${REPAIR_COMMAND}\`.`,
  ],
  [
    "drifted",
    "ALREADY-STALE CITATIONS HAVE MOVED AGAIN",
    `Known drift moved further. Run \`${REPAIR_COMMAND}\`; the baseline diff is the record.`,
  ],
  [
    "improved",
    "CITATIONS THAT NOW RESOLVE (a correction landed)",
    `Good news. Run \`${REPAIR_COMMAND}\` so the baseline stops claiming they are stale.`,
  ],
  [
    "changed",
    "CITATIONS WHOSE RESOLUTION CHANGED",
    `Run \`${REPAIR_COMMAND}\` and read the diff before you push it.`,
  ],
  ["added", "CITATIONS MISSING FROM THE BASELINE", `Run \`${REPAIR_COMMAND}\`.`],
  ["removed", "BASELINE ENTRIES WITH NO CITATION", `Run \`${REPAIR_COMMAND}\`.`],
];

function runCheck(repoRoot) {
  const { entries } = resolveCorpus(repoRoot);
  const baseline = readBaseline(repoRoot);
  const problems = [];
  if (baseline === null) {
    console.error(
      `check-citation-content: ${BASELINE_FILE} is missing. Seed it with \`${REPAIR_COMMAND}\`.`,
    );
    return 1;
  }
  const census = censusOf(entries);
  const proseRows = sweepProse(repoRoot);
  console.log(
    `check-citation-content: ${String(census.citations)} citation(s), ${String(census.fragments)} quoted fragment(s) ` +
      `(${String(census.anchored)} anchored, ${String(census.seededStale)} known-stale, ${String(census.skipped)} not file quotes); ` +
      `${String(proseRows.length)} prose reference(s), ${String(proseRows.filter((row) => row.tier === "unresolved").length)} bare-basename (unchecked).`,
  );
  const divergences = diffAgainstBaseline(entries, baseline);
  const byClass = new Map();
  for (const divergence of divergences) {
    const bucket = byClass.get(divergence.class);
    if (bucket === undefined) byClass.set(divergence.class, [divergence]);
    else bucket.push(divergence);
  }
  for (const [divergenceClass, heading, guidance] of BLOCKING_HEADINGS) {
    const bucket = byClass.get(divergenceClass);
    if (bucket === undefined) continue;
    console.error(`\n${heading} — ${String(bucket.length)}`);
    console.error(`  ${guidance}`);
    for (const divergence of bucket) console.error(describeDivergence(divergence));
    problems.push(...bucket);
  }

  const proseFailures = proseRows.filter((row) => row.tier === "past-eof");
  if (proseFailures.length > 0) {
    console.error(`\nPROSE REFERENCES THAT DO NOT RESOLVE — ${String(proseFailures.length)}`);
    console.error(
      "  A `path:NN` in the roadmap or a defect record names a file that is absent, or a line past " +
        "its end. Correct the reference (dated, beside the original, if the text is merged).",
    );
    for (const row of proseFailures) {
      console.error(`  [${row.tier}] ${row.source} → ${row.ref}  ${row.note}`);
    }
  }

  if (problems.length + proseFailures.length === 0) {
    console.log(
      "check-citation-content: PASS — every citation resolves exactly as the baseline pins it.",
    );
    return 0;
  }
  console.error(
    `\ncheck-citation-content: FAIL — ${String(problems.length)} citation divergence(s), ` +
      `${String(proseFailures.length)} prose failure(s).`,
  );
  return 1;
}

function runUpdate(repoRoot, { allowUnanchored, today }) {
  const { entries } = resolveCorpus(repoRoot);
  const baseline = readBaseline(repoRoot);
  if (baseline !== null && !allowUnanchored) {
    const unanchored = diffAgainstBaseline(entries, baseline).filter(
      (divergence) => divergence.class === "unanchored",
    );
    if (unanchored.length > 0) {
      console.error(
        `check-citation-content: REFUSING to regenerate — ${String(unanchored.length)} new or edited ` +
          "citation(s) do not resolve where they claim. Regenerating would pin the defect as the " +
          "new normal, which is exactly how a ratchet becomes paper. Fix the record, or pass " +
          "--allow-unanchored and justify it in the PR body.",
      );
      for (const divergence of unanchored) console.error(describeDivergence(divergence));
      return 1;
    }
  }
  const census = censusOf(entries);
  const next = buildBaseline(entries, {
    generatedAt: today,
    generatedAtSha: headSha(repoRoot),
    note:
      "Bookkeeping inside the claim-space — NEVER citable as evidence. Pins where every quoted " +
      "fragment of every content-checkable citation resolves, so that a PR which moves lines under " +
      "a merged citation fails on that PR. Seeded stale entries are known legacy drift, burnt down " +
      "by dated corrections beside the records; they are not licence to add more. Regenerate with " +
      `\`${REPAIR_COMMAND}\`.`,
    counts: census,
  });
  writeFileSync(path.join(repoRoot, BASELINE_FILE), serializeBaseline(next), "utf8");
  console.log(
    `check-citation-content: wrote ${BASELINE_FILE} — ${String(census.citations)} citation(s), ` +
      `${String(census.fragments)} fragment(s), ${String(census.seededStale)} known-stale, ` +
      `${String(census.outsideSpan)} outside their declared span.`,
  );
  return 0;
}

function runReport(repoRoot, { out, today, jobLogs }) {
  const { entries } = resolveCorpus(repoRoot);
  const census = censusOf(entries);
  const lines = [];
  const say = (line) => lines.push(line);
  say(`# citation-content report — ${today} @ ${headSha(repoRoot)}`);
  say("");
  say(
    "Four rules: content; line anchoring + span containment; group consecutiveness; repeat text.",
  );
  say("Report-only. The blocking lane is the ratchet in `--check`.");
  say("");
  say("## Census");
  for (const [key, value] of Object.entries(census)) say(`- ${key}: ${String(value)}`);
  say("");
  say("## Classification of flagged citations (the burn-down's units)");
  const classes = new Map();
  for (const entry of entries) {
    const statuses = new Set(
      entry.fragments
        .map((fragment) => fragment.resolution.status)
        .filter((status) => STALE_STATUSES.has(status)),
    );
    if (statuses.size === 0) continue;
    const label = statuses.has("FILE-MISSING")
      ? "UNRESOLVED PATH inside the quote (usually an ambiguous bare basename)"
      : statuses.has("PAST-EOF")
        ? "HARD (marker past EOF)"
        : statuses.has("MOVED")
          ? "MOVED-unique (position measured — a dated correction is mechanical)"
          : statuses.has("MOVED-AMBIG")
            ? "MOVED-ambiguous (repeat text — position NOT verifiable by content)"
            : "ABSENT-only (quote-convention variance or a real rewrite — needs a human)";
    classes.set(label, (classes.get(label) ?? 0) + 1);
    if (entry.ticked) {
      classes.set(`${label} [ticked]`, (classes.get(`${label} [ticked]`) ?? 0) + 1);
    }
  }
  for (const [label, count] of [...classes].sort()) say(`- ${label}: ${String(count)}`);
  say("");
  say(
    "## Per-record burn-down (stale fragments / stale citations / of which under a ticked criterion)",
  );
  const perRecord = new Map();
  for (const entry of entries) {
    const row = perRecord.get(entry.record) ?? { fragments: 0, citations: 0, ticked: 0 };
    const stale = entry.fragments.filter((fragment) =>
      STALE_STATUSES.has(fragment.resolution.status),
    ).length;
    row.fragments += stale;
    if (stale > 0) {
      row.citations += 1;
      if (entry.ticked) row.ticked += 1;
    }
    perRecord.set(entry.record, row);
  }
  for (const [name, row] of [...perRecord].sort()) {
    say(`- ${name}: ${String(row.fragments)} / ${String(row.citations)} / ${String(row.ticked)}`);
  }

  const staleByRecord = new Map();
  say("");
  say("## Rule 1+2 — fragments that do not resolve at the line they claim");
  for (const entry of entries) {
    const stale = entry.fragments.filter((fragment) =>
      STALE_STATUSES.has(fragment.resolution.status),
    );
    if (stale.length === 0) continue;
    staleByRecord.set(entry.record, (staleByRecord.get(entry.record) ?? 0) + stale.length);
    say(`- ${entry.key} (ticked=${String(entry.ticked)})`);
    for (const fragment of stale) {
      const at = (fragment.resolution.occurrences ?? []).map((each) => each.join("-")).join(",");
      say(
        `    ${fragment.resolution.status} ${fragment.marker} ${JSON.stringify(fragment.text.slice(0, 72))}` +
          (at === "" ? "" : ` — text is at ${at}`),
      );
    }
  }
  say("");
  say("## Rule 2 (containment) — anchored fragments outside their citation's declared span");
  for (const entry of entries) {
    const outside = entry.fragments.filter((fragment) => fragment.resolution.outsideSpan === true);
    if (outside.length === 0) continue;
    say(`- ${entry.key}: ${String(outside.length)} fragment(s) outside ${entry.ref}`);
    for (const fragment of outside) {
      say(
        `    ${(anchorOccurrence(fragment.resolution) ?? []).join("-")} ${JSON.stringify(fragment.text.slice(0, 60))}`,
      );
    }
  }
  say("");
  say("## Rule 3 — group consecutiveness notes");
  for (const entry of entries) {
    for (const note of entry.notes) say(`- ${entry.key}: ${note}`);
  }
  say("");
  say("## Rule 4 — repeat text (content-verified, position NOT verified)");
  for (const entry of entries) {
    const repeats = entry.fragments.filter((fragment) => fragment.resolution.repeat === true);
    if (repeats.length === 0) continue;
    say(
      `- ${entry.key}: ${String(repeats.length)} fragment(s) whose text occurs more than once in the cited file`,
    );
  }
  say("");
  say("## Normalization ladder used");
  const levels = new Map();
  for (const entry of entries) {
    for (const fragment of entry.fragments) {
      const level = fragment.resolution.level;
      if (level === undefined || level === null) continue;
      levels.set(level, (levels.get(level) ?? 0) + 1);
    }
  }
  for (const [level, count] of [...levels].sort()) say(`- ${level}: ${String(count)}`);
  say("");
  say("## Ready-to-paste dated corrections (MOVED-unique only — never applied automatically)");
  for (const line of datedCorrections(entries, today)) say(`    ${line}`);
  if (jobLogs !== null) {
    say("");
    say(`## ci-run quoted log lines, byte-compared against ${jobLogs}`);
    for (const line of sweepJobLogs(repoRoot, jobLogs)) say(`    ${line}`);
  }
  say("");
  say("## Prose lane");
  const proseRows = sweepProse(repoRoot);
  const tiers = new Map();
  for (const row of proseRows) tiers.set(row.tier, (tiers.get(row.tier) ?? 0) + 1);
  for (const [tier, count] of [...tiers].sort()) say(`- ${tier}: ${String(count)}`);
  for (const row of proseRows) {
    if (row.tier === "ok") continue;
    say(`    [${row.tier}] ${row.source} → ${row.ref}  ${row.note}`);
  }

  const text = `${lines.join("\n")}\n`;
  if (out === null) process.stdout.write(text);
  else {
    writeFileSync(path.resolve(repoRoot, out), text, "utf8");
    console.log(`check-citation-content: report written to ${out}`);
  }
  return 0;
}

function changedRecords(repoRoot) {
  try {
    const output = execFileSync(
      "git",
      ["diff", "--name-only", "origin/main...HEAD", "--", `${RECORD_DIRECTORY}/`],
      { cwd: repoRoot, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    );
    return new Set(
      output
        .split("\n")
        .filter((line) => line.endsWith(".json"))
        .map((line) => path.posix.basename(line)),
    );
  } catch {
    return new Set();
  }
}

/**
 * Applies marker rewrites to one `quotedAssertion`, right to left so earlier
 * edits cannot shift later positions. Pure, so it can be tested without letting
 * a unit test anywhere near a real repository.
 */
export function applyMarkerRewrites(assertion, edits) {
  let result = assertion;
  for (const edit of [...edits].sort((a, b) => b.position - a.position)) {
    result =
      result.slice(0, edit.position) +
      edit.replacement +
      result.slice(edit.position + edit.text.length);
  }
  return result;
}

/**
 * Rewrites drifted `:NN` markers — ONLY in records this branch modified, and
 * only where the quoted text occurs exactly once in the file, so the new line is
 * a measurement rather than a guess.
 */
function runFix(repoRoot) {
  const own = changedRecords(repoRoot);
  if (own.size === 0) {
    console.error(
      "check-citation-content: --fix found no closeout record modified by this branch " +
        "(`git diff origin/main...HEAD`). It never edits a merged record: annotate-never-rewrite " +
        "is the discipline, and a bot re-anchoring merged citations is that violation at scale.",
    );
    return 1;
  }
  const { entries } = resolveCorpus(repoRoot);
  let rewritten = 0;
  for (const name of own) {
    const file = path.join(repoRoot, RECORD_DIRECTORY, name);
    const record = JSON.parse(readFileSync(file, "utf8"));
    for (const entry of entries.filter((each) => each.record === name)) {
      const citation = record.criteria
        .find((criterion) => criterion.index === entry.criterion)
        ?.citations.find((each) => each.ref === entry.ref);
      if (citation === undefined) continue;
      const edits = [];
      for (const fragment of entry.fragments) {
        const { resolution } = fragment;
        if (resolution.status !== "MOVED" || resolution.occurrences?.length !== 1) continue;
        if (fragment.markerPosition === null || fragment.markerPosition === undefined) continue;
        const [start] = resolution.occurrences[0];
        edits.push({
          position: fragment.markerPosition,
          text: fragment.markerText,
          replacement: fragment.markerText.replace(/:\d+(?:-\d+)?$/, `:${String(start)}`),
        });
      }
      if (edits.length === 0) continue;
      citation.quotedAssertion = applyMarkerRewrites(citation.quotedAssertion, edits);
      rewritten += edits.length;
    }
    writeFileSync(file, `${JSON.stringify(record, null, 2)}\n`, "utf8");
  }
  console.log(
    `check-citation-content: --fix rewrote ${String(rewritten)} marker(s) in ${String(own.size)} record(s) ` +
      "this branch owns. Re-read every one before you push — a re-anchored citation asserts that " +
      "the pass verified the code at its NEW location.",
  );
  return 0;
}

export function main(argv) {
  const args = new Set(argv);
  const outIndex = argv.indexOf("--out");
  // `--repo` points the whole resolver at another checkout. It is what makes the
  // "would this have caught PR #95 the moment it landed?" question answerable
  // rather than assertable: run today's resolver over a worktree at that PR's
  // parent and at that PR's merge, and read the two verdicts.
  const repoIndex = argv.indexOf("--repo");
  const repoRoot = repoIndex >= 0 ? path.resolve(argv[repoIndex + 1]) : REPO_ROOT;
  const today = new Date().toISOString().slice(0, 10);
  const jobLogsIndex = argv.indexOf("--job-logs");
  const options = {
    out: outIndex >= 0 ? argv[outIndex + 1] : null,
    jobLogs: jobLogsIndex >= 0 ? argv[jobLogsIndex + 1] : null,
    allowUnanchored: args.has("--allow-unanchored"),
    today,
  };
  if (args.has("--update-baseline")) return runUpdate(repoRoot, options);
  if (args.has("--report")) return runReport(repoRoot, options);
  if (args.has("--fix")) return runFix(repoRoot);
  return runCheck(repoRoot);
}

const isMain =
  process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) process.exit(main(process.argv.slice(2)));
