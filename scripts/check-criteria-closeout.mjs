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
 * verifies. Concretely it makes seven drifts impossible to land quietly:
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
 *
 * What it CANNOT catch, stated so nobody over-trusts it: the baseline pins the
 * WORDS of a criterion, not its meaning, and it says nothing about the roadmap
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

export const CITATION_KINDS = ["ci-run", "artifact", "test", "journal-export", "discharge"];

/**
 * The kinds whose `ref` is a repository path and must therefore resolve on
 * disk. `ci-run`, `discharge` and `journal-export` name a run, another phase's
 * criterion, or an exported entry — none of them a local file.
 */
export const RESOLVABLE_CITATION_KINDS = ["test", "artifact"];

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
  for (const rawLine of lines.slice(start, end)) {
    const checkbox = CHECKBOX_ITEM.exec(rawLine);
    if (checkbox !== null) {
      items.push({ checked: checkbox[1].toLowerCase() === "x", text: checkbox[2] });
      continue;
    }
    // A continuation line belongs to the item above it: indented, non-blank,
    // and not the start of a new list item.
    if (items.length > 0 && /^\s+\S/.test(rawLine) && !/^\s*-\s/.test(rawLine)) {
      items[items.length - 1].text += ` ${rawLine.trim()}`;
    }
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
function resolveCitationRef(errors, cwhere, citation, repoRoot) {
  const { relPath, start, end } = parseCitationRef(citation.ref);
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
  const real = realpathOr(abs);
  if (real !== abs && !real.startsWith(realpathOr(path.resolve(repoRoot)) + path.sep)) {
    errors.push(
      `${cwhere}: ${citation.kind} ref ${relPath} resolves outside the repository root, through a symlinked parent directory (-> ${real})`,
    );
    return;
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
          resolveCitationRef(errors, cwhere, citation, repoRoot);
        }
        for (const optional of ["url", "commit", "quotedAssertion"]) {
          if (optional in citation && !isNonEmptyString(citation[optional])) {
            errors.push(`${cwhere}: ${optional}, when present, must be a non-empty string`);
          }
        }
      });
    }

    if (criterion.classification === "UNMET") {
      if (!isNonEmptyString(criterion.defectRef)) {
        errors.push(`${where}: an UNMET criterion must name a defectRef`);
      } else {
        const expectedPrefix = `${CLOSEOUT_DIR}/defects/${record.phase}-`;
        if (
          !criterion.defectRef.startsWith(expectedPrefix) ||
          !criterion.defectRef.endsWith(".md")
        ) {
          errors.push(`${where}: defectRef must be ${expectedPrefix}<slug>.md`);
        } else {
          const defectAbs = path.join(repoRoot, criterion.defectRef);
          if (!existsSync(defectAbs)) {
            errors.push(`${where}: defectRef ${criterion.defectRef} does not exist`);
          } else if (lstatSync(defectAbs).isSymbolicLink()) {
            errors.push(
              `${where}: defectRef ${criterion.defectRef} is a symlink, not a committed defect record`,
            );
          } else if (!statSync(defectAbs).isFile()) {
            // Round-5 finding: this check was `existsSync` alone, unlike the
            // citation path check beside it, so a DIRECTORY named `NN-slug.md`
            // satisfied "the defect record exists" — and then reading it threw
            // EISDIR and took the whole validator down.
            errors.push(`${where}: defectRef ${criterion.defectRef} is not a file`);
          } else {
            checkDefectRecordShape(
              errors,
              where,
              defectAbs,
              criterion.defectRef,
              isNonEmptyString(criterion.text) ? criterion.text : "",
            );
          }
        }
      }
    } else if ("defectRef" in criterion) {
      errors.push(`${where}: defectRef is only for an UNMET criterion`);
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
function findUnrecordedPhaseClosures(repoRoot, presentFileNames) {
  const roadmapDir = path.join(repoRoot, "roadmap");
  if (!existsSync(roadmapDir)) return [];
  const problems = [];
  for (const name of readdirSync(roadmapDir).sort()) {
    const phase = /^(\d{2})-.*\.md$/.exec(name);
    if (phase === null) continue;
    const text = readFileSync(path.join(roadmapDir, name), "utf8");
    const expected = `phase-${phase[1]}.json`;
    if (presentFileNames.includes(expected)) continue;

    // Records get their own structural report from `validateCloseoutRecord`;
    // this is the only place a phase file WITHOUT one is examined at all, and a
    // decoy section planted before a phase is closed must not lie in wait.
    const parsed = parseExitCriteriaCheckboxes(text);
    for (const problem of parsed.problems) problems.push(`roadmap/${name} ${problem}`);

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
        ...findUnrecordedPhaseClosures(repoRoot, []),
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
        ...findUnrecordedPhaseClosures(repoRoot, fileNames),
      ],
      recordCount: 0,
      fileNames,
    };
  }

  const errors = [...loadedBaseline.errors, ...findUnrecordedPhaseClosures(repoRoot, fileNames)];
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
