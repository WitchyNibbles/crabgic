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
 * - `test` and `artifact` citations must RESOLVE to a regular file inside the
 *   repo root. A fabricated ref is worse than no ref: it reads as evidence.
 *   This pass's own phase-12 defect exists because a cited test file was
 *   deleted and nothing noticed.
 *
 * What this suite deliberately does NOT claim: the validator is a snapshot
 * check, so a criterion and its record rewritten together in one commit are
 * self-consistent and pass. That is caught by reading the roadmap diff, not
 * here.
 * - `ticked` is DERIVED from the classification, never independently asserted:
 *   `UNMET`/`EVIDENCE-NEEDS-CI`/`EVIDENCE-NEEDS-LIVE` can never carry a tick.
 * - `UNMET` must name a defect record that exists on disk; `WORDING-MISMATCH`
 *   must carry the before/after the wording protocol requires.
 */
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  CLOSEOUT_DIR,
  validateAllCloseoutRecords,
  validateCloseoutRecord,
} from "./check-criteria-closeout.mjs";

const REPO_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

const sha256 = (value) => createHash("sha256").update(value, "utf8").digest("hex");

const CRITERION_A = "Widgets are frobnicated before the gate runs.";
const CRITERION_B = "A red check is recorded on a bumped fixture.";

const tmpDirs = [];
afterEach(() => {
  for (const dir of tmpDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/**
 * A throwaway repo root holding one two-criterion phase file and one defect
 * record, so every negative case below differs from the positive one in
 * exactly the field under test.
 */
function fixtureRoot({ tickedA = true, tickedB = false, criterionAText = CRITERION_A } = {}) {
  const root = mkdtempSync(join(tmpdir(), "closeout-meta-"));
  tmpDirs.push(root);
  mkdirSync(join(root, "roadmap"), { recursive: true });
  mkdirSync(join(root, CLOSEOUT_DIR, "defects"), { recursive: true });
  mkdirSync(join(root, "packages", "x", "src"), { recursive: true });
  writeFileSync(
    join(root, "roadmap", "99-fixture-phase.md"),
    [
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
    ].join("\n"),
    "utf8",
  );
  writeFileSync(join(root, CLOSEOUT_DIR, "defects", "99-red-drift-check.md"), "# defect\n", "utf8");
  // Citation targets must RESOLVE, so the fixture repo really contains them.
  writeFileSync(join(root, "packages", "x", "src", "frob.test.ts"), "// fixture\n", "utf8");
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
    writeFileSync(
      join(root, CLOSEOUT_DIR, "defects", "99-red-drift-check.md"),
      "# defect\n",
      "utf8",
    );
    writeFileSync(join(root, "packages", "x", "src", "frob.test.ts"), "// fixture\n", "utf8");
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
    const root = fixtureRoot({ criterionAText: full });
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
    const root = fixtureRoot({ criterionAText: full });
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

  it("leaves non-path citation kinds unresolved — a run id is not a file", () => {
    expect(
      errorsFor((r) => {
        r.criteria[0].citations.push({
          kind: "ci-run",
          ref: "CI / unit-test+coverage, run 30711622357",
          url: "https://github.com/WitchyNibbles/crabgic/actions/runs/30711622357",
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

  it("reports an error rather than passing vacuously when the closeout directory holds no records", () => {
    const root = mkdtempSync(join(tmpdir(), "closeout-empty-"));
    tmpDirs.push(root);
    mkdirSync(join(root, CLOSEOUT_DIR), { recursive: true });
    const { errors } = validateAllCloseoutRecords(root);
    expect(errors.join("\n")).toContain("no phase-NN.json");
  });
});
