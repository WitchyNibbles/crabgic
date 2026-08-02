#!/usr/bin/env node
/**
 * Validates the criteria-closeout index — `docs/evidence/criteria-closeout/
 * phase-NN.json`, one record per roadmap phase, written by the closeout pass
 * that walks each phase's exit criteria against its own recorded evidence.
 *
 * Run with:
 *   node scripts/check-criteria-closeout.mjs        (all committed records)
 *   npm run check:criteria-closeout
 *
 * Wired into `ci.yml`'s `meta-checks` job. The validator's own rejection
 * paths — the ones a green run over valid records never reaches — are
 * unit-tested in `check-criteria-closeout.test.mjs`.
 *
 * WHY THIS EXISTS. `roadmap/README.md`'s completion ledger refuses to tick a
 * checkbox from general confidence: "each checkbox must map to a CI run,
 * journal entry, or committed artifact." The closeout pass applies that rule
 * to itself, and this check is what keeps the resulting records from becoming
 * the very thing they exist to prevent — a self-reported claim nothing
 * verifies. Concretely it makes ten drifts impossible to land quietly:
 *
 *   0. A phase file with more than one `## Exit criteria` section. Listed
 *      first because every check below is downstream of a single parse: it
 *      read only the FIRST such section, so a decoy inserted earlier in the
 *      file let the REAL section be fraudulently ticked and wholly rewritten
 *      with nothing reported at all. The heading match is fenced-code aware
 *      too, so a `## Exit criteria` inside a ``` example is not mistaken for
 *      the real one, and criterion-shaped lines outside the section fail.
 *   1. A criterion's wording being weakened to make it tickable. Each record
 *      pins `sha256(text)` AND requires that verbatim text to still be the
 *      prefix of a real checkbox item in the phase file — with the remainder
 *      constrained to the `— **` citation annotation, so a record cannot pin
 *      a harmless opening substring, or stop at the criterion's own internal
 *      em dash, and leave the tail unaccounted for.
 *   2. A checkbox and its record being rewritten TOGETHER. Everything in (1)
 *      compares the record against the phase file in the same commit, so a
 *      co-edit is self-consistent and used to pass — a reviewer cut phase 03's
 *      criterion 2 down to "Compiler property suite green in CI." and nothing
 *      complained. Each criterion is therefore also held against
 *      `criteria-baseline.json`, one frozen hash per criterion taken from the
 *      phase file BEFORE its closeout and re-derivable from git history by
 *      `scripts/generate-criteria-baseline.mjs --check`.
 *   3. A checkbox and its record disagreeing — or a tick with no record at
 *      all. Tick state and checkbox count are cross-checked against the roadmap
 *      file in both directions; a phase file that cites a closeout record which
 *      was never written is reported; and so is a phase file carrying ticked
 *      criteria with no record whatsoever, which was the cheapest attack on the
 *      whole regime (tick everything, write nothing) until it was closed.
 *   4. A tick with nothing behind it. `ticked` is derived from the
 *      classification (never independently asserted), every tick needs at
 *      least one citation, every `WORDING-MISMATCH` needs a before/after whose
 *      `before` IS the criterion's own pinned text, and every `UNMET` needs a
 *      defect record that is a real defect record — not merely a file that
 *      exists, which a reviewer satisfied by truncating one to zero bytes.
 *   5. A citation that points at nothing. `test` and `artifact` refs are
 *      repository paths and must resolve to a regular file inside the repo
 *      root — and NOT to a symlink, because `existsSync`/`statSync` follow
 *      links while `path.resolve` does not, so a committed
 *      `evidence/evil.txt -> /etc/hostname` used to read as evidence. This is
 *      not hypothetical: this pass's own phase-12 defect exists BECAUSE a
 *      cited test file was deleted in a refactor and nothing noticed.
 *   6. A `file:line` that has gone stale. The line span is checked against the
 *      file's real length. The pilot rebased once and five of its own line
 *      citations had slid, none catchable, because the files still existed.
 *   7. A criterion invented in a phase file that has NO closeout record.
 *      Every baseline comparison used to run THROUGH a record, and `--check`
 *      only compares the committed JSON against git — never the working
 *      tree — so a record-less phase file was pinned by nothing, while
 *      `discharge` citations resolve against exactly those files. Phase 23
 *      was the worst case: exempt from the ticks-need-a-record rule AND
 *      record-less. Every phase file is now held against its baseline entry,
 *      and a second `roadmap/NN-*.md` sharing a pinned phase number — which
 *      inherited the exemption and was pinned by neither — is rejected.
 *   8. A ref that reads as two different paths. Every check above that matches
 *      a ref as a STRING — the self-citation refusal, the node_modules/.git
 *      scan, the defects/NN- prefix — compared the raw text while path
 *      resolution normalized underneath it, so `…/./phase-14.json` validated
 *      green as a SELF-citation and `defects/14-decoy/../14-ratchet-….md`
 *      borrowed its mandatory phase prefix from a directory the `..` discarded.
 *      Refs must now already be their own normal form; see
 *      `repoPathShapeProblem`. A `defectRef` gets the containment and symlink
 *      rules it never had, having been able to name a file outside the
 *      repository — which the validator then read.
 *   9. A `ci-run` citation whose provenance is nobody's business. It had to
 *      name a run in this repository and nothing more, so any real run in the
 *      history could evidence any criterion at any claimed commit: a
 *      months-old `release-e2e` run passed as phase 01's coverage-gate
 *      evidence. The commit the run ran at and the workflow it belongs to are
 *      now required here and compared against the GitHub API by
 *      `scripts/check-citation-runs.mjs`.
 *  10. A criterion-shaped line the parser cannot see. `* [x]` and `+ [x]` are
 *      task list items to GitHub and invisible here, so one appended inside a
 *      real `## Exit criteria` section rendered as a ticked criterion that
 *      nothing pinned; and the annotation appended after a criterion was
 *      constrained only by its four-character lead, so a waiver clause moved
 *      into it. See `ALT_BULLET_CHECKBOX` and `ANNOTATION_LABELS` — and note
 *      what the latter deliberately does NOT claim.
 *
 * What it CANNOT catch, stated so nobody over-trusts it. A `discharge` can
 * name a real, ticked, unambiguously-quoted criterion that is simply
 * IRRELEVANT to the one it discharges: relevance is a judgement about two
 * sentences' meanings and no hash makes it, which is why
 * `SUPERSEDED-DISCHARGED` is the tick that most needs a human to read both
 * criteria side by side. More generally the baseline pins the WORDS of a
 * criterion, not its meaning, and it says nothing about the roadmap
 * prose around the checkbox. A phase's Test plan, Definition-of-done or Risks
 * section can be rewritten to hollow out a criterion whose sentence is
 * untouched, and a criterion legitimately re-pinned in a later commit is only
 * as honest as the review of that commit. Both are visible only in the roadmap
 * diff, to a human — which is what the wording protocol and per-phase review
 * are for.
 *
 * Deliberately dependency-free (no zod): `meta-checks` runs `npm ci` without
 * `npm run build`, so this must work from source with nothing compiled. The
 * strictness zod's `.strict()` would give is implemented directly — see
 * `checkKeys`.
 */
import { createHash } from "node:crypto";
import {
  existsSync,
  lstatSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  realpathSync,
  statSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** Repo-relative home of the closeout index. Exported so the suite and any future tooling agree on one string. */
export const CLOSEOUT_DIR = "docs/evidence/criteria-closeout";

/**
 * The frozen original-wording manifest. See `scripts/generate-criteria-baseline.mjs`
 * for how it is derived and re-verified against git history.
 */
export const BASELINE_FILE = `${CLOSEOUT_DIR}/criteria-baseline.json`;

/** The seven closeout classes (plan Part 1 §1.3). */
export const CLASSIFICATIONS = [
  "EVIDENCE-EXISTS",
  "EVIDENCE-REPRODUCED",
  "EVIDENCE-NEEDS-CI",
  "EVIDENCE-NEEDS-LIVE",
  "SUPERSEDED-DISCHARGED",
  "WORDING-MISMATCH",
  "UNMET",
];

/**
 * The classes that may carry a tick. The other four all mean "the box stays
 * unticked": `EVIDENCE-NEEDS-CI` and `EVIDENCE-NEEDS-LIVE` are pending runs,
 * `UNMET` is a filed defect.
 */
export const TICKABLE_CLASSIFICATIONS = [
  "EVIDENCE-EXISTS",
  "EVIDENCE-REPRODUCED",
  "SUPERSEDED-DISCHARGED",
  "WORDING-MISMATCH",
];

/**
 * The classifications that may name a `defectRef`, DERIVED as "the ones that
 * may not be ticked" rather than listed.
 *
 * Raised by the phase-10 closeout. `defectRef` was accepted only on `UNMET`, so
 * an `EVIDENCE-NEEDS-LIVE` or `EVIDENCE-NEEDS-CI` criterion could not
 * machine-link the handoff record it had already written — phase 10 wrote
 * `defects/10-plugin-live-smoke-unrun.md` and could only point at it from
 * free-text `notes`. Phases 06 and 19 have the same shape.
 *
 * Widened rather than given a new `handoffRef` key: the file shape is
 * identical, it is checked identically, and a handoff IS a defect record in
 * everything but name — whereas a new key would be a `schemaVersion` change,
 * which belongs with the deferred `quotedAssertion` protocol work, not here.
 *
 * Derived, because the invariant that actually matters is "a criterion carrying
 * a TICK never names one". A hard-coded list would let a future tickable class
 * acquire one by being added to it; this cannot.
 */
export const DEFECT_REF_CLASSIFICATIONS = CLASSIFICATIONS.filter(
  (classification) => !TICKABLE_CLASSIFICATIONS.includes(classification),
);

export const CITATION_KINDS = ["ci-run", "artifact", "test", "journal-export", "discharge"];

/**
 * The kinds whose `ref` is a repository path and must therefore resolve on
 * disk. `journal-export` joined `test`/`artifact` in round 6: an exported
 * journal entry is a committed file like any other, and leaving the kind
 * unresolved made it a free-text forgery channel for no benefit — nothing in
 * the index used it.
 */
export const RESOLVABLE_CITATION_KINDS = ["test", "artifact", "journal-export"];

/**
 * This repository's Actions URL space. A `ci-run` citation cannot be resolved
 * from a checkout, so the least it must do is name a run in THIS repository,
 * in a form a reviewer can paste into a browser.
 *
 * Both `/actions/runs/<id>` and `/actions/jobs/<id>` are in use across the
 * committed records (phase 01 cites jobs directly), as is the
 * `/actions/runs/<id>/job/<id>` form.
 */
const CI_RUN_URL =
  /^https:\/\/github\.com\/WitchyNibbles\/crabgic\/actions\/(?:runs|jobs)\/\d+(?:\/job\/\d+)?$/;

/**
 * The commit a cited run ran at. Abbreviated ids are allowed because merged
 * phase 08 records one (`d11b0594`); `check-citation-runs.mjs` compares it as a
 * prefix of the API's `head_sha`. Seven is git's own floor for an abbreviation.
 */
const CI_RUN_COMMIT = /^[0-9a-f]{7,40}$/;

/**
 * A `ci-run` ref leads with the workflow the run belongs to:
 * `CI / unit-test+coverage (ubuntu-latest), job 91399985018, step "…"`. All 40
 * distinct refs across the eleven merged records already do — `CI / `,
 * `gates-conformance / `, `perf-conformance / ` — and it is what gives
 * `check-citation-runs.mjs` something to compare the API's workflow name
 * against.
 */
const CI_RUN_REF_WORKFLOW = /^([^/\n]+?) \/ \S/;

/**
 * The lead of a `ci-run` ref — everything before its first ` / ` — or
 * `undefined` if it has none. Exported for `check-citation-runs.mjs`.
 */
export function ciRunRefLead(ref) {
  if (typeof ref !== "string") return undefined;
  const match = CI_RUN_REF_WORKFLOW.exec(ref);
  return match === null ? undefined : match[1].trim();
}

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Does a `ci-run` ref name this workflow? `undefined` when the ref has no lead
 * to compare (the offline validator reports that separately).
 *
 * The comparison is on the token IMMEDIATELY before the first ` / `, allowing a
 * labelled prefix in front of it. Sweeping this check over the open closeout
 * PRs before landing it found why that matters: phase 17's criterion 2 cites
 * two runs of the SAME workflow and distinguishes them as
 * `BUILD 1 — CI / unit-test+coverage (…)` and `BUILD 2 — CI / …`. Reading the
 * whole lead as the workflow name failed both — an honest record and a wrong
 * rule. The label may not become a smuggling channel, though: it is the token
 * immediately before the separator that must BE the workflow, so
 * `CI — release-e2e / …` does not pass as a run of `CI`.
 */
export function ciRunRefNamesWorkflow(ref, workflowName) {
  const lead = ciRunRefLead(ref);
  if (lead === undefined) return undefined;
  const wanted = workflowName.trim().toLowerCase();
  const actual = lead.toLowerCase();
  if (actual === wanted) return true;
  return new RegExp(`(?:^|[\\s\\u2013\\u2014:|-])${escapeRegExp(wanted)}$`).test(actual);
}

/**
 * The two load-bearing elements of a `discharge` ref: the roadmap file it
 * discharges against, and the discharged criterion's wording in double quotes.
 *
 * Matched anywhere in the ref rather than as a fixed sentence, because the
 * records in flight write it three different ways — `roadmap/NN-… exit
 * criterion "…" (ticked)`, and `phase 23 exit criterion "…"
 * (roadmap/23-….md:155, ticked), <run details>`. Both carry everything the
 * check needs; insisting on one phrasing would have failed honest records
 * while adding no teeth, since the teeth are entirely in resolving the quote.
 */
/**
 * A discharge quote must be long enough to be a deliberate identification
 * rather than an accident. The three genuine discharges in the corpus quote
 * 128, 155 and 279 characters, so this floor is far below every honest use and
 * far above the one-character quote a reviewer got to pass.
 */
const MIN_DISCHARGE_QUOTE = 40;

const DISCHARGE_ROADMAP_FILE = /roadmap\/\d{2}-[a-z0-9-]+\.md/;
const DISCHARGE_QUOTED_CRITERION = /"([^"]+)"/;

/**
 * The closeout CLAIM-SPACE: this whole directory, not one filename in it.
 *
 * Round-6 finding, and round-8 finding (bypass 21) which generalised it. The
 * refusal matched `phase-NN.json` and that shape ALONE, so a reviewer appended
 * to a ticked criterion — each with wholly forged `quotedAssertion` text — an
 * `artifact` citation of the pass's OWN defect record, an `artifact` citation
 * of this directory's README, and a `journal-export` citation of
 * `criteria-baseline.json`, and the validator passed. No path games were
 * needed; it simply aimed one directory to the side.
 *
 * The principle the old error message already stated covers the whole tree: a
 * defect record, the README and the baseline are all written by the same pass,
 * in the same PR, as the record citing them. Measured before enforcing —
 * across the merged records ZERO of 774 citations resolve into this directory
 * (the one ref mentioning it is a `ci-run` job NAME, not a path), so refusing
 * the claim-space costs nothing and closes the class rather than one shape.
 *
 * Case-insensitive: macOS and Windows checkouts resolve paths without regard
 * to case, so `…/Phase-14.json` opens the record there while reading as an
 * unrelated path to a case-sensitive regex. No honest ref differs from another
 * only by case, so closing it costs nothing.
 */
const CLOSEOUT_CLAIM_SPACE = new RegExp(`^${CLOSEOUT_DIR}/`, "i");
const CLOSEOUT_RECORD_REF = new RegExp(`^${CLOSEOUT_DIR}/phase-\\d{2}\\.json$`, "i");

/** Segments a citation may never name, compared case-insensitively for the same reason. */
const FORBIDDEN_SEGMENTS = new Set(["node_modules", ".git"]);

/**
 * Every repository path a record writes — a `test`/`artifact`/`journal-export`
 * ref, and a `defectRef` — must already BE the plain path, byte for byte.
 *
 * Adversarial-review finding, round 8 (bypass 17a), demonstrated live against
 * the hardened validator. An `artifact` ref of
 * `docs/evidence/criteria-closeout/./phase-14.json:1-5` validated GREEN while
 * the plain form was correctly refused — so a ticked criterion's mandatory ≥1
 * citation could be satisfied by a SELF-citation. The same reviewer passed
 * `defects/14-decoy/../14-ratchet-….md`, borrowing the mandatory `defects/NN-`
 * phase prefix from a decoy directory the `..` then discards.
 *
 * One cause, several victims: every check that reads a ref as a STRING — the
 * self-citation regex, the segment scan, the `defectRef` prefix and location
 * discipline — matched the raw text, while `path.resolve`/`path.join`
 * normalized underneath them.
 *
 * REQUIRING normal form rather than merely normalizing before each check is the
 * deliberate choice. Normalizing alone would silently ACCEPT
 * `defects/14-decoy/../14-ratchet.md` as though the author had written the real
 * path — a laundering channel of its own — and would leave the next
 * string-reading check to be written just as vulnerable. With raw === resolved
 * the whole class is closed rather than its three current instances.
 *
 * @returns {string | undefined} the problem, phrased to follow "<kind> ref <x> "
 */
function repoPathShapeProblem(relPath) {
  if (relPath.includes("\\")) {
    return "contains a backslash — a citation is a POSIX repository path, and `\\` is an ordinary filename character to path resolution while the segment scan reads it as a separator, so the two halves of this check would disagree about what the ref says";
  }
  if (relPath.startsWith("/")) {
    return "is an absolute path, which resolves outside the repository root of any checkout — a citation is a path relative to the repository";
  }
  const normalized = path.posix.normalize(relPath);
  if (normalized !== relPath) {
    return `is not a plain repository path — write ${normalized}. Dot segments defeat every check that reads a ref as a string (the self-citation refusal, the node_modules/.git scan, the defects/NN- prefix) while path resolution silently collapses them, so a ref must already be its own normal form`;
  }
  return undefined;
}

/**
 * `packages/x/y.test.ts:12` / `…:12-18` -> the path plus the line span it
 * claims. The span used to be stripped and thrown away, which is why
 * `server-name.test.ts:9999` validated clean; it is now checked against the
 * file's real length. See `resolveCitationRef`.
 */
function parseCitationRef(ref) {
  const suffix = /:(\d+)(?:-(\d+))?$/.exec(ref);
  if (suffix === null) return { relPath: ref, start: undefined, end: undefined };
  return {
    relPath: ref.slice(0, suffix.index),
    start: Number(suffix[1]),
    end: suffix[2] === undefined ? Number(suffix[1]) : Number(suffix[2]),
  };
}

/** Physical line count. A trailing newline terminates the last line, it does not add one. */
function countLines(contents) {
  const lines = contents.split("\n");
  if (lines.length > 1 && lines[lines.length - 1] === "") lines.pop();
  return lines.length;
}

/**
 * The annotation the closeout format appends after a criterion's preserved
 * wording: `- [x] <original text> — **Evidence (date):** …`. Anything in a
 * checkbox item beyond the recorded text must start with this, or the record
 * is not accounting for the whole criterion.
 *
 * The bold marker is load-bearing, not decoration. With a bare em dash this
 * was bypassable against an UNMODIFIED checkbox: a record could stop at a
 * criterion's OWN internal em dash and the genuine remainder would be read as
 * the annotation. That is not a corner case here — 95 of the roadmap's 211
 * criteria contain an internal em dash, and in this repo's house style the
 * tail after it is very often the evidence-channel clause ("— suite
 * `install.matrix.test`"), which is precisely the part a weakening record
 * would want out of the hash. Requiring `— **` closes it, costs nothing
 * (zero criteria across all phase files contain that sequence), and makes the
 * code match what the error message already promised.
 */
export const ANNOTATION_LEAD = "— **";

/**
 * The labels an annotation's bold head may lead with, keyed by whether the
 * criterion carries a tick.
 *
 * Round-8 finding (bypass 18), demonstrated live and the direct successor of
 * the internal-em-dash bypass `ANNOTATION_LEAD` closed: the whole-checkbox
 * check required only that the tail START with those four characters, so the
 * weakening text moved four characters to the right and
 * `— **Evidence (2026-08-02), WAIVED for all cases except empty dir; the suite
 * is advisory only:** …` validated green.
 *
 * ENUMERATED FROM THE CORPUS, not guessed — all 132 annotated criteria across
 * the 16 merged records plus both open closeout PRs. Adding a form is a
 * deliberate edit here, which is the point, and the suite asserts the
 * enumeration still covers every merged record so drift fails loudly here
 * rather than surprising the next closeout PR. (`Open defect` was added exactly
 * that way: phase 16 merged mid-review carrying it, the rule caught it, and the
 * ENUMERATION was the incomplete thing, not the rule.)
 *
 * THE INVARIANT THAT MAKES THIS BITE is that the two vocabularies are
 * DISJOINT — no label may be legal for both a ticked and an unticked box — so
 * an annotation cannot contradict the box beside it. The suite asserts that
 * too; widening either list without checking it would quietly hollow the rule.
 *
 * Two stronger rules were measured and REJECTED because honest records fail
 * them, and a rule that fails an honest record is the rule being wrong:
 *
 *   - a strict `— **<Label> (<date>):**` shape fails 7 criteria across 5
 *     distinct honest forms (`Left unticked 2026-08-01, defect filed:`,
 *     `UNMET (2026-08-02), channel absent:`, a dated parenthetical, …);
 *   - requiring the annotation's date to equal the record's `pass.date` fails
 *     14 criteria in phases 01 and 11, annotated a day either side of the pass.
 *
 * And see limit 7 in the directory README: this does NOT close the weakening
 * channel. Every honest form in the corpus already exercises each syntactic
 * position the demonstrated waiver uses — a parenthetical inside the label,
 * free text after the date, a trailing clause before the colon — so no
 * syntactic rule on the bold head separates them. What it does close is an
 * unterminated bold span, an unrecognised label, an annotation that contradicts
 * its own tick, and an undated one.
 */
export const ANNOTATION_LABELS = {
  ticked: ["Evidence"],
  unticked: ["Left unticked", "Open defect", "UNMET"],
};

const ANNOTATION_DATE = /\d{4}-\d{2}-\d{2}/;

/**
 * Checks the `— **<head>** <body>` annotation appended after a criterion's
 * pinned wording. `remainder` is the whitespace-normalized tail, already known
 * to start with `ANNOTATION_LEAD`.
 */
function checkAnnotation(errors, where, remainder, criterion, roadmapFile, position) {
  const box = `checkbox ${String(position + 1)} in ${roadmapFile}`;
  const closed = /^— \*\*(.+?)\*\*/s.exec(remainder);
  if (closed === null) {
    errors.push(
      `${where}: ${box}'s annotation opens with "${ANNOTATION_LEAD}" and never reaches a closing \`**\` — an unterminated bold span swallows the rest of the criterion line, so the label cannot be read at all`,
    );
    return;
  }
  const head = closed[1].trim();
  const allowed = criterion.ticked ? ANNOTATION_LABELS.ticked : ANNOTATION_LABELS.unticked;
  if (!allowed.some((label) => head.startsWith(label))) {
    const other = criterion.ticked ? ANNOTATION_LABELS.unticked : ANNOTATION_LABELS.ticked;
    errors.push(
      other.some((label) => head.startsWith(label))
        ? `${where}: ${box} is ${criterion.ticked ? "ticked" : "not ticked"}, but its annotation is labelled ${JSON.stringify(head.slice(0, 40))} — the annotation contradicts the box beside it`
        : `${where}: ${box}'s annotation is labelled ${JSON.stringify(head.slice(0, 40))}, which is not one of ${allowed.map((label) => `"${label}"`).join(" or ")}. The label is what a reader skims; a new one is a deliberate edit to ANNOTATION_LABELS, not a free choice.`,
    );
    return;
  }
  if (!ANNOTATION_DATE.test(head)) {
    errors.push(
      `${where}: ${box}'s annotation carries no YYYY-MM-DD date — an annotation nobody can date cannot be held against the pass that wrote it`,
    );
  }
}

/**
 * A checkbox item's criterion wording, with any closeout annotation removed —
 * `<criterion> — **Evidence (date):** …` -> `<criterion>`. This is the text the
 * baseline pins, so it is what both the record path and the record-less
 * phase-file audit must hash.
 */
function criterionWording(boxText) {
  const lead = boxText.indexOf(ANNOTATION_LEAD);
  return lead < 0 ? boxText : boxText.slice(0, lead);
}

const TOP_LEVEL_KEYS = { required: ["schemaVersion", "phase", "roadmapFile", "pass", "criteria"] };
const PASS_KEYS = { required: ["date", "agent", "headSha"] };
const CRITERION_KEYS = {
  required: ["index", "text", "textSha256", "classification", "ticked", "citations"],
  optional: ["wordingCorrection", "defectRef", "notes"],
};
const CITATION_KEYS = {
  required: ["kind", "ref"],
  optional: ["url", "commit", "quotedAssertion"],
};
const WORDING_KEYS = { required: ["before", "after"] };

const isPlainObject = (value) =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const isNonEmptyString = (value) => typeof value === "string" && value.trim().length > 0;
const sha256 = (value) => createHash("sha256").update(value, "utf8").digest("hex");

/**
 * The `.strict()` equivalent: reports both missing required keys and keys
 * nobody declared. The second half is the load-bearing one — a typo'd
 * `citation` for `citations` would otherwise be dropped and the record would
 * validate having recorded nothing.
 */
function checkKeys(errors, where, value, spec) {
  if (!isPlainObject(value)) {
    errors.push(`${where}: expected an object`);
    return false;
  }
  const allowed = new Set([...spec.required, ...(spec.optional ?? [])]);
  for (const key of spec.required) {
    if (!(key in value)) errors.push(`${where}: missing required key "${key}"`);
  }
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) errors.push(`${where}: unknown key "${key}"`);
  }
  return true;
}

/**
 * Blanks the contents of fenced code blocks, keeping the line count intact.
 *
 * Adversarial-review finding, round 5: the heading match was not fence-aware,
 * so a `## Exit criteria` line inside a ``` block could be picked up as the
 * section start and the illustrative checkbox lines under it read as real
 * criteria. Phase files legitimately contain fenced markdown examples, so this
 * has to be handled rather than banned.
 */
function blankFencedBlocks(markdown) {
  let openFence;
  return markdown
    .split("\n")
    .map((line) => {
      const fence = /^\s{0,3}(`{3,}|~{3,})/.exec(line);
      if (openFence === undefined) {
        if (fence === null) return line;
        openFence = fence[1];
        return "";
      }
      if (fence !== null && fence[1][0] === openFence[0] && fence[1].length >= openFence.length) {
        openFence = undefined;
      }
      return "";
    })
    .join("\n");
}

const EXIT_CRITERIA_HEADING = /^##\s+Exit criteria\s*$/;
const CHECKBOX_ITEM = /^\s*-\s+\[([ xX])\]\s?(.*)$/;

/**
 * A task list item written with a bullet this parser does NOT read.
 *
 * Round-8 finding (bypass 20), found by this pass and demonstrated end-to-end:
 * GitHub-Flavored Markdown renders `* [x]` and `+ [x]` as task list items
 * exactly like `- [x]`, and `CHECKBOX_ITEM` matched neither. Nor did anything
 * else — the stray scan uses the same regex, and the continuation branch needs
 * leading whitespace — so such a line was simply INVISIBLE. Appending
 * `* [x] <fabricated criterion>` inside `roadmap/12`'s real `## Exit criteria`
 * section, a phase that HAS a closeout record, left both
 * `check-criteria-closeout` and `generate-criteria-baseline --check` reporting
 * PASS while github.com rendered a ticked criterion nothing pinned, nothing
 * recorded and no count noticed.
 *
 * Rejected rather than absorbed, on the reasoning the nested-sub-bullet ruling
 * already sets out: absorbing would silently move a baseline hash the first
 * time somebody reached for a different bullet. Zero of the roadmap's 211
 * criteria use one.
 */
const ALT_BULLET_CHECKBOX = /^\s*[*+]\s+\[[ xX]\]/;

/**
 * Splits a phase file's `## Exit criteria` section into one entry per
 * checkbox item, joining wrapped continuation lines and collapsing runs of
 * whitespace so a hard-wrapped criterion compares equal to its one-line
 * source.
 *
 * @returns {{ items: {checked: boolean, text: string}[] | undefined, problems: string[] }}
 *   `items` is undefined when the section is missing OR when the file's
 *   structure cannot be trusted — the caller must not fall back to "no section
 *   found, carry on".
 *
 * THE SECTION MUST BE UNIQUE, and that is the load-bearing part. This used to
 * be `split(/^## Exit criteria$/m)[1]`, which reads only the FIRST such
 * section. A reviewer inserted a decoy section earlier in the phase file,
 * mirroring the record exactly, and then fraudulently ticked and wholly
 * rewrote the REAL section's `UNMET` criterion — the validator reported zero
 * errors. Every other defense in this file (the baseline manifest, the wording
 * pin, tick discipline, the two-way cross-check) is downstream of this parse,
 * so all of them were bypassed at once by one duplicated heading. A decoy
 * placed AFTER the real section is the same attack mirrored, and a
 * criterion-shaped line outside the section is its weaker cousin; both are
 * rejected too.
 */
export function parseExitCriteriaCheckboxes(markdown) {
  const problems = [];
  const lines = blankFencedBlocks(markdown).split("\n");

  // Checked over the WHOLE file, and before the section is even located: an
  // alt-bullet task list item is invisible to every other check here, so it is
  // as dangerous above the section as inside it.
  const altBullets = [];
  lines.forEach((line, index) => {
    if (ALT_BULLET_CHECKBOX.test(line)) altBullets.push(index + 1);
  });
  if (altBullets.length > 0) {
    problems.push(
      `has ${String(altBullets.length)} task list item(s) written with a \`*\` or \`+\` bullet (line(s) ${altBullets.map(String).join(", ")}) — GitHub renders those as ticked criteria exactly like \`- [x]\`, but this parser reads only the \`-\` bullet, so such a line is invisible to the hash pin, the counts, the tick cross-check and the stray scan alike. Write every exit criterion with \`- [ ]\` / \`- [x]\`.`,
    );
    return { items: undefined, problems };
  }

  const headings = [];
  lines.forEach((line, index) => {
    if (EXIT_CRITERIA_HEADING.test(line)) headings.push(index);
  });
  if (headings.length === 0) return { items: undefined, problems };
  if (headings.length > 1) {
    problems.push(
      `has ${String(headings.length)} "## Exit criteria" headings (lines ${headings.map((i) => String(i + 1)).join(", ")}); exactly one is allowed — a duplicate section is a decoy that this parser would read INSTEAD of the real one, which silently bypasses every other check in this validator`,
    );
    return { items: undefined, problems };
  }

  const start = headings[0] + 1;
  let end = lines.length;
  for (let index = start; index < lines.length; index += 1) {
    if (/^##\s+/.test(lines[index])) {
      end = index;
      break;
    }
  }

  const items = [];
  const nestedBullets = [];
  lines.slice(start, end).forEach((rawLine, offset) => {
    const checkbox = CHECKBOX_ITEM.exec(rawLine);
    if (checkbox !== null) {
      items.push({ checked: checkbox[1].toLowerCase() === "x", text: checkbox[2] });
      return;
    }
    // Round-6 finding: continuation required NOT matching `/^\s*-\s/`, which a
    // nested bullet DOES match, so an indented sub-bullet inside a criterion
    // was silently dropped — "- EXCEPT stop conditions 3-7, which are waived
    // for this phase" was invisible to the sha256 pin and the `— **` remainder
    // check alike. Rejected rather than folded into the item's text: folding
    // would silently move a criterion's baseline hash the first time somebody
    // added a legitimate sub-bullet. Zero of the roadmap's 211 criteria carry
    // one, so requiring the decision to be explicit costs nothing.
    if (items.length > 0 && /^\s+-\s/.test(rawLine)) {
      nestedBullets.push(start + offset + 1);
      return;
    }
    // A continuation line belongs to the item above it: indented, non-blank,
    // and not the start of a new list item.
    if (items.length > 0 && /^\s+\S/.test(rawLine) && !/^\s*-\s/.test(rawLine)) {
      items[items.length - 1].text += ` ${rawLine.trim()}`;
    }
  });
  if (nestedBullets.length > 0) {
    problems.push(
      `has ${String(nestedBullets.length)} nested sub-bullet(s) inside an exit criterion (line(s) ${nestedBullets.map(String).join(", ")}) — a sub-bullet is dropped by this parser, so it can carry arbitrary weakening text past both the hash pin and the annotation check; fold it into the criterion's own sentence instead`,
    );
    return { items: undefined, problems };
  }

  const strays = [];
  lines.forEach((line, index) => {
    if ((index < start || index >= end) && CHECKBOX_ITEM.test(line)) strays.push(index + 1);
  });
  if (strays.length > 0) {
    problems.push(
      `has ${String(strays.length)} checkbox item(s) outside its "## Exit criteria" section (line(s) ${strays.map(String).join(", ")}) — a criterion-shaped line elsewhere in the file is either a decoy or a criterion nobody is recording`,
    );
    return { items: undefined, problems };
  }

  return {
    items: items.map((item) => ({
      checked: item.checked,
      text: normalizeCriterionText(item.text),
    })),
    problems,
  };
}

/**
 * The one whitespace normalization every wording comparison in this pass uses.
 * `parseExitCriteriaCheckboxes` already collapses runs of whitespace when it
 * joins a hard-wrapped criterion's continuation lines, so re-wrapping a
 * criterion in the phase file must not read as a wording change — here, in the
 * roadmap cross-check, or in the baseline lookup.
 */
export const normalizeCriterionText = (value) => value.replace(/\s+/g, " ").trim();
const normalize = normalizeCriterionText;

/**
 * The two checks that are about WHAT a repo-relative path names, rather than
 * whether it resolves. Separated out because they must run TWICE — once on the
 * cited ref and once on the repo-relative realpath it opens, which bypass 19
 * showed are not the same string.
 *
 * Round-6 findings, both: a record cited ITSELF as its own `artifact` evidence
 * and resolved fine (a closeout record is a real committed file), and
 * `node_modules/vitest/package.json:3` validated — every CI job runs `npm ci`
 * before this check, so `node_modules` always exists while being precisely NOT
 * content this repository carries.
 *
 * @returns {string | undefined} the problem, phrased to follow "<kind> ref <x> "
 */
function forbiddenContentProblem(relPath, ownRoadmapFile) {
  if (CLOSEOUT_RECORD_REF.test(relPath)) {
    return "is a closeout record — a record is the claim, never the evidence for it";
  }
  if (CLOSEOUT_CLAIM_SPACE.test(relPath)) {
    return `is inside the closeout claim-space ${CLOSEOUT_DIR}/ — a record is the claim, never the evidence for it, and neither is anything filed beside it. A defect record, this directory's README and the frozen baseline are all written by the same pass, in the same PR, as the record that would be citing them.`;
  }
  // Round-8 finding (bypass 22), the sharpest form of the same family: a ticked
  // criterion's ONLY citations were its own phase file's checkbox ANNOTATION
  // and that pass's own defect record, so the mandatory ≥1 citation was
  // satisfied entirely by text the pass wrote in the same commit. Canonicality
  // does not reach this — it hardens how a ref is MATCHED, not which targets
  // are refused. Scoped to the record's OWN phase file: phase 17 legitimately
  // cites `roadmap/19-…` across phases, and zero merged records cite their own.
  if (
    typeof ownRoadmapFile === "string" &&
    relPath.toLowerCase() === ownRoadmapFile.toLowerCase()
  ) {
    return `is this record's own phase file — a criterion cannot be evidenced by the phase file it lives in, whose annotation this very pass appended. Citing ANOTHER phase's roadmap file is fine.`;
  }
  if (relPath.split(/[\\/]/).some((segment) => FORBIDDEN_SEGMENTS.has(segment.toLowerCase()))) {
    return "is not content the repository carries — node_modules/ is installed by every CI job and .git/ is not source";
  }
  return undefined;
}

/** `realpathSync` that degrades to the given path rather than throwing. */
function realpathOr(target) {
  try {
    return realpathSync(target);
  } catch {
    return target;
  }
}

/**
 * Resolves one `test`/`artifact` citation to a regular file inside the repo,
 * and checks the line span it names actually exists in that file.
 *
 * The symlink half is an adversarial-review finding, round 4, reported
 * independently by two reviewers: `existsSync` and `statSync` both FOLLOW
 * symlinks while `path.resolve` never dereferences, so a committed
 * `docs/evidence/phase-05/evil.txt -> /etc/hostname` passed every part of the
 * old check — the containment test compared the undereferenced path and the
 * stat calls reported a regular file at the far end. Two defenses, because
 * they catch different things: `lstat` catches a symlink cited directly, and
 * the realpath containment re-check catches one in a PARENT directory.
 *
 * The line half is the other round-4 finding: the `:line` suffix was stripped
 * and discarded, so `server-name.test.ts:9999` validated clean. The pilot's
 * rebase slid five of its own line citations and none were catchable, because
 * the files still existed.
 */
function resolveCitationRef(errors, cwhere, citation, repoRoot, ownRoadmapFile) {
  const { relPath: rawPath, start, end } = parseCitationRef(citation.ref);

  // Round-8 finding (bypass 17a). Reported, and then the NORMALIZED path is
  // what every check below sees — so the record's author is told to write the
  // plain path, and meanwhile the dot-segment form cannot slip past the
  // string-matching checks while resolution collapses it.
  const shapeProblem = repoPathShapeProblem(rawPath);
  if (shapeProblem !== undefined) {
    errors.push(`${cwhere}: ${citation.kind} ref ${rawPath} ${shapeProblem}`);
  }
  const relPath = shapeProblem === undefined ? rawPath : path.posix.normalize(rawPath);

  // Checked on the ref's shape, before resolution, so both hold for a path that
  // does not exist yet — and re-checked below on what the path really OPENS.
  const contentProblem = forbiddenContentProblem(relPath, ownRoadmapFile);
  if (contentProblem !== undefined) {
    errors.push(`${cwhere}: ${citation.kind} ref ${relPath} ${contentProblem}`);
    return;
  }

  const abs = path.resolve(repoRoot, relPath);
  const rootPrefix = path.resolve(repoRoot) + path.sep;

  if (!abs.startsWith(rootPrefix)) {
    // A citation is a repository path. An absolute path or a `..` escape names
    // something no reviewer of this repo can resolve.
    errors.push(`${cwhere}: ${citation.kind} ref ${relPath} resolves outside the repository root`);
    return;
  }
  if (!existsSync(abs)) {
    errors.push(`${cwhere}: ${citation.kind} ref ${relPath} does not exist in the repository`);
    return;
  }
  if (lstatSync(abs).isSymbolicLink()) {
    errors.push(
      `${cwhere}: ${citation.kind} ref ${relPath} is a symlink (-> ${readlinkSync(abs)}), not a committed regular file — a citation must name content this repository actually carries`,
    );
    return;
  }
  const realRoot = realpathOr(path.resolve(repoRoot));
  const real = realpathOr(abs);
  if (real !== abs && !real.startsWith(realRoot + path.sep)) {
    errors.push(
      `${cwhere}: ${citation.kind} ref ${relPath} resolves outside the repository root, through a symlinked parent directory (-> ${real})`,
    );
    return;
  }
  // Round-8 finding (bypass 19). The two content checks above ran on the CITED
  // ref only, while the containment check accepts any target inside the
  // repository root — and `node_modules/` and `.git/` ARE inside it. So a
  // committed `docs/evidence/nmlink -> ../../node_modules`, cited as
  // `docs/evidence/nmlink/vitest/package.json:3`, passed everything: the final
  // component is a regular file so the direct-symlink check never fired, and
  // the parent-realpath check only rejects escapes OUTSIDE the root. Same
  // family as the dot segments — the check ran on the wrong string — so they
  // are re-run on what the path actually opens.
  const throughLink = path.relative(realRoot, real).split(path.sep).join("/");
  if (throughLink !== relPath) {
    const launderedProblem = forbiddenContentProblem(throughLink, ownRoadmapFile);
    if (launderedProblem !== undefined) {
      errors.push(
        `${cwhere}: ${citation.kind} ref ${relPath} resolves through a symlink to ${throughLink}, which ${launderedProblem}`,
      );
      return;
    }
  }
  if (!statSync(abs).isFile()) {
    // A directory ref resolves but cites nothing in particular.
    errors.push(`${cwhere}: ${citation.kind} ref ${relPath} is not a file`);
    return;
  }
  if (start === undefined) return;

  const lineCount = countLines(readFileSync(abs, "utf8"));
  if (start < 1) {
    errors.push(
      `${cwhere}: ${citation.kind} ref ${citation.ref} names line ${String(start)}; files are 1-based`,
    );
  } else if (end < start) {
    errors.push(`${cwhere}: ${citation.kind} ref ${citation.ref} is an inverted line range`);
  } else if (end > lineCount) {
    errors.push(
      `${cwhere}: ${citation.kind} ref ${citation.ref} names line ${String(end)}, but ${relPath} has ${String(lineCount)} lines — the citation is stale. Re-resolve every line citation against the tree you are merging into, immediately before you push.`,
    );
  }
}

/**
 * A `ci-run` citation cannot be resolved from a checkout — the run lives in
 * GitHub Actions. What CAN be required offline is that it names a run in THIS
 * repository, in a form a reviewer can open, and that it carries the quoted
 * log line that outlives the run's own log retention.
 *
 * Round-6 finding, and the most serious of the whole effort: `ci-run` refs were
 * checked for nothing at all, so a WHOLLY FORGED closeout passed everything —
 * a reviewer generated `phase-13.json` from the real checkbox texts (so every
 * baseline hash matched), cited each criterion with `job 00000000000` /
 * `runs/1`, and got a green validator, a green baseline `--check` and green CI.
 *
 * This is a shape check, and a shape check alone does not make a run real.
 * `scripts/check-citation-runs.mjs` is the half that does, resolving each URL
 * against the GitHub API in the `meta-checks` job where a token exists.
 *
 * Round-8 finding (bypass 17b), the higher-value of that pair and demonstrated
 * live: a cited run's PROVENANCE was entirely unverified. A reviewer repointed
 * phase 01's criterion 1 at run 30250453824 — a months-old `release-e2e` run,
 * wrong workflow, wrong commit, predating the criterion — set `commit` to the
 * null object id and fabricated the `quotedAssertion`. This function returned
 * nothing, and `check-citation-runs.mjs` would also have passed: it 404-checks
 * existence, and NOTHING anywhere read `commit`. So any real run in this
 * repository's history could stand as evidence for any criterion at any claimed
 * commit. The two fields that pin a run to a criterion — the commit it ran at
 * and the workflow it belongs to — are now required here and compared against
 * the API there.
 */
function checkCiRunCitation(errors, cwhere, citation) {
  if (!isNonEmptyString(citation.url)) {
    errors.push(
      `${cwhere}: a ci-run citation must carry the run's url — the ref alone names a job number nobody can resolve`,
    );
    return;
  }
  if (!CI_RUN_URL.test(citation.url)) {
    errors.push(
      `${cwhere}: ci-run url ${citation.url} is not a WitchyNibbles/crabgic actions/runs (or actions/jobs) URL`,
    );
  }
  if (!isNonEmptyString(citation.quotedAssertion)) {
    errors.push(
      `${cwhere}: a ci-run citation must carry a quotedAssertion — workflow logs and artifacts expire, so the quoted line IS the durable evidence`,
    );
  }
  if (!isNonEmptyString(citation.commit)) {
    errors.push(
      `${cwhere}: a ci-run citation must carry the commit the run ran at — without it the citation names a run but not the tree that run exercised, so any real run in this repository's Actions history stands as evidence for any criterion. scripts/check-citation-runs.mjs holds it against the run's head_sha.`,
    );
  } else if (!CI_RUN_COMMIT.test(citation.commit)) {
    errors.push(
      `${cwhere}: ci-run commit ${JSON.stringify(citation.commit)} is not a 7-to-40 character lowercase hex object id`,
    );
  } else if (/^0+$/.test(citation.commit)) {
    errors.push(
      `${cwhere}: ci-run commit ${citation.commit} is the null object id — no run ever ran at it, and it is what the live demonstration of this bypass used`,
    );
  }
  if (ciRunRefLead(citation.ref) === undefined) {
    errors.push(
      `${cwhere}: a ci-run ref must lead with the workflow the run belongs to — \`<workflow> / <job>, job <id>, step "…"\`, e.g. \`CI / unit-test+coverage (ubuntu-latest), job 91399985018\`. Without it nothing can compare the cited workflow against the run the url resolves to.`,
    );
  }
}

/**
 * A `discharge` citation says "another phase's closed criterion already covers
 * this one". That is fully checkable offline, and it was checked for nothing:
 * a phase-09 reviewer discharged a tick against a COMPLETELY FABRICATED
 * phase-23 criterion and it passed. The named file must exist, the quoted
 * wording must really be one of its criteria, and that criterion must actually
 * be TICKED — an unticked one has discharged nothing.
 */
function checkDischargeCitation(errors, cwhere, citation, repoRoot, ownRoadmapFile) {
  const file = DISCHARGE_ROADMAP_FILE.exec(citation.ref);
  const quotedMatch = DISCHARGE_QUOTED_CRITERION.exec(citation.ref);
  if (file === null || quotedMatch === null) {
    errors.push(
      `${cwhere}: a discharge ref must name the roadmap file it discharges against (roadmap/NN-<slug>.md) AND quote that closed criterion's wording in "double quotes" — e.g. \`roadmap/23-release-hardening.md exit criterion "<verbatim wording>" (ticked)\``,
    );
    return;
  }
  const roadmapFile = file[0];
  const quoted = quotedMatch[1];

  // Round-7 findings. `startsWith` with no floor, no uniqueness test and no
  // self-exclusion meant the real teeth were "some roadmap file contains some
  // ticked box": quoting "A" passed, so did discharging against an unrelated
  // phase, so did a phase discharging against ITSELF.
  if (roadmapFile === ownRoadmapFile) {
    errors.push(
      `${cwhere}: this discharges against its own phase file ${roadmapFile} — a criterion cannot be discharged by its own phase`,
    );
    return;
  }
  if (normalize(quoted).length < MIN_DISCHARGE_QUOTE) {
    errors.push(
      `${cwhere}: the discharged criterion's quoted wording is too short (${String(normalize(quoted).length)} chars, minimum ${String(MIN_DISCHARGE_QUOTE)}) to identify a criterion`,
    );
    return;
  }

  const abs = path.resolve(repoRoot, roadmapFile);
  if (!abs.startsWith(path.resolve(repoRoot) + path.sep) || !existsSync(abs)) {
    errors.push(`${cwhere}: discharge ref names ${roadmapFile}, which does not exist`);
    return;
  }
  const { items, problems } = parseExitCriteriaCheckboxes(readFileSync(abs, "utf8"));
  if (items === undefined) {
    errors.push(
      `${cwhere}: discharge ref names ${roadmapFile}, whose exit criteria cannot be read${problems.length > 0 ? ` — ${problems[0]}` : ""}`,
    );
    return;
  }
  const wanted = normalize(quoted);
  const matches = items.filter((box) => normalize(criterionWording(box.text)).startsWith(wanted));
  if (matches.length === 0) {
    errors.push(
      `${cwhere}: ${roadmapFile} has no criterion beginning ${JSON.stringify(quoted.slice(0, 60))} — a discharge cannot cite a criterion that does not exist`,
    );
    return;
  }
  if (matches.length > 1) {
    errors.push(
      `${cwhere}: the quoted wording does not identify a single criterion in ${roadmapFile} — it matches ${String(matches.length)}. Quote enough of the criterion to name exactly one.`,
    );
    return;
  }
  const [match] = matches;
  if (!match.checked) {
    errors.push(
      `${cwhere}: the criterion this discharges against is not ticked in ${roadmapFile}, so it has discharged nothing`,
    );
  }
}

/**
 * Loads the frozen original-wording manifest. Fails closed: a record cannot be
 * validated without it, because the manifest is the only anchor that lives
 * outside the commit under review.
 *
 * @returns {{ baseline?: object, errors: string[] }}
 */
export function loadCriteriaBaseline(repoRoot) {
  const abs = path.join(repoRoot, BASELINE_FILE);
  if (!existsSync(abs)) {
    return {
      errors: [
        `${BASELINE_FILE} is missing — it is the frozen record of what each criterion said before its closeout, and the only check that can see a criterion and its record rewritten together. No closeout record can be validated without it.`,
      ],
    };
  }
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(abs, "utf8"));
  } catch (cause) {
    return { errors: [`${BASELINE_FILE}: not parseable JSON — ${String(cause)}`] };
  }
  if (!isPlainObject(parsed) || !isPlainObject(parsed.phases)) {
    return { errors: [`${BASELINE_FILE}: expected an object carrying a "phases" map`] };
  }
  return { baseline: parsed, errors: [] };
}

/** Consecutive `> …` lines, joined per block. Used to find a defect record's verbatim criterion quote. */
function markdownBlockquotes(markdown) {
  const quotes = [];
  let current;
  for (const line of markdown.split("\n")) {
    const quoted = /^[ \t]{0,3}>[ \t]?(.*)$/.exec(line);
    if (quoted !== null) {
      current = current === undefined ? quoted[1] : `${current} ${quoted[1]}`;
    } else if (current !== undefined) {
      quotes.push(current);
      current = undefined;
    }
  }
  if (current !== undefined) quotes.push(current);
  return quotes;
}

const DEFECT_SEVERITY = /^[ \t]*(?:#{1,6}[ \t]*severity\b|\*\*severity\b)/im;
const DEFECT_REMEDY = /^[ \t]*#{1,6}[ \t]*(?:proposed[ \t]+)?remedy\b/im;
const DEFECT_SIZING = /\b(?:effort|sizing|size)\b[^\n]{0,40}?\*{0,2}\b(?:XS|XL|S|M|L)\b/i;

/**
 * A defect record has to be a defect record.
 *
 * Adversarial-review finding, round 4: `defectRef` was only required to EXIST.
 * A reviewer truncated a real one to zero bytes and the check stayed green, so
 * "an honest partial close files a defect" could be satisfied by an empty
 * file — precisely the aspirational bookkeeping this pass refuses everywhere
 * else. The load-bearing element is the verbatim criterion quote: severity,
 * remedy and sizing headings can be pasted from a template, but the quote ties
 * THIS file to THIS box, and it is checked against the record's own pinned
 * text (which the baseline in turn pins to the original wording).
 */
function checkDefectRecordShape(errors, where, abs, relPath, criterionText) {
  const contents = readFileSync(abs, "utf8");
  if (contents.trim().length === 0) {
    errors.push(
      `${where}: defect record ${relPath} is empty — "defect filed" is not satisfied by a file with nothing in it`,
    );
    return;
  }
  if (!markdownBlockquotes(contents).map(normalize).includes(normalize(criterionText))) {
    errors.push(
      `${where}: defect record ${relPath} does not quote the criterion verbatim in a blockquote ("**Criterion (verbatim):**" then "> …"); that quote is what binds the record to this box instead of to a template`,
    );
  }
  if (!DEFECT_SEVERITY.test(contents)) {
    errors.push(`${where}: defect record ${relPath} states no **Severity:**`);
  }
  if (!DEFECT_REMEDY.test(contents)) {
    errors.push(`${where}: defect record ${relPath} has no "## Proposed remedy" section`);
  } else if (!DEFECT_SIZING.test(contents)) {
    errors.push(
      `${where}: defect record ${relPath}'s remedy carries no S/M/L effort sizing — a defect nobody has sized is not ticket-ready`,
    );
  }
}

/**
 * Validates one closeout record.
 *
 * @param {unknown} record parsed JSON
 * @param {{ repoRoot: string, fileName: string, baseline?: object | null }} ctx
 *   `baseline` omitted means "load it here"; `null` means "unavailable and
 *   already reported by the caller", which is how `validateAllCloseoutRecords`
 *   avoids repeating one missing-manifest error per record.
 * @returns {string[]} every problem found (empty means valid)
 */
export function validateCloseoutRecord(record, ctx) {
  const errors = [];
  const { repoRoot, fileName } = ctx;

  let baseline = ctx.baseline;
  if (baseline === undefined) {
    const loaded = loadCriteriaBaseline(repoRoot);
    errors.push(...loaded.errors);
    baseline = loaded.baseline ?? null;
  }

  if (!checkKeys(errors, fileName, record, TOP_LEVEL_KEYS)) return errors;

  if (record.schemaVersion !== 1) {
    errors.push(
      `${fileName}: schemaVersion must be 1, got ${JSON.stringify(record.schemaVersion)}`,
    );
  }

  if (typeof record.phase !== "string" || !/^\d{2}$/.test(record.phase)) {
    errors.push(
      `${fileName}: phase must be a two-digit string, got ${JSON.stringify(record.phase)}`,
    );
    return errors;
  }
  const expectedFileName = `phase-${record.phase}.json`;
  if (fileName !== expectedFileName) {
    errors.push(`${fileName}: phase "${record.phase}" requires the filename ${expectedFileName}`);
  }

  if (
    typeof record.roadmapFile !== "string" ||
    !new RegExp(`^roadmap/${record.phase}-[a-z0-9-]+\\.md$`).test(record.roadmapFile)
  ) {
    errors.push(
      `${fileName}: roadmapFile must be roadmap/${record.phase}-<slug>.md, got ${JSON.stringify(record.roadmapFile)}`,
    );
    return errors;
  }

  if (checkKeys(errors, `${fileName} pass`, record.pass, PASS_KEYS)) {
    if (typeof record.pass.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(record.pass.date)) {
      errors.push(
        `${fileName} pass: date must be YYYY-MM-DD, got ${JSON.stringify(record.pass.date)}`,
      );
    }
    if (!isNonEmptyString(record.pass.agent)) {
      errors.push(`${fileName} pass: agent must be a non-empty string`);
    }
    if (typeof record.pass.headSha !== "string" || !/^[0-9a-f]{40}$/.test(record.pass.headSha)) {
      errors.push(`${fileName} pass: headSha must be a full 40-character lowercase object ID`);
    }
  }

  if (!Array.isArray(record.criteria) || record.criteria.length === 0) {
    errors.push(`${fileName}: criteria must be a non-empty array`);
    return errors;
  }

  // The frozen original wordings for this phase. Unlike every other check in
  // this function, they do NOT come from the tree under review, which is the
  // entire point: co-editing a checkbox and its record cannot move them.
  let frozenCriteria;
  if (baseline !== null) {
    const entry = baseline.phases[record.phase];
    if (!isPlainObject(entry) || !Array.isArray(entry.criteria)) {
      errors.push(
        `${fileName}: phase ${record.phase} has no entry in the frozen baseline ${BASELINE_FILE}. A phase cannot be closed before its original wordings are pinned — run scripts/generate-criteria-baseline.mjs.`,
      );
    } else {
      frozenCriteria = entry.criteria;
      if (frozenCriteria.length !== record.criteria.length) {
        errors.push(
          `${fileName}: ${String(record.criteria.length)} criteria recorded but the frozen baseline pins ${String(frozenCriteria.length)} for phase ${record.phase} — criteria were added to or removed from ${record.roadmapFile} after the baseline was taken`,
        );
      }
    }
  }

  const roadmapPath = path.join(repoRoot, record.roadmapFile);
  let checkboxes;
  if (!existsSync(roadmapPath)) {
    errors.push(`${fileName}: roadmapFile ${record.roadmapFile} does not exist`);
  } else {
    const parsed = parseExitCriteriaCheckboxes(readFileSync(roadmapPath, "utf8"));
    for (const problem of parsed.problems) {
      errors.push(`${fileName}: ${record.roadmapFile} ${problem}`);
    }
    checkboxes = parsed.items;
    if (checkboxes === undefined) {
      if (parsed.problems.length === 0) {
        errors.push(`${fileName}: ${record.roadmapFile} has no "## Exit criteria" section`);
      }
    } else if (checkboxes.length !== record.criteria.length) {
      errors.push(
        `${fileName}: ${String(record.criteria.length)} criteria recorded but ${String(checkboxes.length)} checkbox items in ${record.roadmapFile}`,
      );
      checkboxes = undefined;
    }
  }

  record.criteria.forEach((criterion, position) => {
    const where = `${fileName} criteria[${String(position)}]`;
    if (!checkKeys(errors, where, criterion, CRITERION_KEYS)) return;

    if (criterion.index !== position + 1) {
      errors.push(
        `${where}: index must be ${String(position + 1)} (contiguous, 1-based, file order)`,
      );
    }
    if (!isNonEmptyString(criterion.text)) {
      errors.push(`${where}: text must be the criterion's verbatim, non-empty wording`);
      return;
    }
    if (criterion.textSha256 !== sha256(criterion.text)) {
      errors.push(`${where}: textSha256 does not hash the recorded text`);
    }

    // The out-of-commit anchor. Every other wording check compares the record
    // against the phase file in the same commit, so rewriting both together is
    // self-consistent — a reviewer demonstrated exactly that on phase 03's
    // criterion 2. This one compares against wording frozen before the closeout
    // existed, re-derivable from git history by the baseline generator.
    if (frozenCriteria !== undefined) {
      const frozen = frozenCriteria[position];
      if (frozen === undefined) {
        errors.push(
          `${where}: the frozen baseline ${BASELINE_FILE} pins no criterion ${String(position + 1)} for phase ${record.phase}`,
        );
      } else if (frozen !== sha256(normalize(criterion.text))) {
        errors.push(
          `${where}: recorded text does not hash to the frozen original wording in ${BASELINE_FILE} (phase ${record.phase}, criterion ${String(position + 1)}). The wording protocol preserves a criterion verbatim and appends its annotation, so the checkbox itself must have been rewritten — which the roadmap cross-check cannot see, because it compares against that same rewritten file. Legitimate scope changes re-pin the phase's baseline in their own commit (scripts/generate-criteria-baseline.mjs --write), where the roadmap diff is the review.`,
        );
      }
    }

    if (!CLASSIFICATIONS.includes(criterion.classification)) {
      errors.push(
        `${where}: classification ${JSON.stringify(criterion.classification)} is not one of ${CLASSIFICATIONS.join(", ")}`,
      );
      return;
    }
    if (typeof criterion.ticked !== "boolean") {
      errors.push(`${where}: ticked must be a boolean`);
      return;
    }

    const tickable = TICKABLE_CLASSIFICATIONS.includes(criterion.classification);
    if (criterion.ticked !== tickable) {
      errors.push(
        tickable
          ? `${where}: classification ${criterion.classification} is evidenced, so ticked must be true`
          : `${where}: classification ${criterion.classification} may never be ticked`,
      );
    }

    if (!Array.isArray(criterion.citations)) {
      errors.push(`${where}: citations must be an array`);
    } else {
      if (criterion.ticked && criterion.citations.length === 0) {
        errors.push(`${where}: a ticked criterion needs at least one citation`);
      }
      criterion.citations.forEach((citation, ci) => {
        const cwhere = `${where}.citations[${String(ci)}]`;
        if (!checkKeys(errors, cwhere, citation, CITATION_KEYS)) return;
        if (!CITATION_KINDS.includes(citation.kind)) {
          errors.push(
            `${cwhere}: kind ${JSON.stringify(citation.kind)} is not one of ${CITATION_KINDS.join(", ")}`,
          );
        }
        if (!isNonEmptyString(citation.ref)) {
          errors.push(`${cwhere}: ref must be a non-empty string`);
        } else if (RESOLVABLE_CITATION_KINDS.includes(citation.kind)) {
          // Adversarial-review finding: nothing resolved a citation, so a
          // fabricated ref validated. This pass's own phase-12 defect exists
          // BECAUSE a cited test file was deleted and nothing noticed.
          resolveCitationRef(errors, cwhere, citation, repoRoot, record.roadmapFile);
          // Line numbers drift and files move; the quoted text is the citation
          // that survives. All 466 test/artifact citations across the eleven
          // records already carry one, so requiring it costs nothing today and
          // stops the next one being written without it.
          if (!isNonEmptyString(citation.quotedAssertion)) {
            errors.push(
              `${cwhere}: ${citation.kind === "artifact" ? "an" : "a"} ${citation.kind} citation must carry a quotedAssertion — the file and line drift, the quoted text is what a reader can still check`,
            );
          }
        } else if (citation.kind === "ci-run") {
          checkCiRunCitation(errors, cwhere, citation);
        } else if (citation.kind === "discharge") {
          checkDischargeCitation(errors, cwhere, citation, repoRoot, record.roadmapFile);
        }
        for (const optional of ["url", "commit", "quotedAssertion"]) {
          if (optional in citation && !isNonEmptyString(citation[optional])) {
            errors.push(`${cwhere}: ${optional}, when present, must be a non-empty string`);
          }
        }
      });
    }

    // `UNMET` must file one; the two pending-run classes MAY, to machine-link
    // the handoff record they would otherwise only mention in `notes`. Every
    // class that carries a tick may not — see DEFECT_REF_CLASSIFICATIONS.
    if (DEFECT_REF_CLASSIFICATIONS.includes(criterion.classification)) {
      if (!isNonEmptyString(criterion.defectRef)) {
        if (criterion.classification === "UNMET") {
          errors.push(`${where}: an UNMET criterion must name a defectRef`);
        }
      } else {
        // Round-8 finding (bypass 17a): the `defects/NN-` location discipline
        // was string-only while `path.join` collapsed `..`, so
        // `defects/14-decoy/../14-ratchet-….md` satisfied the phase prefix with
        // a directory the `..` discarded — and nothing checked containment at
        // all, so `..` past the repository root named a "defect record" no
        // reviewer of this repository can see, which the validator then READ.
        const shapeProblem = repoPathShapeProblem(criterion.defectRef);
        if (shapeProblem !== undefined) {
          errors.push(`${where}: defectRef ${criterion.defectRef} ${shapeProblem}`);
        }
        const defectRef =
          shapeProblem === undefined
            ? criterion.defectRef
            : path.posix.normalize(criterion.defectRef);
        const expectedPrefix = `${CLOSEOUT_DIR}/defects/${record.phase}-`;
        const defectAbs = path.resolve(repoRoot, defectRef);
        if (!defectRef.startsWith(expectedPrefix) || !defectRef.endsWith(".md")) {
          errors.push(`${where}: defectRef must be ${expectedPrefix}<slug>.md`);
        } else if (!defectAbs.startsWith(path.resolve(repoRoot) + path.sep)) {
          errors.push(`${where}: defectRef ${defectRef} resolves outside the repository root`);
        } else if (!existsSync(defectAbs)) {
          errors.push(`${where}: defectRef ${defectRef} does not exist`);
        } else if (lstatSync(defectAbs).isSymbolicLink()) {
          errors.push(
            `${where}: defectRef ${defectRef} is a symlink, not a committed defect record`,
          );
        } else if (
          realpathOr(defectAbs) !== defectAbs &&
          !realpathOr(defectAbs).startsWith(realpathOr(path.resolve(repoRoot)) + path.sep)
        ) {
          // The parent-directory form of the same escape, which `lstat` on the
          // file itself cannot see: a symlinked `defects/` leads anywhere.
          errors.push(
            `${where}: defectRef ${defectRef} resolves outside the repository root, through a symlinked parent directory (-> ${realpathOr(defectAbs)})`,
          );
        } else if (!statSync(defectAbs).isFile()) {
          // Round-5 finding: this check was `existsSync` alone, unlike the
          // citation path check beside it, so a DIRECTORY named `NN-slug.md`
          // satisfied "the defect record exists" — and then reading it threw
          // EISDIR and took the whole validator down.
          errors.push(`${where}: defectRef ${defectRef} is not a file`);
        } else {
          checkDefectRecordShape(
            errors,
            where,
            defectAbs,
            defectRef,
            isNonEmptyString(criterion.text) ? criterion.text : "",
          );
        }
      }
    } else if ("defectRef" in criterion) {
      errors.push(
        `${where}: defectRef is only for a criterion that stays UNTICKED — ${DEFECT_REF_CLASSIFICATIONS.join(", ")}. A tick means the evidence is in hand; a record of what is outstanding contradicts it.`,
      );
    }

    if (criterion.classification === "WORDING-MISMATCH") {
      if (!("wordingCorrection" in criterion)) {
        errors.push(`${where}: a WORDING-MISMATCH criterion must record its wordingCorrection`);
      } else if (
        checkKeys(errors, `${where}.wordingCorrection`, criterion.wordingCorrection, WORDING_KEYS)
      ) {
        for (const half of ["before", "after"]) {
          if (!isNonEmptyString(criterion.wordingCorrection[half])) {
            errors.push(`${where}.wordingCorrection: ${half} must be a non-empty string`);
          }
        }
        // Adversarial-review finding, round 4: nothing tied `before` to the
        // criterion it corrects, so a reviewer swapped a real one for the
        // strawman "Coverage gate exists." and the record passed — the audit
        // trail of what was corrected was forgeable while the hash-pinned
        // `text` beside it stayed honest. Under the wording protocol the phase
        // file KEEPS the original wording and the correction lives in the
        // annotation, so `before` is, by construction, `text`. Compared
        // whitespace-normalized, the same way every other wording comparison
        // here is, so a re-wrapped copy is not a false failure.
        if (
          isNonEmptyString(criterion.wordingCorrection.before) &&
          isNonEmptyString(criterion.text) &&
          normalize(criterion.wordingCorrection.before) !== normalize(criterion.text)
        ) {
          errors.push(
            `${where}.wordingCorrection: before must be this criterion's own pinned text verbatim — the protocol leaves the original wording in the phase file, so "before" is what the box still says. It disagrees with the recorded text, which makes the correction's audit trail unverifiable.`,
          );
        }
      }
    } else if ("wordingCorrection" in criterion) {
      errors.push(`${where}: wordingCorrection is only for a WORDING-MISMATCH criterion`);
    }

    if ("notes" in criterion && !isNonEmptyString(criterion.notes)) {
      errors.push(`${where}: notes, when present, must be a non-empty string`);
    }

    // The roadmap cross-check. The wording protocol preserves the original
    // text verbatim and appends the citation, so the recorded text must still
    // be the checkbox item's PREFIX — a weakened or reworded criterion fails
    // here even though its own hash is internally consistent.
    //
    // A bare prefix match is not enough, and this was a real hole: an agent
    // could record only the harmless HEAD of a criterion ("Quarantine catches
    // seeded threats:") and silently soften everything after it, hash and all,
    // with the validator reporting nothing. So the remainder must be empty or
    // the em-dash-led citation annotation — i.e. the record has to account for
    // the WHOLE checkbox, not an opening substring of it.
    if (checkboxes !== undefined) {
      const checkbox = checkboxes[position];
      const boxText = normalize(checkbox.text);
      const recorded = normalize(criterion.text);
      if (!boxText.startsWith(recorded)) {
        errors.push(
          `${where}: recorded text does not match the verbatim wording of checkbox ${String(position + 1)} in ${record.roadmapFile}`,
        );
      } else {
        const remainder = boxText.slice(recorded.length).trimStart();
        if (remainder.length > 0 && !remainder.startsWith(ANNOTATION_LEAD)) {
          errors.push(
            `${where}: checkbox ${String(position + 1)} in ${record.roadmapFile} continues past the recorded text with ${JSON.stringify(remainder.slice(0, 60))} — that tail is unaccounted for; the record must pin the criterion's full wording, and anything appended must be the "${ANNOTATION_LEAD}Evidence …**" citation annotation`,
          );
        } else if (remainder.length > 0) {
          // Round-8 finding (bypass 18): the message above already promised the
          // tail is "the `— **Evidence …**` citation annotation" while only the
          // four-character lead was enforced, so the weakening clause simply
          // moved to the right of it.
          checkAnnotation(errors, where, remainder, criterion, record.roadmapFile, position);
        }
      }
      if (checkbox.checked !== criterion.ticked) {
        errors.push(
          `${where}: ticked=${String(criterion.ticked)} but checkbox ${String(position + 1)} in ${record.roadmapFile} is ${checkbox.checked ? "[x]" : "[ ]"}`,
        );
      }
    }
  });

  return errors;
}

/**
 * Phases whose ticks legitimately predate this pass and so have no closeout
 * record. Phase 23 was closed and evidenced against `release-e2e` run
 * 30250453824 before the closeout index existed — see `roadmap/README.md`'s
 * completion ledger. **Nothing may be added here.** From now on a tick needs a
 * record; if a phase's ticks cannot be recorded, they should not be ticks.
 */
export const PRE_INDEX_TICKED_PHASES = ["23"];

/**
 * The reverse direction of every check in `validateCloseoutRecord`, all of
 * which are anchored on a record that EXISTS. Two ways a phase can go
 * unrecorded, and both are reported:
 *
 *   1. It cites `phase-NN.json` and the file was never written — an agent that
 *      ticked boxes, wrote the header, and forgot the JSON.
 *   2. It has ticked criteria and no record at all. This was the cheapest
 *      attack on the entire regime, found while reviewing the round-4 fixes and
 *      demonstrated live: ticking all seven of `roadmap/13`'s boxes and writing
 *      nothing at all passed, because every other check needs a record to hang
 *      off. `roadmap/README.md`'s completion ledger already forbids it in
 *      prose — "ticking them from general confidence would be exactly the
 *      aspirational bookkeeping that rule forbids" — and this is the prose
 *      becoming a check.
 */
function findUnrecordedPhaseClosures(repoRoot, presentFileNames, baseline) {
  const problems = [];

  // Round-8 finding (bypass 21). Everything below — and `--check` in the
  // baseline generator — iterates over the phase files PRESENT, so nothing
  // asserted that a pinned phase still HAS one: deleting
  // `roadmap/22-learning-system.md`, 8 unticked criteria, left both reporting
  // PASS. The baseline is the anchor that lives outside the commit under
  // review, so it is the thing that can see a file stop existing. Checked
  // before the directory scan, and independently of it, so an entirely missing
  // `roadmap/` is reported as 25 deletions rather than as nothing at all.
  if (baseline !== null) {
    const pinned = Object.entries(baseline.phases).sort(([a], [b]) => a.localeCompare(b));
    for (const [phase, entry] of pinned) {
      if (!isPlainObject(entry) || typeof entry.roadmapFile !== "string") continue;
      if (!existsSync(path.join(repoRoot, entry.roadmapFile))) {
        problems.push(
          `${entry.roadmapFile} is pinned by ${BASELINE_FILE} for phase ${phase} but has been deleted — every other check here iterates over the phase files that are PRESENT, so a deleted phase is an unclosed phase that stopped being anyone's problem. Removing a phase is a roadmap decision that re-pins the baseline in its own commit, not something a closeout pass does.`,
        );
      }
    }
  }

  const roadmapDir = path.join(repoRoot, "roadmap");
  if (!existsSync(roadmapDir)) return problems;
  for (const name of readdirSync(roadmapDir).sort()) {
    const phase = /^(\d{2})-.*\.md$/.exec(name);
    if (phase === null) continue;
    const text = readFileSync(path.join(roadmapDir, name), "utf8");
    const expected = `phase-${phase[1]}.json`;
    const hasRecord = presentFileNames.includes(expected);

    // Records get their own structural report from `validateCloseoutRecord`;
    // for a phase file WITHOUT one this is the only place it is examined at
    // all, so a decoy section planted before a phase is closed must not lie in
    // wait — and, since round 7, its criteria must be pinned too.
    const parsed = hasRecord ? undefined : parseExitCriteriaCheckboxes(text);

    // Round-7 finding (bypass 17). Every baseline comparison ran THROUGH a
    // record, and `generate-criteria-baseline.mjs --check` only compares the
    // committed JSON against git — it never reads the working tree. So a phase
    // file with no record was pinned by nothing, and `checkDischargeCitation`
    // resolves against exactly those files. Phase 23 was the worst case: exempt
    // from the ticks-need-a-record rule AND record-less. A reviewer appended a
    // fabricated ticked criterion to roadmap/23, repointed phase 09's
    // discharges at it, and every check went green.
    if (baseline !== null) {
      const entry = baseline.phases[phase[1]];
      if (!isPlainObject(entry) || !Array.isArray(entry.criteria)) {
        problems.push(
          `roadmap/${name} has no entry in the frozen baseline ${BASELINE_FILE} — every phase file must be pinned, whether or not it has a closeout record`,
        );
      } else if (entry.roadmapFile !== `roadmap/${name}`) {
        // The sharper form of the same attack: touch no existing file, just add
        // a new one. The phase NUMBER is what the baseline and the exemption
        // key on, so `roadmap/23-supplement.md` inherited both and was pinned
        // by neither.
        problems.push(
          `roadmap/${name} is not the file the frozen baseline pins for phase ${phase[1]} (that is ${entry.roadmapFile}) — a second file sharing a phase number is pinned by nothing`,
        );
      } else if (parsed !== undefined && parsed.items !== undefined) {
        if (parsed.items.length !== entry.criteria.length) {
          problems.push(
            `roadmap/${name} has ${String(parsed.items.length)} exit criteria but the frozen baseline pins ${String(entry.criteria.length)} — criteria were added or removed in a phase that has no closeout record to account for them`,
          );
        }
        parsed.items.forEach((box, index) => {
          const frozen = entry.criteria[index];
          if (frozen !== undefined && frozen !== sha256(normalize(criterionWording(box.text)))) {
            problems.push(
              `roadmap/${name} criterion ${String(index + 1)} does not hash to the frozen original wording in ${BASELINE_FILE} — this phase has no closeout record, so nothing else pins it`,
            );
          }
        });
      }
    }

    if (hasRecord) continue;

    for (const problem of parsed.problems) problems.push(`roadmap/${name} ${problem}`);
    if (parsed.items === undefined && parsed.problems.length === 0) {
      // Renaming the heading (`## Exit criteria (final)`) and ticking
      // everything used to pass the validator outright — it was caught only by
      // the unit suite's self-test, in a different CI job. All 25 phase files
      // parse today, so the validator can simply require it.
      problems.push(
        `roadmap/${name} has no "## Exit criteria" section — every phase file must carry one, spelled exactly that way`,
      );
      continue;
    }

    if (text.includes(`${CLOSEOUT_DIR}/${expected}`)) {
      problems.push(
        `roadmap/${name} cites ${CLOSEOUT_DIR}/${expected}, but that closeout record does not exist`,
      );
      continue;
    }
    if (PRE_INDEX_TICKED_PHASES.includes(phase[1])) continue;
    const ticked = (parsed.items ?? []).filter((box) => box.checked).length;
    if (ticked > 0) {
      problems.push(
        `roadmap/${name} has ${String(ticked)} ticked exit criteria and no ${CLOSEOUT_DIR}/${expected} — a tick with no closeout record behind it is the aspirational bookkeeping roadmap/README.md's completion ledger refuses`,
      );
    }
  }
  return problems;
}

/**
 * Validates every `phase-NN.json` under `<repoRoot>/docs/evidence/criteria-closeout/`,
 * and flags any phase file that cites a record which was never written.
 * A present-but-empty directory is an error, not a vacuous pass.
 */
export function validateAllCloseoutRecords(repoRoot) {
  // Loaded once here so a missing manifest is one error, not one per record.
  const loadedBaseline = loadCriteriaBaseline(repoRoot);
  const baseline = loadedBaseline.baseline ?? null;

  const dir = path.join(repoRoot, CLOSEOUT_DIR);
  if (!existsSync(dir) || !statSync(dir).isDirectory()) {
    return {
      errors: [
        `${CLOSEOUT_DIR}/ does not exist`,
        ...loadedBaseline.errors,
        ...findUnrecordedPhaseClosures(repoRoot, [], baseline),
      ],
      recordCount: 0,
      fileNames: [],
    };
  }

  const fileNames = readdirSync(dir)
    .filter((name) => /^phase-\d{2}\.json$/.test(name))
    .sort();
  if (fileNames.length === 0) {
    return {
      errors: [
        `${CLOSEOUT_DIR}/ contains no phase-NN.json records`,
        ...loadedBaseline.errors,
        ...findUnrecordedPhaseClosures(repoRoot, fileNames, baseline),
      ],
      recordCount: 0,
      fileNames,
    };
  }

  const errors = [
    ...loadedBaseline.errors,
    ...findUnrecordedPhaseClosures(repoRoot, fileNames, baseline),
  ];
  for (const fileName of fileNames) {
    let parsed;
    try {
      parsed = JSON.parse(readFileSync(path.join(dir, fileName), "utf8"));
    } catch (cause) {
      errors.push(`${fileName}: not parseable JSON — ${String(cause)}`);
      continue;
    }
    errors.push(...validateCloseoutRecord(parsed, { repoRoot, fileName, baseline }));
  }
  return { errors, recordCount: fileNames.length, fileNames };
}

const isMain =
  process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  const repoRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
  const { errors, recordCount, fileNames } = validateAllCloseoutRecords(repoRoot);
  for (const fileName of fileNames) console.log(`check-criteria-closeout: read — ${fileName}`);
  if (errors.length > 0) {
    for (const error of errors) console.error(`check-criteria-closeout: ${error}`);
    console.error(`check-criteria-closeout: FAIL — ${String(errors.length)} problem(s).`);
    process.exit(1);
  }
  console.log(
    `check-criteria-closeout: PASS — ${String(recordCount)} closeout record(s) valid and consistent with their roadmap files.`,
  );
}
