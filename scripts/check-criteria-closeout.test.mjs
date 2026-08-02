/**
 * Meta-check for the criteria-closeout index
 * (`docs/evidence/criteria-closeout/phase-NN.json`).
 *
 * `roadmap/README.md`'s completion ledger refuses to tick a checkbox from
 * general confidence: "each checkbox must map to a CI run, journal entry, or
 * committed artifact." The closeout pass applies that rule to itself — every
 * tick lands with a machine-readable citation record. This suite is what stops
 * those records from becoming the very thing they exist to prevent: a
 * self-reported claim nothing checks.
 *
 * The validator's teeth, and why each one is here:
 *
 * - Exactly one `## Exit criteria` section per phase file, located
 *   fence-aware. Everything else here is downstream of that one parse: a
 *   decoy section inserted earlier in the file let the REAL section be
 *   fraudulently ticked and wholly rewritten, with zero errors reported.
 * - `.strict()` at every level. A typo'd key (`citation` for `citations`,
 *   `defect` for `defectRef`) would otherwise be silently dropped and the
 *   record would validate having recorded nothing.
 * - `sha256(text) === textSha256`, plus the roadmap cross-check below. A
 *   criterion whose wording is later weakened to make it tickable is exactly
 *   the failure mode the pass exists to prevent, so the index pins the words.
 * - The roadmap cross-check: every recorded criterion's verbatim text must
 *   still be the PREFIX of a real checkbox item in that phase file's
 *   `## Exit criteria` section, **and must account for that item in full** —
 *   whatever follows has to start with `— **`, the citation annotation. Both
 *   halves are load-bearing: a bare prefix match lets a record pin a harmless
 *   opening substring, and a bare em-dash lead lets it stop at the criterion's
 *   OWN internal em dash, either way leaving a softened tail invisible. The
 *   checkbox's `[x]`/`[ ]` state must match `ticked`, and the counts must
 *   agree. This is what makes the index and the roadmap unable to drift apart
 *   — a box ticked without a record, or a record claiming a tick the file does
 *   not have, both fail here.
 * - The frozen baseline. Every check above compares the record against the
 *   phase file in the SAME commit, so co-editing the checkbox and the record
 *   defeated all of them at once. `criteria-baseline.json` holds one hash per
 *   criterion, taken from the phase file before its closeout, so the anchor
 *   lives outside the commit under review.
 * - `test` and `artifact` citations must RESOLVE to a regular file inside the
 *   repo root — not a symlink (`existsSync`/`statSync` follow links,
 *   `path.resolve` does not), and at a line that exists. A fabricated ref is
 *   worse than no ref: it reads as evidence. This pass's own phase-12 defect
 *   exists because a cited test file was deleted and nothing noticed, and the
 *   pilot's one rebase slid five of its own `file:line` citations.
 * - Every OTHER citation kind resolves as far as it can. A wholly forged phase
 *   closeout — real checkbox texts so every baseline hash matched, all criteria
 *   EVIDENCE-EXISTS, every citation `job 00000000000` / `runs/1` — passed
 *   everything, because ci-run/discharge/journal-export were checked for
 *   nothing at all. `discharge` must now name a real, TICKED criterion in a
 *   real roadmap file; `journal-export` must be a committed file; `ci-run` must
 *   carry this repository's Actions url plus its quote, with the run's actual
 *   existence resolved by `check-citation-runs.mjs` in CI.
 * - Every phase file is pinned, record or no record. Baseline comparisons
 *   used to run only THROUGH a record, so a record-less phase file — phase 23
 *   above all, which is also exempt from the ticks-need-a-record rule — was
 *   checked by nothing, and `discharge` resolves against exactly those files.
 * - `ticked` is DERIVED from the classification, never independently asserted:
 *   `UNMET`/`EVIDENCE-NEEDS-CI`/`EVIDENCE-NEEDS-LIVE` can never carry a tick.
 * - `UNMET` must name a defect record that is a real defect record — quoting
 *   its criterion verbatim, with severity, remedy and S/M/L sizing — not
 *   merely a file that exists; `WORDING-MISMATCH` must carry a before/after
 *   whose `before` is the criterion's own pinned text.
 *
 * What this suite deliberately does NOT claim: the baseline pins a criterion's
 * WORDS, not its meaning, and nothing here reads the roadmap prose around the
 * checkbox. Hollowing out a phase's Test plan while leaving its criteria
 * untouched is caught by reading the roadmap diff, not here.
 */
import { createHash } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  cpSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  BASELINE_FILE,
  CLOSEOUT_DIR,
  PRE_INDEX_TICKED_PHASES,
  parseExitCriteriaCheckboxes,
  validateAllCloseoutRecords,
  validateCloseoutRecord,
} from "./check-criteria-closeout.mjs";

const REPO_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

const sha256 = (value) => createHash("sha256").update(value, "utf8").digest("hex");

const CRITERION_A = "Widgets are frobnicated before the gate runs.";
const CRITERION_B = "A red check is recorded on a bumped fixture.";

/** A 40-line stand-in for a cited test file, so `:12` and `:12-18` are real lines. */
const FIXTURE_TEST_FILE = Array.from(
  { length: 40 },
  (_, i) => `// fixture line ${String(i + 1)}`,
).join("\n");

/**
 * A defect record in the shape the closeout protocol requires: it names the
 * phase, quotes the criterion verbatim, records severity, and proposes a
 * remedy with S/M/L sizing.
 */
const defectRecordFor = (criterionText) =>
  [
    "# Defect 99-red-drift-check",
    "",
    "**Phase:** 99 — fixture (`roadmap/99-fixture-phase.md`, exit criterion 2)",
    "",
    "**Criterion (verbatim):**",
    "",
    `> ${criterionText}`,
    "",
    "**Found:** 2026-08-01, criteria-closeout pass (fixture).",
    "",
    "**Severity:** evidence-channel-only.",
    "",
    "## Gap",
    "",
    "No suite bumps a fixture and asserts the resulting red check.",
    "",
    "### Search trail",
    "",
    "`rg 'bumped fixture' packages/` — no hits at HEAD.",
    "",
    "## Proposed remedy",
    "",
    "Add the bump-and-assert case. **Effort:** S. **Needs CI:** no.",
    "",
  ].join("\n");

const tmpDirs = [];
afterEach(() => {
  for (const dir of tmpDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/**
 * Writes the frozen original-wording manifest a repo root must carry. Defaults
 * to the fixture's own two criteria, so the honest case matches and every
 * baseline negative below differs in exactly the hash under test.
 */
function writeBaseline(root, criteriaTexts = [CRITERION_A, CRITERION_B]) {
  writeFileSync(
    join(root, BASELINE_FILE),
    `${JSON.stringify(
      {
        schemaVersion: 1,
        generator: "scripts/generate-criteria-baseline.mjs",
        description: "fixture baseline",
        phases: {
          99: {
            roadmapFile: "roadmap/99-fixture-phase.md",
            sourceRev: "0".repeat(40),
            sourceNote: "fixture",
            criteria: criteriaTexts.map((text) => sha256(text)),
          },
        },
      },
      undefined,
      2,
    )}\n`,
    "utf8",
  );
}

/**
 * A throwaway repo root holding one two-criterion phase file, its frozen
 * baseline entry, and one defect record, so every negative case below differs
 * from the positive one in exactly the field under test.
 */
function fixtureRoot({
  tickedA = true,
  tickedB = false,
  criterionAText = CRITERION_A,
  baselineTexts,
  phaseFileLines,
} = {}) {
  const root = mkdtempSync(join(tmpdir(), "closeout-meta-"));
  tmpDirs.push(root);
  mkdirSync(join(root, "roadmap"), { recursive: true });
  mkdirSync(join(root, CLOSEOUT_DIR, "defects"), { recursive: true });
  mkdirSync(join(root, "packages", "x", "src"), { recursive: true });
  writeFileSync(
    join(root, "roadmap", "99-fixture-phase.md"),
    (
      phaseFileLines ?? [
        "# Phase 99 — fixture",
        "",
        "## Exit criteria",
        "",
        `- [${tickedA ? "x" : " "}] ${criterionAText} — **Evidence (2026-08-01):** cited.`,
        `- [${tickedB ? "x" : " "}] ${CRITERION_B}`,
        "",
        "## Risks & open questions",
        "",
        "- none",
        "",
      ]
    ).join("\n"),
    "utf8",
  );
  writeBaseline(root, baselineTexts);
  writeFileSync(
    join(root, CLOSEOUT_DIR, "defects", "99-red-drift-check.md"),
    defectRecordFor(CRITERION_B),
    "utf8",
  );
  // Citation targets must RESOLVE, so the fixture repo really contains them.
  writeFileSync(join(root, "packages", "x", "src", "frob.test.ts"), FIXTURE_TEST_FILE, "utf8");
  writeFileSync(join(root, CLOSEOUT_DIR, "closeout-c1.txt"), "transcript\n", "utf8");
  return root;
}

function baseRecord() {
  return {
    schemaVersion: 1,
    phase: "99",
    roadmapFile: "roadmap/99-fixture-phase.md",
    pass: {
      date: "2026-08-01",
      agent: "meta-check fixture",
      headSha: "0".repeat(40),
    },
    criteria: [
      {
        index: 1,
        text: CRITERION_A,
        textSha256: sha256(CRITERION_A),
        classification: "EVIDENCE-EXISTS",
        ticked: true,
        citations: [
          {
            kind: "test",
            ref: "packages/x/src/frob.test.ts:12",
            quotedAssertion: "expect(frobnicated).toBe(true)",
          },
        ],
      },
      {
        index: 2,
        text: CRITERION_B,
        textSha256: sha256(CRITERION_B),
        classification: "UNMET",
        ticked: false,
        citations: [],
        defectRef: `${CLOSEOUT_DIR}/defects/99-red-drift-check.md`,
      },
    ],
  };
}

/** Applies `mutate` to a deep copy of the valid record and returns the resulting errors. */
function errorsFor(mutate, options = {}) {
  const root = options.root ?? fixtureRoot();
  const record = JSON.parse(JSON.stringify(baseRecord()));
  mutate(record);
  return validateCloseoutRecord(record, {
    repoRoot: root,
    fileName: options.fileName ?? "phase-99.json",
  });
}

describe("validateCloseoutRecord — the well-formed record", () => {
  it("accepts a record that matches its roadmap file exactly", () => {
    expect(errorsFor(() => {})).toEqual([]);
  });
});

describe("validateCloseoutRecord — strictness", () => {
  it("rejects an unknown top-level key rather than ignoring it", () => {
    const errors = errorsFor((r) => {
      r.notes = "a field nobody defined";
    });
    expect(errors.join("\n")).toContain("unknown key");
  });

  it("rejects an unknown key inside a criterion (a typo'd `citation` must never pass silently)", () => {
    const errors = errorsFor((r) => {
      r.criteria[0].citation = [{ kind: "test", ref: "x" }];
    });
    expect(errors.join("\n")).toContain("citation");
  });

  it("rejects an unknown key inside a citation", () => {
    const errors = errorsFor((r) => {
      r.criteria[0].citations[0].evidence = "hand-wave";
    });
    expect(errors.join("\n")).toContain("unknown key");
  });

  it("rejects a missing required top-level key", () => {
    const errors = errorsFor((r) => {
      delete r.pass;
    });
    expect(errors.join("\n")).toContain("pass");
  });

  it("rejects a malformed pass.headSha and pass.date", () => {
    expect(
      errorsFor((r) => {
        r.pass.headSha = "4f2b33b";
      }).join("\n"),
    ).toContain("headSha");
    expect(
      errorsFor((r) => {
        r.pass.date = "01-08-2026";
      }).join("\n"),
    ).toContain("date");
  });

  it("rejects a filename that disagrees with the record's own phase", () => {
    expect(errorsFor(() => {}, { fileName: "phase-07.json" }).join("\n")).toContain("phase");
  });

  it("rejects a roadmapFile that does not belong to the declared phase", () => {
    const errors = errorsFor((r) => {
      r.roadmapFile = "roadmap/07-git-control-repo-worktrees.md";
    });
    expect(errors.join("\n")).toContain("roadmapFile");
  });
});

describe("validateCloseoutRecord — the criterion-text pin", () => {
  it("rejects a textSha256 that does not hash the recorded text", () => {
    const errors = errorsFor((r) => {
      r.criteria[0].textSha256 = sha256("something else entirely");
    });
    expect(errors.join("\n")).toContain("textSha256");
  });

  it("rejects a criterion whose text no longer matches the roadmap checkbox (weakened wording)", () => {
    const weakened = "Widgets are frobnicated.";
    const errors = errorsFor((r) => {
      r.criteria[0].text = weakened;
      r.criteria[0].textSha256 = sha256(weakened);
    });
    expect(errors.join("\n")).toContain("does not match");
  });

  /**
   * Adversarial-review finding (must-fix 2): a bare `startsWith` prefix match
   * lets an agent record only the harmless HEAD of a criterion and silently
   * soften its tail. The recorded text has to account for the whole checkbox —
   * anything past it must be the citation annotation, which by protocol starts
   * with an em dash.
   */
  it("rejects a record that pins only a PREFIX of the criterion, leaving the tail unaccounted for", () => {
    const truncated = "Widgets are frobnicated";
    const errors = errorsFor((r) => {
      r.criteria[0].text = truncated;
      r.criteria[0].textSha256 = sha256(truncated);
    });
    expect(errors.join("\n")).toContain("unaccounted");
  });

  it("rejects a checkbox whose tail was softened after the recorded prefix", () => {
    const softened = `${CRITERION_A} Best effort is acceptable.`;
    const root = fixtureRoot({ criterionAText: softened });
    const errors = errorsFor(() => {}, { root });
    expect(errors.join("\n")).toContain("unaccounted");
  });

  it("accepts the exact criterion text with no annotation appended at all", () => {
    const root = mkdtempSync(join(tmpdir(), "closeout-meta-bare-"));
    tmpDirs.push(root);
    mkdirSync(join(root, "roadmap"), { recursive: true });
    mkdirSync(join(root, CLOSEOUT_DIR, "defects"), { recursive: true });
    mkdirSync(join(root, "packages", "x", "src"), { recursive: true });
    writeFileSync(
      join(root, "roadmap", "99-fixture-phase.md"),
      ["## Exit criteria", "", `- [x] ${CRITERION_A}`, `- [ ] ${CRITERION_B}`, ""].join("\n"),
      "utf8",
    );
    writeBaseline(root);
    writeFileSync(
      join(root, CLOSEOUT_DIR, "defects", "99-red-drift-check.md"),
      defectRecordFor(CRITERION_B),
      "utf8",
    );
    writeFileSync(join(root, "packages", "x", "src", "frob.test.ts"), FIXTURE_TEST_FILE, "utf8");
    expect(errorsFor(() => {}, { root })).toEqual([]);
  });

  /**
   * Adversarial-review finding, round 2: the annotation lead was the bare em
   * dash, so a record could stop at a criterion's OWN internal em dash and the
   * genuine remainder was mistaken for the citation annotation. In this repo's
   * house style that tail is very often the evidence-channel clause — 95 of the
   * 211 criteria across the roadmap contain an internal em dash, and clauses
   * like "— suite `install.matrix.test`" or "— named test
   * `engine-conformance-binding.test`, run in the `gates-conformance` CI job"
   * are exactly what an under-pinning record would let escape the hash.
   *
   * Note the checkbox here is UNMODIFIED: the bypass needed no roadmap edit, so
   * nothing showed in any diff. The lead is now "— **", which every real
   * annotation uses and which zero criteria contain (verified across all
   * roadmap phase files).
   */
  it("rejects a record that stops at the criterion's OWN internal em dash, leaving its evidence-channel clause unpinned", () => {
    const full =
      "Installation matrix passes end-to-end: empty dir, dirty repo, rollback — suite `install.matrix.test`.";
    const underPinned = "Installation matrix passes end-to-end: empty dir, dirty repo, rollback";
    const root = fixtureRoot({ criterionAText: full, baselineTexts: [full, CRITERION_B] });
    const errors = errorsFor(
      (r) => {
        r.criteria[0].text = underPinned;
        r.criteria[0].textSha256 = sha256(underPinned);
      },
      { root },
    );
    expect(errors.join("\n")).toContain("unaccounted");
  });

  it("still accepts the same criterion when the record pins it in full", () => {
    const full =
      "Installation matrix passes end-to-end: empty dir, dirty repo, rollback — suite `install.matrix.test`.";
    const root = fixtureRoot({ criterionAText: full, baselineTexts: [full, CRITERION_B] });
    const errors = errorsFor(
      (r) => {
        r.criteria[0].text = full;
        r.criteria[0].textSha256 = sha256(full);
      },
      { root },
    );
    expect(errors).toEqual([]);
  });

  it("rejects a record whose criteria count disagrees with the roadmap's checkbox count", () => {
    const errors = errorsFor((r) => {
      r.criteria.pop();
    });
    expect(errors.join("\n")).toContain("checkbox");
  });

  it("rejects non-contiguous criterion indexes", () => {
    const errors = errorsFor((r) => {
      r.criteria[1].index = 5;
    });
    expect(errors.join("\n")).toContain("index");
  });
});

/**
 * Adversarial-review finding, round 5 — the severe one. Everything the
 * validator knows about a phase file comes through
 * `parseExitCriteriaCheckboxes`, and it read only the FIRST `## Exit criteria`
 * section. So a decoy section, inserted earlier in the file and mirroring the
 * record exactly, made the parser stop looking before it ever reached the real
 * one: a reviewer then fraudulently ticked and wholly rewrote the real
 * section's UNMET criterion and the validator reported ZERO errors. One
 * `split()[1]` defeated the baseline manifest, the wording pin, tick
 * discipline and the two-way cross-check simultaneously, because none of them
 * ever looked at the real section.
 *
 * Reported independently by a second reviewer in its fence-blind form: the
 * heading match was not fenced-code aware either, so a `## Exit criteria` line
 * inside a ``` block could be picked up as the section start. Same root, so
 * they are fixed together — the parser now blanks fenced blocks first, then
 * requires exactly one heading.
 */
describe("parseExitCriteriaCheckboxes — one real section, and only one", () => {
  const decoySection = [
    "## Exit criteria",
    "",
    `- [x] ${CRITERION_A} — **Evidence (2026-08-01):** cited.`,
    `- [ ] ${CRITERION_B}`,
    "",
  ];
  const forgedRealSection = [
    "## Exit criteria",
    "",
    `- [x] ${CRITERION_A} — **Evidence (2026-08-01):** cited.`,
    "- [x] Someone decided this one was fine actually.",
    "",
  ];

  it("rejects a decoy `## Exit criteria` section placed BEFORE the real one", () => {
    const root = fixtureRoot({
      phaseFileLines: [
        "# Phase 99 — fixture",
        "",
        ...decoySection,
        "## Notes",
        "",
        ...forgedRealSection,
        "## Risks & open questions",
        "",
        "- none",
        "",
      ],
    });
    const errors = errorsFor(() => {}, { root });
    expect(errors.join("\n")).toContain("Exit criteria");
    expect(errors.join("\n")).toContain("heading");
  });

  it("rejects a decoy section placed AFTER the real one — the mirror-image attack", () => {
    const root = fixtureRoot({
      phaseFileLines: [
        "# Phase 99 — fixture",
        "",
        ...decoySection,
        "## Notes",
        "",
        "## Exit criteria",
        "",
        "- [x] A second section nobody parses.",
        "",
      ],
    });
    expect(errorsFor(() => {}, { root }).join("\n")).toContain("heading");
  });

  it("rejects checkbox items smuggled outside the `## Exit criteria` section", () => {
    const root = fixtureRoot({
      phaseFileLines: [
        "# Phase 99 — fixture",
        "",
        "## Test plan",
        "",
        "- [x] A criterion-shaped line pretending to be evidence of something.",
        "",
        "## Exit criteria",
        "",
        `- [x] ${CRITERION_A} — **Evidence (2026-08-01):** cited.`,
        `- [ ] ${CRITERION_B}`,
        "",
      ],
    });
    expect(errorsFor(() => {}, { root }).join("\n")).toContain("outside");
  });

  it("ignores a `## Exit criteria` heading and checkbox lines inside a fenced code block", () => {
    const root = fixtureRoot({
      phaseFileLines: [
        "# Phase 99 — fixture",
        "",
        "The closeout format looks like this:",
        "",
        "```markdown",
        "## Exit criteria",
        "",
        "- [x] An illustrative example, not a criterion.",
        "```",
        "",
        "## Exit criteria",
        "",
        `- [x] ${CRITERION_A} — **Evidence (2026-08-01):** cited.`,
        `- [ ] ${CRITERION_B}`,
        "",
        "## Risks & open questions",
        "",
        "- none",
        "",
      ],
    });
    // The fenced heading must be neither the parsed section nor a duplicate.
    expect(errorsFor(() => {}, { root })).toEqual([]);
  });

  /**
   * Adversarial-review finding, round 6: continuation lines required NOT
   * matching `/^\s*-\s/`, which a nested bullet does match — so an indented
   * sub-bullet inside a criterion was silently DROPPED. A reviewer injected
   * "- EXCEPT stop conditions 3-7, which are waived for this phase" inside a
   * ticked criterion and got PASS: arbitrary weakening text, invisible to the
   * sha256 pin and to the `— **` remainder check alike, against an otherwise
   * untouched record.
   *
   * Rejected rather than folded into the item's text. Folding would silently
   * change a criterion's wording — and therefore its baseline hash — the first
   * time someone added a legitimate sub-bullet. Zero of the roadmap's 211
   * criteria carry one today, so requiring the decision to be explicit costs
   * nothing and cannot absorb a waiver by accident.
   */
  it("rejects a nested sub-bullet inside a criterion instead of silently dropping it", () => {
    const root = fixtureRoot({
      phaseFileLines: [
        "## Exit criteria",
        "",
        `- [x] ${CRITERION_A} — **Evidence (2026-08-01):** cited.`,
        "      - EXCEPT stop conditions 3-7, which are waived for this phase.",
        `- [ ] ${CRITERION_B}`,
        "",
      ],
    });
    expect(errorsFor(() => {}, { root }).join("\n")).toContain("sub-bullet");
  });

  it("does not count a `- [x]` inside a fenced block as a criterion", () => {
    const root = fixtureRoot({
      phaseFileLines: [
        "## Exit criteria",
        "",
        `- [x] ${CRITERION_A} — **Evidence (2026-08-01):** cited.`,
        "",
        "```markdown",
        "- [x] A third box that would corrupt the count.",
        "```",
        "",
        `- [ ] ${CRITERION_B}`,
        "",
      ],
    });
    expect(errorsFor(() => {}, { root })).toEqual([]);
  });

  it("still parses a plain, single-section phase file", () => {
    const { items, problems } = parseExitCriteriaCheckboxes(
      ["## Exit criteria", "", "- [x] One.", "- [ ] Two.", "", "## Risks", "", "- none", ""].join(
        "\n",
      ),
    );
    expect(problems).toEqual([]);
    expect(items).toEqual([
      { checked: true, text: "One." },
      { checked: false, text: "Two." },
    ]);
  });
});

describe("validateCloseoutRecord — tick discipline", () => {
  it("rejects a ticked UNMET criterion", () => {
    const errors = errorsFor((r) => {
      r.criteria[1].ticked = true;
      r.criteria[1].citations = [{ kind: "test", ref: "x" }];
    });
    expect(errors.join("\n")).toContain("UNMET");
  });

  it("rejects a ticked EVIDENCE-NEEDS-LIVE criterion (the live batch is owner-gated)", () => {
    const errors = errorsFor((r) => {
      r.criteria[1].classification = "EVIDENCE-NEEDS-LIVE";
      delete r.criteria[1].defectRef;
      r.criteria[1].ticked = true;
      r.criteria[1].citations = [{ kind: "test", ref: "x" }];
    });
    expect(errors.join("\n")).toContain("EVIDENCE-NEEDS-LIVE");
  });

  it("rejects an unticked EVIDENCE-EXISTS criterion", () => {
    const errors = errorsFor((r) => {
      r.criteria[0].ticked = false;
    });
    expect(errors.join("\n")).toContain("EVIDENCE-EXISTS");
  });

  it("rejects a tick with no citation at all", () => {
    const errors = errorsFor((r) => {
      r.criteria[0].citations = [];
    });
    expect(errors.join("\n")).toContain("citation");
  });

  it("rejects an unrecognised citation kind", () => {
    const errors = errorsFor((r) => {
      r.criteria[0].citations[0].kind = "vibes";
    });
    expect(errors.join("\n")).toContain("kind");
  });

  /**
   * Adversarial-review finding (must-fix 3): nothing resolved a citation, so a
   * fabricated `ref` validated. That is not hypothetical — this pass's own
   * phase-12 defect exists BECAUSE a cited test file was deleted and nothing
   * noticed. `test` and `artifact` refs are repo paths and must exist;
   * `ci-run`/`discharge`/`journal-export` are not local paths and stay
   * unresolved.
   */
  it("rejects a `test` citation whose file does not exist in the repository", () => {
    const errors = errorsFor((r) => {
      r.criteria[0].citations[0].ref = "packages/nope/never-existed.test.ts:1";
    });
    expect(errors.join("\n")).toContain("does not exist");
  });

  it("rejects an `artifact` citation whose file does not exist in the repository", () => {
    const errors = errorsFor((r) => {
      r.criteria[0].citations.push({
        kind: "artifact",
        ref: `${CLOSEOUT_DIR}/closeout-never-written.txt`,
      });
    });
    expect(errors.join("\n")).toContain("does not exist");
  });

  it("resolves a `test` ref with a line or line-range suffix stripped", () => {
    expect(
      errorsFor((r) => {
        r.criteria[0].citations[0].ref = "packages/x/src/frob.test.ts:12-18";
      }),
    ).toEqual([]);
    expect(
      errorsFor((r) => {
        r.criteria[0].citations[0].ref = "packages/x/src/frob.test.ts";
      }),
    ).toEqual([]);
  });

  it("accepts an existing `artifact` citation", () => {
    expect(
      errorsFor((r) => {
        r.criteria[0].citations.push({
          kind: "artifact",
          ref: `${CLOSEOUT_DIR}/closeout-c1.txt`,
          quotedAssertion: "the transcript line that matters",
        });
      }),
    ).toEqual([]);
  });

  it("rejects a citation ref that resolves to a directory rather than a file", () => {
    const errors = errorsFor((r) => {
      r.criteria[0].citations[0].ref = "packages";
    });
    expect(errors.join("\n")).toContain("not a file");
  });

  it("rejects a citation ref that escapes the repository root", () => {
    const errors = errorsFor((r) => {
      r.criteria[0].citations[0].ref = "../../etc/passwd";
    });
    expect(errors.join("\n")).toContain("outside the repository");
  });

  it("rejects an absolute citation ref, which is not a repository path", () => {
    const errors = errorsFor((r) => {
      r.criteria[0].citations[0].ref = "/etc/hostname";
    });
    expect(errors.join("\n")).toContain("outside the repository");
  });

  it("does not resolve a ci-run ref as a FILE — a run id is not a path — but still requires its url and quote", () => {
    expect(
      errorsFor((r) => {
        r.criteria[0].citations.push({
          kind: "ci-run",
          ref: "CI / unit-test+coverage, run 30711622357",
          url: "https://github.com/WitchyNibbles/crabgic/actions/runs/30711622357",
          quotedAssertion: "612 test files / 5881 tests",
        });
      }),
    ).toEqual([]);
  });

  it("rejects a record whose ticks disagree with the roadmap file's own checkboxes", () => {
    const root = fixtureRoot({ tickedA: false });
    const errors = errorsFor(() => {}, { root });
    expect(errors.join("\n")).toContain("checkbox");
  });

  it("rejects an unrecognised classification", () => {
    const errors = errorsFor((r) => {
      r.criteria[0].classification = "PROBABLY-FINE";
    });
    expect(errors.join("\n")).toContain("classification");
  });
});

/**
 * Adversarial-review finding, round 4 (found independently by two reviewers):
 * citation resolution used `existsSync`/`statSync`, both of which FOLLOW
 * symlinks, while `path.resolve` never dereferences. So a committed symlink
 * inside the repo pointing anywhere on the machine satisfied "a regular file
 * inside the repository root" — the containment check compared the undereferenced
 * path, and the stat calls happily reported a regular file at the other end.
 * A cited `docs/evidence/phase-05/evil.txt -> /etc/hostname` read as evidence
 * and resolved to something no reviewer of this repository can see.
 */
describe("validateCloseoutRecord — citations may not be symlinks", () => {
  it("rejects a citation that is a symlink pointing outside the repository", () => {
    const root = fixtureRoot();
    mkdirSync(join(root, "docs", "evidence", "phase-99"), { recursive: true });
    symlinkSync("/etc/hostname", join(root, "docs", "evidence", "phase-99", "evil.txt"));
    const errors = errorsFor(
      (r) => {
        r.criteria[0].citations.push({
          kind: "artifact",
          ref: "docs/evidence/phase-99/evil.txt",
        });
      },
      { root },
    );
    expect(errors.join("\n")).toContain("symlink");
  });

  it("rejects a citation reached through a symlinked directory that leaves the repository", () => {
    const root = fixtureRoot();
    const outside = mkdtempSync(join(tmpdir(), "closeout-outside-"));
    tmpDirs.push(outside);
    writeFileSync(join(outside, "planted.txt"), "not in the repo\n", "utf8");
    symlinkSync(outside, join(root, "escape"));
    const errors = errorsFor(
      (r) => {
        r.criteria[0].citations.push({ kind: "artifact", ref: "escape/planted.txt" });
      },
      { root },
    );
    expect(errors.join("\n")).toContain("outside the repository");
  });

  /**
   * Adversarial-review finding, round 6: `node_modules/vitest/package.json:3`
   * validated. `node_modules` exists in EVERY CI job, because `npm ci` runs
   * before the validator does — so the resolution check was certifying
   * something the repository does not carry, which is exactly what its own
   * error message promises it will not do.
   */
  it("rejects a citation resolving into node_modules/ or .git/", () => {
    const root = fixtureRoot();
    mkdirSync(join(root, "node_modules", "vitest"), { recursive: true });
    writeFileSync(join(root, "node_modules", "vitest", "package.json"), "{}\n", "utf8");
    mkdirSync(join(root, ".git"), { recursive: true });
    writeFileSync(join(root, ".git", "config"), "[core]\n", "utf8");
    for (const ref of ["node_modules/vitest/package.json", ".git/config"]) {
      expect(
        errorsFor(
          (r) => {
            r.criteria[0].citations[0].ref = ref;
          },
          { root },
        ).join("\n"),
        ref,
      ).toContain("not content the repository carries");
    }
  });

  /**
   * Adversarial-review finding, round 6: a record citing ITSELF as its own
   * `artifact` evidence resolved as a file and passed. A closeout record is the
   * claim, never the evidence for it.
   */
  it("rejects a citation whose ref is a closeout record — a record is not its own evidence", () => {
    const errors = errorsFor((r) => {
      r.criteria[0].citations.push({
        kind: "artifact",
        ref: `${CLOSEOUT_DIR}/phase-99.json`,
      });
    });
    expect(errors.join("\n")).toContain("closeout record");
  });

  it("rejects a symlink even when it points at a file inside the repository — a citation names a real committed file", () => {
    const root = fixtureRoot();
    symlinkSync(
      join(root, "packages", "x", "src", "frob.test.ts"),
      join(root, CLOSEOUT_DIR, "alias.test.ts"),
    );
    const errors = errorsFor(
      (r) => {
        r.criteria[0].citations[0].ref = `${CLOSEOUT_DIR}/alias.test.ts`;
      },
      { root },
    );
    expect(errors.join("\n")).toContain("symlink");
  });
});

/**
 * Adversarial-review finding, round 4: a `:line` suffix was stripped and then
 * discarded, so `server-name.test.ts:9999` validated clean. This is not a
 * hypothetical drift — the pilot rebased once and FIVE of its `file:line`
 * citations had slid, none catchable because the files still existed, and 17
 * more phases will rebase onto a moving `main`. A line that does not exist
 * cannot be the line the quoted assertion lives on.
 */
/**
 * Adversarial-review finding, round 6 — the most serious of the whole effort.
 * `ci-run`, `discharge` and `journal-export` refs were never resolved against
 * anything at all, so a WHOLLY FORGED phase closeout passed everything: a
 * reviewer generated `phase-13.json` from `roadmap/13`'s verbatim checkbox
 * texts (so every hash matched the frozen baseline), classified all seven
 * `EVIDENCE-EXISTS`, cited each with a fabricated `ci-run`
 * (`job 00000000000`, `runs/1`), ticked the boxes — and got a green validator,
 * a green baseline `--check` and green CI. Unlike `quotedAssertion`, where at
 * least the file and the line have to exist, here NOTHING had to exist.
 */
describe("validateCloseoutRecord — the non-path citation kinds", () => {
  it("rejects a `ci-run` citation with no url to resolve it by", () => {
    const errors = errorsFor((r) => {
      r.criteria[0].citations.push({ kind: "ci-run", ref: "CI / unit-test, job 00000000000" });
    });
    expect(errors.join("\n")).toContain("url");
  });

  it("rejects a `ci-run` url that does not point at this repository's Actions", () => {
    const errors = errorsFor((r) => {
      r.criteria[0].citations.push({
        kind: "ci-run",
        ref: "CI / unit-test, job 00000000000",
        url: "https://github.com/someone-else/elsewhere/actions/runs/1",
        quotedAssertion: "612 test files / 5881 tests",
      });
    });
    expect(errors.join("\n")).toContain("actions/runs");
  });

  it("rejects a `ci-run` citation carrying no quotedAssertion — run logs expire, the quote is the evidence", () => {
    const errors = errorsFor((r) => {
      r.criteria[0].citations.push({
        kind: "ci-run",
        ref: "CI / unit-test, job 00000000000",
        url: "https://github.com/WitchyNibbles/crabgic/actions/runs/30711622357",
      });
    });
    expect(errors.join("\n")).toContain("quotedAssertion");
  });

  it("accepts a well-formed `ci-run` citation, including the /actions/jobs/ form", () => {
    for (const url of [
      "https://github.com/WitchyNibbles/crabgic/actions/runs/30711622357",
      "https://github.com/WitchyNibbles/crabgic/actions/jobs/91419417929",
      "https://github.com/WitchyNibbles/crabgic/actions/runs/30711622357/job/91399985018",
    ]) {
      expect(
        errorsFor((r) => {
          r.criteria[0].citations.push({
            kind: "ci-run",
            ref: "CI / unit-test+coverage (ubuntu-latest), job 91399985018",
            url,
            quotedAssertion: "612 test files / 5881 tests",
          });
        }),
        url,
      ).toEqual([]);
    }
  });

  it("rejects a `journal-export` ref that names no committed file", () => {
    const errors = errorsFor((r) => {
      r.criteria[0].citations.push({
        kind: "journal-export",
        ref: "docs/evidence/never-here.jsonl",
      });
    });
    expect(errors.join("\n")).toContain("does not exist");
  });

  /**
   * `discharge` is the one a phase 09 reviewer showed live: a tick discharging
   * against a COMPLETELY FABRICATED phase-23 criterion passed. The ref names
   * another phase's criterion, and that is fully checkable offline — the file
   * must exist, the quoted wording must really be one of its criteria, and
   * that criterion must actually be TICKED, or nothing has been discharged.
   */
  describe("a `discharge` ref names a real, ticked criterion in another phase", () => {
    const dischargeRoot = () => {
      const root = fixtureRoot();
      writeFileSync(
        join(root, "roadmap", "23-release-hardening.md"),
        [
          "## Exit criteria",
          "",
          "- [x] The release gate scored 15 PASS / 0 FAIL in `final` mode.",
          "- [ ] Something nobody has closed yet, and which is quoted here in full.",
          "",
        ].join("\n"),
        "utf8",
      );
      return root;
    };
    const cite = (ref) => (r) => {
      r.criteria[0].citations.push({ kind: "discharge", ref });
    };

    it("accepts a discharge against a real ticked criterion", () => {
      expect(
        errorsFor(
          cite(
            'roadmap/23-release-hardening.md exit criterion "The release gate scored 15 PASS / 0 FAIL in `final` mode."',
          ),
          { root: dischargeRoot() },
        ),
      ).toEqual([]);
    });

    it("rejects a discharge against a criterion nobody has ticked", () => {
      const errors = errorsFor(
        cite(
          'roadmap/23-release-hardening.md exit criterion "Something nobody has closed yet, and which is quoted here in full."',
        ),
        { root: dischargeRoot() },
      );
      expect(errors.join("\n")).toContain("not ticked");
    });

    it("rejects a discharge against a FABRICATED criterion", () => {
      const errors = errorsFor(
        cite(
          'roadmap/23-release-hardening.md exit criterion "Everything about the release was wonderful, truly."',
        ),
        { root: dischargeRoot() },
      );
      expect(errors.join("\n")).toContain("no criterion");
    });

    it("rejects a discharge naming a roadmap file that does not exist", () => {
      const errors = errorsFor(
        cite(
          'roadmap/77-imaginary.md exit criterion "Anything at all, quoted at a realistic length."',
        ),
        {
          root: dischargeRoot(),
        },
      );
      expect(errors.join("\n")).toContain("77-imaginary.md");
    });

    /**
     * Adversarial-review finding, round 7. `startsWith` with no length floor,
     * no uniqueness test and no self-exclusion meant the real teeth were only
     * "some roadmap file contains some ticked box". All three of these passed
     * against the REAL phase-09 record.
     *
     * The reviewer's proposed remedy — match the full pre-annotation text —
     * was measured against the real corpus and rejects 2 of the 3 genuine
     * discharges, including phase 01, which is already merged on main (its
     * quote omits only a trailing period). So the rule instead requires the
     * quote to IDENTIFY exactly one criterion: long enough not to be an
     * accident, unique within the file, not the record's own phase. What it
     * still cannot judge is relevance — see the README's limits.
     */
    it("rejects a one-character discharge quote", () => {
      const errors = errorsFor(cite('roadmap/23-release-hardening.md exit criterion "T"'), {
        root: dischargeRoot(),
      });
      expect(errors.join("\n")).toContain("too short");
    });

    it("rejects a discharge quote that does not identify a single criterion", () => {
      const root = mkdtempSync(join(tmpdir(), "closeout-ambig-"));
      tmpDirs.push(root);
      const base = fixtureRoot();
      cpSync(base, root, { recursive: true });
      writeFileSync(
        join(root, "roadmap", "23-release-hardening.md"),
        [
          "## Exit criteria",
          "",
          "- [x] The release gate scored well on every one of the first two axes measured.",
          "- [x] The release gate scored well on every one of the second two axes measured.",
          "",
        ].join("\n"),
        "utf8",
      );
      const errors = errorsFor(
        cite(
          'roadmap/23-release-hardening.md exit criterion "The release gate scored well on every one of the"',
        ),
        { root },
      );
      expect(errors.join("\n")).toContain("does not identify a single criterion");
    });

    it("rejects a discharge against the record's OWN phase file — that is circular", () => {
      const errors = errorsFor(
        cite(`roadmap/99-fixture-phase.md exit criterion "${CRITERION_A}"`),
        { root: dischargeRoot() },
      );
      expect(errors.join("\n")).toContain("its own");
    });

    it("accepts a quote that omits only the criterion's trailing period, as merged phase 01 does", () => {
      const root = fixtureRoot();
      writeFileSync(
        join(root, "roadmap", "23-release-hardening.md"),
        "## Exit criteria\n\n- [x] The release gate scored 15 PASS / 0 FAIL in `final` mode.\n",
        "utf8",
      );
      expect(
        errorsFor(
          cite(
            'roadmap/23-release-hardening.md exit criterion "The release gate scored 15 PASS / 0 FAIL in `final` mode"',
          ),
          { root },
        ),
      ).toEqual([]);
    });

    it("rejects a discharge ref that is not in the documented form", () => {
      const errors = errorsFor(cite("phase 23 closed this, trust me"), { root: dischargeRoot() });
      expect(errors.join("\n")).toContain("exit criterion");
    });
  });
});

describe("validateCloseoutRecord — cited lines must exist", () => {
  it("rejects a `test` citation whose line number is past the end of the file", () => {
    const errors = errorsFor((r) => {
      r.criteria[0].citations[0].ref = "packages/x/src/frob.test.ts:9999";
    });
    expect(errors.join("\n")).toContain("9999");
    expect(errors.join("\n")).toContain("40 line");
  });

  it("rejects a line RANGE whose end is past the end of the file", () => {
    const errors = errorsFor((r) => {
      r.criteria[0].citations[0].ref = "packages/x/src/frob.test.ts:38-44";
    });
    expect(errors.join("\n")).toContain("44");
  });

  it("rejects a zero line number — files are 1-based", () => {
    const errors = errorsFor((r) => {
      r.criteria[0].citations[0].ref = "packages/x/src/frob.test.ts:0";
    });
    expect(errors.join("\n")).toContain("line");
  });

  it("rejects an inverted line range", () => {
    const errors = errorsFor((r) => {
      r.criteria[0].citations[0].ref = "packages/x/src/frob.test.ts:18-12";
    });
    expect(errors.join("\n")).toContain("range");
  });

  it("accepts the last line of the file, and a range ending on it", () => {
    expect(
      errorsFor((r) => {
        r.criteria[0].citations[0].ref = "packages/x/src/frob.test.ts:40";
      }),
    ).toEqual([]);
    expect(
      errorsFor((r) => {
        r.criteria[0].citations[0].ref = "packages/x/src/frob.test.ts:35-40";
      }),
    ).toEqual([]);
  });
});

describe("validateCloseoutRecord — defect and wording bookkeeping", () => {
  it("rejects an UNMET criterion with no defectRef", () => {
    const errors = errorsFor((r) => {
      delete r.criteria[1].defectRef;
    });
    expect(errors.join("\n")).toContain("defectRef");
  });

  it("rejects a defectRef naming a file that does not exist", () => {
    const errors = errorsFor((r) => {
      r.criteria[1].defectRef = `${CLOSEOUT_DIR}/defects/99-never-written.md`;
    });
    expect(errors.join("\n")).toContain("does not exist");
  });

  it("rejects a defectRef filed under another phase's prefix", () => {
    const errors = errorsFor((r) => {
      r.criteria[1].defectRef = `${CLOSEOUT_DIR}/defects/04-someone-elses.md`;
    });
    expect(errors.join("\n")).toContain("defectRef");
  });

  it("rejects a defectRef on a criterion that is not UNMET", () => {
    const errors = errorsFor((r) => {
      r.criteria[0].defectRef = `${CLOSEOUT_DIR}/defects/99-red-drift-check.md`;
    });
    expect(errors.join("\n")).toContain("defectRef");
  });

  it("rejects a WORDING-MISMATCH criterion with no wordingCorrection", () => {
    const errors = errorsFor((r) => {
      r.criteria[0].classification = "WORDING-MISMATCH";
    });
    expect(errors.join("\n")).toContain("wordingCorrection");
  });

  it("rejects a wordingCorrection on a criterion that is not WORDING-MISMATCH", () => {
    const errors = errorsFor((r) => {
      r.criteria[0].wordingCorrection = { before: "a", after: "b" };
    });
    expect(errors.join("\n")).toContain("wordingCorrection");
  });

  it("accepts a WORDING-MISMATCH criterion carrying both halves of the correction", () => {
    const errors = errorsFor((r) => {
      r.criteria[0].classification = "WORDING-MISMATCH";
      r.criteria[0].wordingCorrection = { before: CRITERION_A, after: "…as evidenced." };
    });
    expect(errors).toEqual([]);
  });

  /**
   * Adversarial-review finding, round 4: nothing tied `wordingCorrection.before`
   * to the criterion it corrects. A reviewer swapped a real `before` for the
   * strawman "Coverage gate exists." and the validator passed — so the
   * machine-readable audit trail of *what was corrected* was forgeable while the
   * hash-pinned `text` beside it stayed honest, and a correction could be made
   * to look far more modest than it was. `before` is the criterion as it stands
   * (which is why the checkbox keeps its original wording under the protocol),
   * so it must BE `text`.
   */
  it("rejects a wordingCorrection.before that is not the criterion's own pinned text", () => {
    const errors = errorsFor((r) => {
      r.criteria[0].classification = "WORDING-MISMATCH";
      r.criteria[0].wordingCorrection = {
        before: "Coverage gate exists.",
        after: "…as evidenced.",
      };
    });
    expect(errors.join("\n")).toContain("before");
  });

  it("tolerates a re-wrapped wordingCorrection.before — whitespace is not a wording change", () => {
    const errors = errorsFor((r) => {
      r.criteria[0].classification = "WORDING-MISMATCH";
      r.criteria[0].wordingCorrection = {
        before: CRITERION_A.replace(" before ", "\n  before\n  "),
        after: "…as evidenced.",
      };
    });
    expect(errors).toEqual([]);
  });
});

/**
 * Adversarial-review finding, round 4 — the deepest one. Every check above
 * compares a record against the CURRENT phase file, so co-editing the checkbox
 * and the record in one commit defeated all of them at once: a reviewer
 * rewrote phase 03's criterion 2 (three named compiler properties, ≥10k cases)
 * down to "Compiler property suite green in CI.", updated the record's `text`
 * and `textSha256` to match, and the validator passed. The fix is an anchor
 * outside the commit under review: `criteria-baseline.json`, one frozen hash
 * per criterion taken from the phase file BEFORE its closeout, re-derivable
 * from git by `scripts/generate-criteria-baseline.mjs --check`.
 */
describe("validateCloseoutRecord — the frozen original-wording baseline", () => {
  it("rejects a criterion rewritten in the phase file AND its record together", () => {
    const weakened = "Widgets are frobnicated.";
    const root = fixtureRoot({ criterionAText: weakened });
    const errors = errorsFor(
      (r) => {
        r.criteria[0].text = weakened;
        r.criteria[0].textSha256 = sha256(weakened);
      },
      { root },
    );
    // Self-consistent against the roadmap: only the baseline can see this.
    expect(errors.join("\n")).toContain("baseline");
    expect(errors.join("\n")).not.toContain("does not match the verbatim wording");
  });

  it("rejects a record for a phase the baseline does not cover", () => {
    const root = fixtureRoot();
    writeFileSync(
      join(root, BASELINE_FILE),
      `${JSON.stringify({ schemaVersion: 1, phases: {} })}\n`,
      "utf8",
    );
    expect(errorsFor(() => {}, { root }).join("\n")).toContain("baseline");
  });

  it("rejects a record with more criteria than the frozen baseline records for that phase", () => {
    const root = fixtureRoot({ baselineTexts: [CRITERION_A] });
    expect(errorsFor(() => {}, { root }).join("\n")).toContain("baseline");
  });

  it("refuses to validate at all when the baseline manifest is missing", () => {
    const root = fixtureRoot();
    rmSync(join(root, BASELINE_FILE));
    const { errors } = validateAllCloseoutRecords(root);
    expect(errors.join("\n")).toContain(BASELINE_FILE);
  });

  it("refuses to validate when the baseline manifest is not parseable", () => {
    const root = fixtureRoot();
    writeFileSync(join(root, BASELINE_FILE), "{ not json", "utf8");
    const { errors } = validateAllCloseoutRecords(root);
    expect(errors.join("\n")).toContain(BASELINE_FILE);
  });
});

/**
 * Adversarial-review finding, round 4: an `UNMET` criterion's defect record was
 * only required to EXIST. A reviewer truncated a real one to zero bytes and the
 * check stayed green, so "defect filed" could be satisfied by an empty file —
 * which is exactly the aspirational bookkeeping the closeout pass exists to
 * refuse. The record must carry the shape the protocol specifies, and the part
 * that cannot be boilerplate is the verbatim criterion: it ties this file to
 * this box.
 */
describe("validateCloseoutRecord — a defect record must be a defect record", () => {
  const withDefect = (contents) => {
    const root = fixtureRoot();
    writeFileSync(join(root, CLOSEOUT_DIR, "defects", "99-red-drift-check.md"), contents, "utf8");
    return errorsFor(() => {}, { root }).join("\n");
  };

  it("rejects a zero-byte defect record", () => {
    expect(withDefect("")).toContain("empty");
  });

  it("rejects a whitespace-only defect record", () => {
    expect(withDefect("\n\n   \n")).toContain("empty");
  });

  it("rejects a defect record that does not quote its criterion verbatim", () => {
    const wrongQuote = defectRecordFor("Some other criterion entirely.");
    expect(withDefect(wrongQuote)).toContain("verbatim");
  });

  it("rejects a defect record with no severity", () => {
    const noSeverity = defectRecordFor(CRITERION_B).replace(
      "**Severity:** evidence-channel-only.",
      "",
    );
    expect(withDefect(noSeverity)).toContain("Severity");
  });

  it("rejects a defect record whose remedy carries no S/M/L sizing", () => {
    const noSizing = defectRecordFor(CRITERION_B).replace("**Effort:** S. ", "");
    expect(withDefect(noSizing)).toContain("sizing");
  });

  /**
   * Adversarial-review finding, round 5: the `defectRef` check was `existsSync`
   * only, unlike the citation path check beside it, so a DIRECTORY named
   * `NN-slug.md` satisfied "the defect record exists". Worse than passing —
   * reading it threw `EISDIR` and took the whole validator down with it.
   */
  it("rejects a defectRef that resolves to a directory rather than a file", () => {
    const root = fixtureRoot();
    const asDir = join(root, CLOSEOUT_DIR, "defects", "99-red-drift-check.md");
    rmSync(asDir);
    mkdirSync(asDir, { recursive: true });
    writeFileSync(join(asDir, "README.md"), defectRecordFor(CRITERION_B), "utf8");
    expect(errorsFor(() => {}, { root }).join("\n")).toContain("not a file");
  });

  it("rejects a defect record that is a symlink — the same escape citations get", () => {
    const root = fixtureRoot();
    const outside = mkdtempSync(join(tmpdir(), "closeout-outside-"));
    tmpDirs.push(outside);
    writeFileSync(join(outside, "elsewhere.md"), defectRecordFor(CRITERION_B), "utf8");
    rmSync(join(root, CLOSEOUT_DIR, "defects", "99-red-drift-check.md"));
    symlinkSync(
      join(outside, "elsewhere.md"),
      join(root, CLOSEOUT_DIR, "defects", "99-red-drift-check.md"),
    );
    expect(errorsFor(() => {}, { root }).join("\n")).toContain("symlink");
  });

  it("rejects a defect record with no proposed remedy", () => {
    const noRemedy = defectRecordFor(CRITERION_B).replace("## Proposed remedy", "## Musings");
    expect(withDefect(noRemedy)).toContain("remedy");
  });
});

describe("validateAllCloseoutRecords — this repository's own committed records", () => {
  it("every committed phase-NN.json validates against its own roadmap file", () => {
    const { errors, recordCount } = validateAllCloseoutRecords(REPO_ROOT);
    expect(errors).toEqual([]);
    expect(recordCount).toBeGreaterThan(0);
  });

  /**
   * Adversarial-review finding (optional 5): the reverse direction. A fan-out
   * agent that ticks boxes and forgets the JSON was invisible — every check
   * above is anchored on a record that exists. A phase file that CITES its
   * closeout record must therefore have one.
   */
  it("reports a phase file that cites a closeout record which was never written", () => {
    const root = mkdtempSync(join(tmpdir(), "closeout-orphan-"));
    tmpDirs.push(root);
    mkdirSync(join(root, "roadmap"), { recursive: true });
    mkdirSync(join(root, CLOSEOUT_DIR), { recursive: true });
    writeFileSync(
      join(root, "roadmap", "98-orphan-phase.md"),
      [
        "## Exit criteria",
        "",
        `**Closeout pass 2026-08-01:** index: \`${CLOSEOUT_DIR}/phase-98.json\`.`,
        "",
        "- [x] Something was ticked with no record behind it.",
        "",
      ].join("\n"),
      "utf8",
    );
    const { errors } = validateAllCloseoutRecords(root);
    expect(errors.join("\n")).toContain("phase-98.json");
  });

  /**
   * The committed baseline has to cover the whole roadmap, not just the phases
   * closed so far — the 17 phases still queued must find their frozen wording
   * already there when their closeout lands, rather than generating it against
   * whatever the file says by then.
   */
  it("the frozen baseline covers every roadmap phase, at that phase's current checkbox count", () => {
    const baseline = JSON.parse(readFileSync(join(REPO_ROOT, BASELINE_FILE), "utf8"));
    const phaseFiles = readdirSync(join(REPO_ROOT, "roadmap"))
      .filter((name) => /^\d{2}-[a-z0-9-]+\.md$/.test(name))
      .sort();
    expect(phaseFiles.length).toBeGreaterThan(0);
    for (const name of phaseFiles) {
      const phase = name.slice(0, 2);
      const entry = baseline.phases[phase];
      expect(entry, `baseline is missing phase ${phase}`).toBeDefined();
      expect(entry.roadmapFile).toBe(`roadmap/${name}`);
      expect(entry.sourceRev).toMatch(/^[0-9a-f]{40}$/);
      const { items: checkboxes, problems } = parseExitCriteriaCheckboxes(
        readFileSync(join(REPO_ROOT, "roadmap", name), "utf8"),
      );
      expect(problems, `roadmap/${name}: ${problems.join("; ")}`).toEqual([]);
      expect(
        entry.criteria.length,
        `phase ${phase}: baseline records ${String(entry.criteria.length)} criteria, roadmap/${name} now has ${String(checkboxes?.length)}`,
      ).toBe(checkboxes?.length);
    }
    expect(Object.keys(baseline.phases).sort()).toEqual(
      phaseFiles.map((n) => n.slice(0, 2)).sort(),
    );
  });

  /**
   * Found while adversarially reviewing the four fixes above, and demonstrated
   * against the hardened validator: every defense in this file is anchored on a
   * record EXISTING, and the reverse check above keys on the phase file citing
   * one. So the cheapest attack on the whole regime was to skip the paperwork —
   * tick all seven boxes in `roadmap/13`, write no record, cite nothing — and
   * the validator reported PASS. With 17 phases queued behind agents under
   * deadline pressure, "just tick it" is the failure mode most likely to
   * actually happen. A tick now requires a record, full stop.
   */
  it("reports a phase whose boxes are ticked with no closeout record at all", () => {
    const root = mkdtempSync(join(tmpdir(), "closeout-unrecorded-"));
    tmpDirs.push(root);
    mkdirSync(join(root, "roadmap"), { recursive: true });
    mkdirSync(join(root, CLOSEOUT_DIR), { recursive: true });
    writeFileSync(
      join(root, "roadmap", "13-silent-tick.md"),
      ["## Exit criteria", "", "- [x] Ticked with no paperwork whatsoever.", ""].join("\n"),
      "utf8",
    );
    const { errors } = validateAllCloseoutRecords(root);
    expect(errors.join("\n")).toContain("13-silent-tick.md");
    expect(errors.join("\n")).toContain("ticked");
  });

  it("does not report phase 23, whose ticks predate this pass and are evidenced elsewhere", () => {
    const root = mkdtempSync(join(tmpdir(), "closeout-legacy-"));
    tmpDirs.push(root);
    mkdirSync(join(root, "roadmap"), { recursive: true });
    mkdirSync(join(root, CLOSEOUT_DIR), { recursive: true });
    writeFileSync(
      join(root, "roadmap", "23-release-hardening.md"),
      ["## Exit criteria", "", "- [x] Closed against the release gate, pre-index.", ""].join("\n"),
      "utf8",
    );
    const { errors } = validateAllCloseoutRecords(root);
    expect(errors.join("\n")).not.toContain("23-release-hardening.md");
  });

  /**
   * Renaming the heading (`## Exit criteria (final)`) and ticking everything
   * used to pass the VALIDATOR — it was caught only by the unit suite's
   * self-test, in a different CI job. All 25 phase files parse today, so the
   * validator can simply require it.
   */
  it("reports a phase file whose `## Exit criteria` section cannot be found at all", () => {
    const root = mkdtempSync(join(tmpdir(), "closeout-nosection-"));
    tmpDirs.push(root);
    mkdirSync(join(root, "roadmap"), { recursive: true });
    mkdirSync(join(root, CLOSEOUT_DIR), { recursive: true });
    writeFileSync(
      join(root, "roadmap", "13-renamed-heading.md"),
      ["## Exit criteria (final)", "", "- [x] Everything, obviously.", ""].join("\n"),
      "utf8",
    );
    const { errors } = validateAllCloseoutRecords(root);
    expect(errors.join("\n")).toContain("13-renamed-heading.md");
    expect(errors.join("\n")).toContain("Exit criteria");
  });

  /**
   * The exemption list is a standing invitation to grow. Pinning it means
   * adding a phase requires editing this assertion, which a reviewer sees.
   */
  it("grandfathers exactly one phase, and adding another requires editing this test", () => {
    expect(PRE_INDEX_TICKED_PHASES).toEqual(["23"]);
  });

  /**
   * Adversarial-review finding, round 7 (bypass 17). Every baseline comparison
   * ran *through* a record, and `--check` only compares the committed JSON to
   * git — it never reads the working tree. So a phase file with NO record was
   * pinned by nothing at all, and `checkDischargeCitation` resolves against
   * exactly those files. Phase 23 is the worst case: exempt from the
   * ticks-need-a-record rule AND record-less, so its criteria were completely
   * unpinned. A reviewer appended a fabricated ticked box to roadmap/23,
   * repointed phase 09's discharges at it, and got three greens.
   *
   * Measured before enforcing: across the merged tree, 136 criteria in 16
   * record-less phases hash to the baseline exactly, 0 mismatches.
   */
  const auditRoot = ({ extraLine = "", secondFile, dropBaseline98 = false } = {}) => {
    const root = mkdtempSync(join(tmpdir(), "closeout-audit-"));
    tmpDirs.push(root);
    mkdirSync(join(root, "roadmap"), { recursive: true });
    mkdirSync(join(root, CLOSEOUT_DIR), { recursive: true });
    const unrecorded = ["## Exit criteria", "", "- [ ] The scheduler parks a run at its limit."];
    if (extraLine !== "") unrecorded.push(extraLine);
    writeFileSync(join(root, "roadmap", "98-unrecorded.md"), `${unrecorded.join("\n")}\n`, "utf8");
    if (secondFile !== undefined) {
      writeFileSync(
        join(root, "roadmap", secondFile),
        "## Exit criteria\n\n- [x] Something nobody pinned.\n",
        "utf8",
      );
    }
    writeFileSync(
      join(root, BASELINE_FILE),
      `${JSON.stringify({
        schemaVersion: 1,
        phases: dropBaseline98
          ? {}
          : {
              98: {
                roadmapFile: "roadmap/98-unrecorded.md",
                sourceRev: "0".repeat(40),
                criteria: [sha256("The scheduler parks a run at its limit.")],
              },
            },
      })}\n`,
      "utf8",
    );
    return root;
  };

  it("accepts a record-less phase file whose criteria match the frozen baseline", () => {
    const { errors } = validateAllCloseoutRecords(auditRoot());
    expect(errors.join("\n")).not.toContain("98-unrecorded.md");
  });

  it("rejects a fabricated criterion appended to a phase file that has no closeout record", () => {
    const { errors } = validateAllCloseoutRecords(
      auditRoot({ extraLine: "- [x] Everything else is also fine, discharge against this." }),
    );
    expect(errors.join("\n")).toContain("98-unrecorded.md");
    expect(errors.join("\n")).toContain("baseline");
  });

  it("rejects a criterion reworded in a phase file that has no closeout record", () => {
    const root = auditRoot();
    writeFileSync(
      join(root, "roadmap", "98-unrecorded.md"),
      "## Exit criteria\n\n- [x] The scheduler works.\n",
      "utf8",
    );
    expect(validateAllCloseoutRecords(root).errors.join("\n")).toContain("baseline");
  });

  /**
   * The sharper form: touch no existing file at all. The exemption and the
   * baseline both key on the two-digit phase NUMBER, so any `roadmap/NN-*.md`
   * inherited them — a brand-new `roadmap/23-supplement.md` was pinned by
   * nothing and discharges could resolve against it.
   */
  it("rejects a second roadmap file claiming a phase number the baseline already pins", () => {
    // Reproduced on the exempt phase, which is where it actually bit: 23 is
    // skipped by the ticks-need-a-record rule, so a brand-new `roadmap/23-*.md`
    // was checked by nothing whatsoever.
    const root = mkdtempSync(join(tmpdir(), "closeout-supplement-"));
    tmpDirs.push(root);
    mkdirSync(join(root, "roadmap"), { recursive: true });
    mkdirSync(join(root, CLOSEOUT_DIR), { recursive: true });
    const real = "- [x] The release gate scored 15 PASS / 0 FAIL in `final` mode.";
    writeFileSync(
      join(root, "roadmap", "23-release-hardening.md"),
      `## Exit criteria\n\n${real}\n`,
      "utf8",
    );
    writeFileSync(
      join(root, "roadmap", "23-supplement.md"),
      "## Exit criteria\n\n- [x] Everything phase 09 needs is hereby discharged.\n",
      "utf8",
    );
    writeFileSync(
      join(root, BASELINE_FILE),
      `${JSON.stringify({
        schemaVersion: 1,
        phases: {
          23: {
            roadmapFile: "roadmap/23-release-hardening.md",
            sourceRev: "0".repeat(40),
            criteria: [sha256("The release gate scored 15 PASS / 0 FAIL in `final` mode.")],
          },
        },
      })}\n`,
      "utf8",
    );
    const { errors } = validateAllCloseoutRecords(root);
    expect(errors.join("\n")).toContain("23-supplement.md");
    expect(errors.join("\n")).not.toContain("23-release-hardening.md has");
  });

  it("rejects a phase file the baseline does not pin at all", () => {
    const { errors } = validateAllCloseoutRecords(auditRoot({ dropBaseline98: true }));
    expect(errors.join("\n")).toContain("98-unrecorded.md");
  });

  it("reports an error rather than passing vacuously when the closeout directory holds no records", () => {
    const root = mkdtempSync(join(tmpdir(), "closeout-empty-"));
    tmpDirs.push(root);
    mkdirSync(join(root, CLOSEOUT_DIR), { recursive: true });
    const { errors } = validateAllCloseoutRecords(root);
    expect(errors.join("\n")).toContain("no phase-NN.json");
  });
});
