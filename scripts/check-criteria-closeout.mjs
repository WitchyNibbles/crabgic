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
 * verifies. Concretely it makes four drifts impossible to land quietly:
 *
 *   1. A criterion's wording being weakened to make it tickable. Each record
 *      pins `sha256(text)` AND requires that verbatim text to still be the
 *      prefix of a real checkbox item in the phase file — with the remainder
 *      constrained to the `— **` citation annotation, so a record cannot pin
 *      a harmless opening substring, or stop at the criterion's own internal
 *      em dash, and leave the tail unaccounted for.
 *   2. A checkbox and its record disagreeing. Tick state and checkbox count
 *      are cross-checked against the roadmap file in both directions, and a
 *      phase file that cites a closeout record which was never written is
 *      reported (so ticking boxes and forgetting the JSON is not invisible).
 *   3. A tick with nothing behind it. `ticked` is derived from the
 *      classification (never independently asserted), every tick needs at
 *      least one citation, every `UNMET` needs a defect record that exists on
 *      disk, and every `WORDING-MISMATCH` needs its before/after.
 *   4. A citation that points at nothing. `test` and `artifact` refs are
 *      repository paths and must resolve to a regular file inside the repo
 *      root. This is not hypothetical: this pass's own phase-12 defect exists
 *      BECAUSE a cited test file was deleted in a refactor and nothing noticed
 *      for months.
 *
 * What it CANNOT catch, stated so nobody over-trusts it: this is a snapshot
 * validator, so a dishonest edit that rewrites a criterion AND its record in
 * the same commit is self-consistent and passes silently. That is visible only
 * in the roadmap diff, to a human — which is what the wording protocol and
 * per-phase review are for.
 *
 * Deliberately dependency-free (no zod): `meta-checks` runs `npm ci` without
 * `npm run build`, so this must work from source with nothing compiled. The
 * strictness zod's `.strict()` would give is implemented directly — see
 * `checkKeys`.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** Repo-relative home of the closeout index. Exported so the suite and any future tooling agree on one string. */
export const CLOSEOUT_DIR = "docs/evidence/criteria-closeout";

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

/** `packages/x/y.test.ts:12` / `…:12-18` -> `packages/x/y.test.ts`. */
function stripLineSuffix(ref) {
  return ref.replace(/:\d+(?:-\d+)?$/, "");
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
const ANNOTATION_LEAD = "— **";

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
 * Splits a phase file's `## Exit criteria` section into one entry per
 * checkbox item, joining wrapped continuation lines and collapsing runs of
 * whitespace so a hard-wrapped criterion compares equal to its one-line
 * source. Returns `[{ checked, text }]` in file order.
 */
export function parseExitCriteriaCheckboxes(markdown) {
  const afterHeading = markdown.split(/^##\s+Exit criteria\s*$/m)[1];
  if (afterHeading === undefined) return undefined;
  const section = afterHeading.split(/^##\s+/m)[0];

  const items = [];
  for (const rawLine of section.split("\n")) {
    const checkbox = /^\s*-\s+\[([ xX])\]\s?(.*)$/.exec(rawLine);
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
  return items.map((item) => ({
    checked: item.checked,
    text: item.text.replace(/\s+/g, " ").trim(),
  }));
}

const normalize = (value) => value.replace(/\s+/g, " ").trim();

/**
 * Validates one closeout record.
 *
 * @param {unknown} record parsed JSON
 * @param {{ repoRoot: string, fileName: string }} ctx
 * @returns {string[]} every problem found (empty means valid)
 */
export function validateCloseoutRecord(record, ctx) {
  const errors = [];
  const { repoRoot, fileName } = ctx;

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

  const roadmapPath = path.join(repoRoot, record.roadmapFile);
  let checkboxes;
  if (!existsSync(roadmapPath)) {
    errors.push(`${fileName}: roadmapFile ${record.roadmapFile} does not exist`);
  } else {
    checkboxes = parseExitCriteriaCheckboxes(readFileSync(roadmapPath, "utf8"));
    if (checkboxes === undefined) {
      errors.push(`${fileName}: ${record.roadmapFile} has no "## Exit criteria" section`);
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
          const relPath = stripLineSuffix(citation.ref);
          const abs = path.resolve(repoRoot, relPath);
          const rootPrefix = path.resolve(repoRoot) + path.sep;
          if (!abs.startsWith(rootPrefix)) {
            // A citation is a repository path. An absolute path or a `..`
            // escape names something no reviewer of this repo can resolve.
            errors.push(
              `${cwhere}: ${citation.kind} ref ${relPath} resolves outside the repository root`,
            );
          } else if (!existsSync(abs)) {
            errors.push(
              `${cwhere}: ${citation.kind} ref ${relPath} does not exist in the repository`,
            );
          } else if (!statSync(abs).isFile()) {
            // A directory ref resolves but cites nothing in particular.
            errors.push(`${cwhere}: ${citation.kind} ref ${relPath} is not a file`);
          }
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
        } else if (!existsSync(path.join(repoRoot, criterion.defectRef))) {
          errors.push(`${where}: defectRef ${criterion.defectRef} does not exist`);
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
 * The reverse direction of every check in `validateCloseoutRecord`, all of
 * which are anchored on a record that exists: a phase file whose exit criteria
 * CITE a closeout record must actually have one. Without this an agent could
 * tick boxes, write the header, forget the JSON, and be invisible.
 *
 * Keyed on the phase file's own citation rather than on "has ticked boxes",
 * because phase 23 was closed before this pass existed and legitimately has
 * sixteen ticks and no record.
 */
function findOrphanedCloseoutHeaders(repoRoot, presentFileNames) {
  const roadmapDir = path.join(repoRoot, "roadmap");
  if (!existsSync(roadmapDir)) return [];
  const orphans = [];
  for (const name of readdirSync(roadmapDir).sort()) {
    const phase = /^(\d{2})-.*\.md$/.exec(name);
    if (phase === null) continue;
    const text = readFileSync(path.join(roadmapDir, name), "utf8");
    const expected = `phase-${phase[1]}.json`;
    if (text.includes(`${CLOSEOUT_DIR}/${expected}`) && !presentFileNames.includes(expected)) {
      orphans.push(
        `roadmap/${name} cites ${CLOSEOUT_DIR}/${expected}, but that closeout record does not exist`,
      );
    }
  }
  return orphans;
}

/**
 * Validates every `phase-NN.json` under `<repoRoot>/docs/evidence/criteria-closeout/`,
 * and flags any phase file that cites a record which was never written.
 * A present-but-empty directory is an error, not a vacuous pass.
 */
export function validateAllCloseoutRecords(repoRoot) {
  const dir = path.join(repoRoot, CLOSEOUT_DIR);
  if (!existsSync(dir) || !statSync(dir).isDirectory()) {
    return {
      errors: [`${CLOSEOUT_DIR}/ does not exist`, ...findOrphanedCloseoutHeaders(repoRoot, [])],
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
        ...findOrphanedCloseoutHeaders(repoRoot, fileNames),
      ],
      recordCount: 0,
      fileNames,
    };
  }

  const errors = findOrphanedCloseoutHeaders(repoRoot, fileNames);
  for (const fileName of fileNames) {
    let parsed;
    try {
      parsed = JSON.parse(readFileSync(path.join(dir, fileName), "utf8"));
    } catch (cause) {
      errors.push(`${fileName}: not parseable JSON — ${String(cause)}`);
      continue;
    }
    errors.push(...validateCloseoutRecord(parsed, { repoRoot, fileName }));
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
