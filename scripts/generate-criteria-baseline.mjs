#!/usr/bin/env node
/**
 * Generates — and, in `--check` mode, re-derives and verifies —
 * `docs/evidence/criteria-closeout/criteria-baseline.json`: the frozen record
 * of what every roadmap exit criterion said BEFORE any closeout pass touched
 * its phase file.
 *
 *   node scripts/generate-criteria-baseline.mjs --write
 *   node scripts/generate-criteria-baseline.mjs --check   (default)
 *
 * WHY THIS EXISTS. `check-criteria-closeout.mjs` pins each closeout record
 * against the CURRENT checkbox text. That is a snapshot check, and an
 * adversarial review demonstrated the consequence live: rewrite a criterion in
 * `roadmap/NN-*.md` and update the matching record's `text`/`textSha256` in the
 * SAME commit, and every existing defense agrees with itself. The reviewer
 * replaced phase 03's criterion 2 — three named compiler properties and a
 * ≥10k-case clause — with "Compiler property suite green in CI." and the
 * validator passed.
 *
 * The missing ingredient was an anchor OUTSIDE the commit under review. This
 * file is that anchor: one hash per criterion, taken from the phase file as it
 * stood before its closeout, so a record can only pin wording the roadmap
 * carried before anyone had an incentive to soften it.
 *
 * WHY IT IS REPRODUCIBLE RATHER THAN JUST COMMITTED. A committed manifest is
 * only as honest as its last editor — laundering it is one more file in the
 * same PR. So every phase entry pins the git revision its hashes came from, and
 * `--check` re-derives all of them straight from `git show <rev>:<file>`.
 * Forging a baseline entry therefore means rewriting published git history, not
 * editing a JSON file. `--check` is a step in `ci.yml`'s `meta-checks` job
 * (which is why that job checks out with `fetch-depth: 0`).
 *
 * WHY THESE REVISIONS. A phase that has already been closed carries the
 * closeout annotation in its checkboxes, so its baseline must come from the
 * closeout commit's PARENT. Phases nobody has closed are pinned at the tree the
 * baseline was created from. Both cases are asserted, not assumed: generation
 * fails if any checkbox at a pinned revision already contains the annotation
 * lead `— **`.
 *
 * Dependency-free for the same reason the validator is: `meta-checks` runs
 * `npm ci` with no build step.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  ANNOTATION_LEAD,
  BASELINE_FILE,
  normalizeCriterionText,
  parseExitCriteriaCheckboxes,
} from "./check-criteria-closeout.mjs";

const REPO_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

/**
 * The tree every phase's baseline is read from, unless the phase appears in
 * `PRE_CLOSEOUT_REVISIONS` below. `af46e00` is the `main` this baseline was
 * created against.
 */
const DEFAULT_REVISION = "af46e007c1363d4838d74e2eea0d531e4d6bb4f3";

/**
 * Phases whose closeout has already landed: their checkboxes now carry the
 * annotation, so the baseline comes from the closeout commit's parent.
 * `git log --oneline` for the three closeout commits:
 *   65ff0da  phase 12 (pilot)      parent 70d7da7
 *   97ef18c  phase 05              parent d11b059
 *   af46e00  phase 03              parent 97ef18c
 */
const PRE_CLOSEOUT_REVISIONS = {
  12: {
    rev: "70d7da73214fe735448d5d97ac7d4b9eb24503d6",
    note: "parent of 65ff0da, the phase-12 closeout (pilot)",
  },
  "05": {
    rev: "d11b05944a0b6e96dda8b468d93234dbb0e93100",
    note: "parent of 97ef18c, the phase-05 closeout",
  },
  "03": {
    rev: "97ef18cdaaf78ee3c6154e4c4f74f1ac05c1c6b2",
    note: "parent of af46e00, the phase-03 closeout",
  },
  /**
   * Phase 25 postdates `DEFAULT_REVISION` — it did not exist at af46e00, so
   * there is no tree there to hash. It is pinned at the commit that introduced
   * it to `main`, which is pre-closeout by construction: no closeout pass has
   * run, and `baselineEntryFor` asserts that by refusing any checkbox already
   * carrying the annotation lead.
   *
   * ⚠️ A PIN MUST BE REACHABLE FROM `main`, and this one was not (fixed
   * 2026-08-15). It originally named `68e5620`, a commit on the feature branch
   * that PR #137 **squash-merged** — so the object survived only as long as
   * `origin/feat/pipeline-conformance` did. Deleting a merged branch is
   * routine, and doing it would have made `showBlob` fail for phase 25 and
   * broken `check:criteria-closeout` on `main` permanently, for a reason
   * nothing in the failure would have explained. CI passed throughout because
   * `fetch-depth: 0` fetches every branch, which is precisely why the defect
   * was invisible.
   *
   * The re-pin is hash-neutral and was verified as such: no criterion checkbox
   * line differs between `68e5620` and `fc448fb`, so the frozen wording this
   * baseline seals is byte-identical. Nothing was re-sealed — only the anchor
   * moved onto history that cannot disappear.
   *
   * THE RULE THIS GENERALISES TO: pin a postdating phase at its **merge**
   * commit on `main`, never at a branch commit. A pin on a squash-merged branch
   * is a dangling reference waiting for a cleanup.
   */
  25: {
    rev: "fc448fb018454ea6a964819ff433b5b5f3f0bed4",
    note: "the merge of PR #137, which introduced roadmap/25 to main; no closeout has touched it",
  },
};

const DEFAULT_NOTE = "main at baseline creation; no closeout had touched this phase file";

const sha256 = (value) => createHash("sha256").update(value, "utf8").digest("hex");

/** Every `roadmap/NN-<slug>.md`, in phase order, as of the working tree. */
function phaseFiles(rev) {
  const listed = execFileSync("git", ["ls-tree", "-r", "--name-only", rev, "--", "roadmap/"], {
    cwd: REPO_ROOT,
    encoding: "utf8",
  });
  return listed
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => /^roadmap\/\d{2}-[a-z0-9-]+\.md$/.test(line))
    .sort();
}

function showBlob(rev, file) {
  return execFileSync("git", ["show", `${rev}:${file}`], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });
}

/**
 * The trust-critical core, as a pure function of one phase file's text at its
 * pinned revision. Separated out so it can be unit-tested without git: the
 * annotation refusal below is the single assertion standing between "these
 * hashes are the ORIGINAL wording" and "these hashes are whatever the file said
 * after somebody had already edited it", and it had no test.
 */
export function baselineEntryFor(file, pin, markdown) {
  const { items: checkboxes, problems } = parseExitCriteriaCheckboxes(markdown);
  if (problems.length > 0) {
    throw new Error(`${file} at ${pin.rev} ${problems.join("; ")}`);
  }
  if (checkboxes === undefined || checkboxes.length === 0) {
    throw new Error(`${file} at ${pin.rev} has no "## Exit criteria" checkbox items`);
  }
  // The pin is supposed to predate the closeout. If a checkbox already
  // carries the citation annotation, it does not, and the whole baseline for
  // that phase would be laundered wording rather than original wording.
  const annotated = checkboxes.filter((box) => box.text.includes(ANNOTATION_LEAD));
  if (annotated.length > 0) {
    throw new Error(
      `${file} at ${pin.rev} already carries ${String(annotated.length)} closeout annotation(s) — that revision is not pre-closeout`,
    );
  }
  return {
    roadmapFile: file,
    sourceRev: pin.rev,
    sourceNote: pin.note,
    criteria: checkboxes.map((box) => sha256(normalizeCriterionText(box.text))),
  };
}

/** Builds the manifest object from git, throwing on anything that smells wrong. */
/**
 * Where a pinned revision still lives — `"main"`, `"head"` or `"none"`.
 *
 * Separated from the audit below so the audit can be unit-tested without git,
 * the same split `baselineEntryFor` already uses.
 */
function pinReachability(rev) {
  const reachableFrom = (ref) => {
    try {
      execFileSync("git", ["merge-base", "--is-ancestor", rev, ref], { stdio: "ignore" });
      return true;
    } catch {
      return false;
    }
  };
  // `origin/main` first, then a local `main`: a fresh CI checkout has the
  // remote-tracking ref, a developer clone usually has both.
  for (const ref of ["origin/main", "main"]) {
    try {
      execFileSync("git", ["rev-parse", "--verify", "--quiet", ref], { stdio: "ignore" });
    } catch {
      continue;
    }
    if (reachableFrom(ref)) return "main";
  }
  return reachableFrom("HEAD") ? "head" : "none";
}

/**
 * Refuses a pin that no longer hangs off history the repository keeps.
 *
 * WHY THIS EXISTS — a defect that was live on `main` and green in CI. Phase 25
 * was pinned at `68e5620`, a commit on the feature branch that PR #137
 * **squash-merged**. Squashing does not preserve the branch's commits, so the
 * object survived only while `origin/feat/pipeline-conformance` did. Deleting a
 * merged branch is routine housekeeping, and doing it would have made
 * `showBlob` fail for phase 25 and broken `check:criteria-closeout` on `main`
 * permanently — the repository's own criteria seal, underivable, for a reason
 * the failure text would not have explained. CI was green throughout because
 * `fetch-depth: 0` fetches every branch, which is exactly why nobody saw it.
 *
 * WHY A HEAD-ONLY PIN IS OWED RATHER THAN REFUSED. The PR that introduces a
 * phase cannot pin its own merge commit — that commit does not exist yet. So a
 * pin reachable only from `HEAD` is recorded as owed and the branch stays
 * green; the refusal fires on `main`'s first run after the squash, which is the
 * earliest moment the defect is real. That costs one loud red run per newly
 * introduced phase, and it is the honest price of a seal that cannot rot
 * quietly.
 */
export function auditPinReachability(pins, reachability = pinReachability) {
  const problems = [];
  const pendingRepins = [];
  for (const [phase, pin] of Object.entries(pins)) {
    const where = reachability(pin.rev);
    if (where === "main") continue;
    if (where === "head") {
      pendingRepins.push(
        `phase ${phase}: pin ${pin.rev} is not on main yet — re-pin it to the merge commit after this branch merges, or the seal dies with the branch`,
      );
      continue;
    }
    problems.push(
      `phase ${phase}: pinned revision ${pin.rev} is reachable from neither main nor HEAD — it was almost certainly a squash-merged branch commit. Re-pin phase ${phase} to the merge commit that introduced its roadmap file to main; the re-pin is hash-neutral if no criterion wording changed, and this script proves that when you regenerate.`,
    );
  }
  return { problems, pendingRepins };
}

export function deriveBaseline() {
  const phases = {};
  for (const file of phaseFiles(DEFAULT_REVISION)) {
    const phase = /^roadmap\/(\d{2})-/.exec(file)[1];
    const pin = PRE_CLOSEOUT_REVISIONS[phase] ?? { rev: DEFAULT_REVISION, note: DEFAULT_NOTE };
    phases[phase] = baselineEntryFor(file, pin, showBlob(pin.rev, file));
  }

  /**
   * Phases that POSTDATE `DEFAULT_REVISION`.
   *
   * The loop above enumerates the roadmap as it stood at the baseline's
   * creation, so a phase added later has no tree there to hash and would be
   * silently absent — while `check-criteria-closeout.mjs` walks the WORKING
   * TREE and demands every phase file be pinned. The two would disagree
   * permanently, and the only way to satisfy both would be to re-pin all
   * twenty-five phases at a fresh revision, which is exactly the laundering
   * this whole anchor exists to prevent.
   *
   * So a phase named in `PRE_CLOSEOUT_REVISIONS` but absent at the default
   * revision is resolved from its OWN pinned commit. It is still an anchor
   * outside the commit under review: forging it means rewriting published
   * history, not editing this file.
   */
  for (const [phase, pin] of Object.entries(PRE_CLOSEOUT_REVISIONS)) {
    if (phases[phase] !== undefined) continue;
    const [file] = phaseFiles(pin.rev).filter((candidate) =>
      new RegExp(`^roadmap/${phase}-`).test(candidate),
    );
    if (file === undefined) {
      throw new Error(`phase ${phase} is pinned at ${pin.rev} but no roadmap file exists there`);
    }
    phases[phase] = baselineEntryFor(file, pin, showBlob(pin.rev, file));
  }
  return {
    schemaVersion: 1,
    generator: "scripts/generate-criteria-baseline.mjs",
    description:
      "sha256 of each roadmap exit criterion's whitespace-normalized wording, read from the phase file as it stood BEFORE any closeout pass annotated it. Frozen: a closeout record's criterion must hash to the entry at its phase and index.",
    phases,
  };
}

const baselinePath = path.join(REPO_ROOT, BASELINE_FILE);
const serialize = (value) => `${JSON.stringify(value, undefined, 2)}\n`;

/** Compares the committed manifest against one freshly derived from git. */
export function diffAgainstCommitted(derived, committed) {
  const problems = [];
  for (const [phase, want] of Object.entries(derived.phases)) {
    const got = committed.phases?.[phase];
    if (got === undefined) {
      problems.push(`phase ${phase}: missing from the committed baseline`);
      continue;
    }
    if (got.sourceRev !== want.sourceRev) {
      problems.push(
        `phase ${phase}: committed sourceRev ${String(got.sourceRev)} is not the pinned ${want.sourceRev} — re-pinning a phase's baseline is a deliberate act and must be reviewed as one`,
      );
      continue;
    }
    if ((got.criteria?.length ?? 0) !== want.criteria.length) {
      problems.push(
        `phase ${phase}: committed baseline has ${String(got.criteria?.length ?? 0)} criteria, ${want.roadmapFile} at ${want.sourceRev} has ${String(want.criteria.length)}`,
      );
    }
    want.criteria.forEach((hash, i) => {
      if (got.criteria?.[i] !== hash) {
        problems.push(
          `phase ${phase} criterion ${String(i + 1)}: committed hash does not re-derive from ${want.sourceRev}:${want.roadmapFile}`,
        );
      }
    });
  }
  for (const phase of Object.keys(committed.phases ?? {})) {
    if (!(phase in derived.phases)) problems.push(`phase ${phase}: not a roadmap phase file`);
  }
  return problems;
}

function main() {
  const derived = deriveBaseline();
  if (process.argv.includes("--write")) {
    writeFileSync(baselinePath, serialize(derived), "utf8");
    const total = Object.values(derived.phases).reduce((n, p) => n + p.criteria.length, 0);
    console.log(
      `generate-criteria-baseline: wrote ${BASELINE_FILE} — ${String(Object.keys(derived.phases).length)} phases, ${String(total)} criteria.`,
    );
    return;
  }
  let committed;
  try {
    committed = JSON.parse(readFileSync(baselinePath, "utf8"));
  } catch (cause) {
    console.error(`generate-criteria-baseline: cannot read ${BASELINE_FILE} — ${String(cause)}`);
    process.exit(1);
  }
  /**
   * Reachability is audited BEFORE the hash diff, and its problems are merged
   * into the same failure. A dead pin makes every hash under it meaningless, so
   * reporting "the hashes re-derive" first would be reassuring the reader about
   * a derivation that is one branch deletion from impossible.
   */
  const reach = auditPinReachability(PRE_CLOSEOUT_REVISIONS);
  for (const owed of reach.pendingRepins) {
    console.warn(`generate-criteria-baseline: OWED — ${owed}`);
  }
  const problems = [...reach.problems, ...diffAgainstCommitted(derived, committed)];
  if (problems.length > 0) {
    for (const problem of problems) console.error(`generate-criteria-baseline: ${problem}`);
    console.error(
      `generate-criteria-baseline: FAIL — ${String(problems.length)} problem(s). The committed baseline does not re-derive from git history.`,
    );
    process.exit(1);
  }
  console.log(
    `generate-criteria-baseline: PASS — every committed baseline hash re-derives from its pinned revision (${String(Object.keys(derived.phases).length)} phases).`,
  );
}

const isMain =
  process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) main();
