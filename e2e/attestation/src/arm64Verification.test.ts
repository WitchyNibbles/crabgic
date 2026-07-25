import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  ARM64_CLOSE_OUT_HEADING,
  ARM64_RUN_RECORD_ENV,
  ARM64_RUN_RECORD_PATH,
  Arm64RunRecordSchema,
  checkArm64Verification,
  extractCloseOutSection,
  readArm64RunRecord,
  readArm64VerificationInput,
  resolveBuiltCommitSha,
  type Arm64RunRecord,
} from "./arm64Verification.js";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

/**
 * The release candidate is this working tree's real HEAD, resolved at run
 * time. A hardcoded literal here goes stale the moment anything is
 * committed, and a stale literal silently turns the "built the release
 * candidate" assertions into assertions about a commit nobody is cutting.
 *
 * Resolved through the MODULE'S OWN tolerant helper rather than a bare
 * `execFileSync`, and at IMPORT time only as a value, never as a hard
 * requirement: this suite must also import inside a `git archive` export
 * with no `.git` at all (the clean-checkout leg of this repo's own
 * definition of done). A raw `git rev-parse` at module scope makes the
 * whole FILE fail to load there — "Tests no tests" — rather than skipping
 * the two cases that genuinely need a repository.
 */
const HEAD_SHA = resolveBuiltCommitSha(REPO_ROOT);
/**
 * Deliberately NOT all-zeros: `0`×40 is the "wrong commit" fixture used by
 * the mismatch tests below, and a placeholder colliding with it would make
 * those tests assert nothing wherever `.git` is absent.
 */
const RC = HEAD_SHA ?? `${"0".repeat(39)}1`;

const CI_WORKFLOW_PATH = join(REPO_ROOT, ".github", "workflows", "ci.yml");
const CI_WORKFLOW = readFileSync(CI_WORKFLOW_PATH, "utf-8");

/**
 * PRODUCER/CONSUMER BINDING.
 *
 * Every fixture below is derived from the REAL `.github/workflows/ci.yml`
 * heredoc rather than hand-written. The previous hand-built fixture carried
 * a "Mirrors exactly what ci.yml writes" docstring that nothing verified, so
 * the producer (the workflow) and the consumer (`Arm64RunRecordSchema`)
 * could drift apart with every test in this file still green — precisely the
 * failure mode a release gate exists to prevent.
 */
function extractCiRunRecordHeredoc(workflow: string): string {
  const lines = workflow.split("\n");
  const start = lines.findIndex((line) => line.includes("arm64-run-record.json <<EOF"));
  if (start === -1) {
    throw new Error("ci.yml no longer writes the ARM64 run record with a `<<EOF` heredoc");
  }
  const end = lines.findIndex((line, index) => index > start && line.trim() === "EOF");
  if (end === -1) throw new Error("ci.yml's ARM64 run-record heredoc is unterminated");
  return lines.slice(start + 1, end).join("\n");
}

/**
 * Realistic stand-ins for the two kinds of expression the heredoc contains:
 * GitHub Actions `${{ … }}` expansions and `$( … )` shell substitutions.
 * An expression this table does not know about is drift, and throws.
 */
const CI_SUBSTITUTIONS: Readonly<Record<string, string>> = {
  "${{ matrix.os }}": "ubuntu-24.04-arm",
  "${{ github.run_id }}": "1234567890",
  "${{ github.run_attempt }}": "1",
  "${{ github.sha }}": RC,
  "${{ job.status }}": "success",
  "$(uname -m)": "aarch64",
  "$(uname -sr)": "Linux 6.8.0-1014-aws",
  "$(node --version)": "v24.18.0",
  "$(date -u +%Y-%m-%dT%H:%M:%SZ)": "2026-07-25T12:00:00Z",
};

const CI_EXPRESSION = /\$\{\{[^}]*\}\}|\$\([^)]*\)/g;

function materializeCiRunRecord(
  body: string,
  substitutions: Readonly<Record<string, string>> = CI_SUBSTITUTIONS,
): string {
  return body.replace(CI_EXPRESSION, (match) => {
    const value = substitutions[match];
    if (value === undefined) {
      throw new Error(
        `ci.yml's ARM64 run record uses ${match}, which this test cannot materialize — ` +
          "producer/consumer drift.",
      );
    }
    return value;
  });
}

const CI_RUN_RECORD_BODY = extractCiRunRecordHeredoc(CI_WORKFLOW);

/** The record `ci.yml` really writes, with realistic values substituted in. */
function runRecord(overrides: Partial<Arm64RunRecord> = {}): Arm64RunRecord {
  return {
    ...Arm64RunRecordSchema.parse(JSON.parse(materializeCiRunRecord(CI_RUN_RECORD_BODY))),
    ...overrides,
  };
}

function ciInput(record: Arm64RunRecord | undefined) {
  return {
    hostArch: "x64",
    releaseCandidateObjectId: RC,
    closeOutSection: "ARM64 is verified by the ubuntu-24.04-arm CI leg.",
    runRecord:
      record === undefined
        ? ({ outcome: "absent" } as const)
        : ({ outcome: "ok", path: "/tmp/arm64-run-record.json", record } as const),
  };
}

describe("extractCloseOutSection", () => {
  it("returns the section body when the heading is present", () => {
    const section = extractCloseOutSection(
      `# t\n\n${ARM64_CLOSE_OUT_HEADING}\n\nmechanism identified\n\n## Next\n\nother`,
    );
    expect(section).toContain("mechanism identified");
    expect(section).not.toContain("other");
  });

  it("returns undefined when the docs never disclose ARM64 status", () => {
    expect(extractCloseOutSection("# t\n\nnothing here")).toBeUndefined();
  });
});

/**
 * These tests read the workflow file itself. They are the only thing
 * stopping `ci.yml` (producer) and `Arm64RunRecordSchema` (consumer) from
 * drifting apart silently.
 */
describe("ci.yml's ARM64 run record is exactly what this check consumes", () => {
  it("materializes into a record the .strict() schema accepts", () => {
    const parsed: unknown = JSON.parse(materializeCiRunRecord(CI_RUN_RECORD_BODY));
    expect(() => Arm64RunRecordSchema.parse(parsed)).not.toThrow();
  });

  it("writes exactly the schema's keys — no missing field, no unknown extra", () => {
    const parsed = JSON.parse(materializeCiRunRecord(CI_RUN_RECORD_BODY)) as Record<
      string,
      unknown
    >;
    expect(Object.keys(parsed).sort()).toEqual(Object.keys(Arm64RunRecordSchema.shape).sort());
  });

  it("records `uname -m` rather than trusting the runner label", () => {
    expect(CI_RUN_RECORD_BODY).toMatch(/"arch":\s*"\$\(uname -m\)"/);
  });

  it("binds the record to the commit the leg actually built", () => {
    expect(CI_RUN_RECORD_BODY).toMatch(/"commitSha":\s*"\$\{\{ github\.sha \}\}"/);
  });

  /**
   * A hardcoded `"conclusion": "success"` makes the consumer's
   * non-success branch dead code: the record would claim success whatever
   * happened. `job.status` is the real, observed state of the ARM64 leg.
   */
  it("derives `conclusion` from real job state, never a literal", () => {
    expect(CI_RUN_RECORD_BODY).toMatch(/"conclusion":\s*"\$\{\{ job\.status \}\}"/);
    expect(CI_RUN_RECORD_BODY).not.toMatch(/"conclusion":\s*"success"/);
  });

  /**
   * `if: success()` would mean a record only ever exists for a green leg,
   * which is how the literal `"success"` stayed technically true while
   * being useless. Recording a red leg is what makes the conclusion field
   * carry information.
   */
  it("records the leg's outcome even when the leg is red", () => {
    const step = CI_WORKFLOW.slice(CI_WORKFLOW.indexOf("- name: record ARM64 build+test evidence"));
    const guard = /^\s+if: (.+)$/m.exec(step)?.[1] ?? "";
    expect(guard).toContain("always()");
    expect(guard).toContain("ubuntu-24.04-arm");
  });

  it("fails loudly on an expression it cannot materialize", () => {
    expect(() => materializeCiRunRecord('{"workflow": "${{ github.actor }}"}')).toThrow(
      /producer\/consumer drift/,
    );
  });
});

/**
 * THE CONSUMER HALF OF THE LOOP.
 *
 * `ci.yml` uploads the `arm64-run-record` artifact; something has to
 * download it, or the check looks for a file no producer ever writes. Until
 * now nothing in this repository did — zero `download-artifact`, zero
 * `gh run download`, zero `workflow_run` triggers — so the item could not
 * pass by ANY route while every test in this file stayed green. These
 * assertions read the real `release-e2e.yml`, against the exported constant
 * rather than a second copy of the string.
 */
describe("release-e2e.yml ingests what ci.yml produces", () => {
  const workflow = readFileSync(
    join(REPO_ROOT, ".github", "workflows", "release-e2e.yml"),
    "utf-8",
  );

  /**
   * Splits the `steps:` sequence into one text block per step, so an
   * assertion can say WHERE something is rather than merely that the file
   * contains the characters somewhere. Steps here are list items at indent
   * 6 (`      - `); everything indented further, plus blank lines, belongs
   * to the step that opened the block.
   *
   * WHY THIS MATTERS RATHER THAN `toContain`. Whole-file substring checks
   * against a workflow that DOCUMENTS its own wiring in comments are
   * vacuous: the comment at the top of `release-e2e.yml` names both
   * `npm run test:e2e:release-evidence` and `EO_RELEASE_GATE_JOURNAL_DIR`,
   * so a `toContain` for either stays green after the real step is
   * reverted to the broken configuration. A `#` comment line can never
   * satisfy an anchored `^ {n}key:`/`^ {n}run:` match, because `#` is its
   * first non-space character.
   *
   * Deliberately hand-rolled and duplicated from
   * `e2e/release/src/releaseWorkflowWiring.test.ts`: the `e2e/*` harnesses
   * are self-contained projects with their own tsconfig and no
   * cross-harness imports, and this repo has no YAML dependency — adding
   * one to assert a handful of lines of CI wiring is not worth the
   * supply-chain surface.
   */
  function stepBlocks(yaml: string): readonly string[] {
    const blocks: string[][] = [];
    let current: string[] | undefined;
    for (const line of yaml.split("\n")) {
      if (/^ {6}- /.test(line)) {
        current = [line];
        blocks.push(current);
        continue;
      }
      if (current === undefined) continue;
      if (line.trim() === "" || /^ {8}/.test(line)) current.push(line);
      else current = undefined;
    }
    return blocks.map((lines) => lines.join("\n"));
  }

  /**
   * The ingest step, located by its `QUERY=` assignment — the one line in
   * the file that can only exist inside that step's `run: |` script.
   *
   * EVERY assertion about the ingest step goes through this, never through
   * the whole file. Demonstrated, not assumed: deleting the entire step and
   * leaving behind only a `#` comment that NAMES `gh run download … -n
   * arm64-run-record` and `EO_ARM64_RUN_RECORD=$RECORD` left the two
   * whole-file `toContain` guards this replaced perfectly green, with the
   * consumer gone. They bound nothing but the presence of some characters
   * somewhere, and the next comment edit would have silenced them.
   */
  function ingestStep(): string {
    const [ingest] = stepBlocks(workflow).filter((block) => /^ +QUERY="head_sha=/m.test(block));
    expect(ingest).toBeDefined();
    return ingest ?? "";
  }

  it("downloads ci.yml's arm64-run-record artifact, in the ingest step itself", () => {
    expect(ingestStep()).toMatch(
      /^ +if ! gh run download "\$RUN_ID" -R "\$GITHUB_REPOSITORY" -n arm64-run-record -D "\$DEST"; then$/m,
    );
  });

  it(`hands it over as $${ARM64_RUN_RECORD_ENV}, the path this check reads`, () => {
    expect(ingestStep()).toMatch(
      new RegExp(`^ +echo "${ARM64_RUN_RECORD_ENV}=\\$RECORD" >> "\\$GITHUB_ENV"$`, "m"),
    );
  });

  /** A cross-workflow artifact download is an Actions API read; `contents` alone cannot do it. */
  it("grants the `actions: read` permission that cross-workflow download requires", () => {
    expect(workflow).toMatch(/^permissions:$/m);
    expect(workflow).toMatch(/^ {2}actions: read$/m);
  });

  /**
   * THE WHOLE SELECTOR IS LOAD-BEARING, not just `head_sha`:
   *
   * - `head_sha=$OBJECT_ID` ties the record to THIS release candidate
   *   rather than to whichever ci.yml run happens to be newest.
   * - `event=push` is the other half of the SHA catch-22: on
   *   `pull_request`, `github.sha` is a SYNTHETIC MERGE COMMIT that exists
   *   in no checkout, so a PR-triggered record names a commit nobody is
   *   cutting and the equality becomes a coincidence rather than a binding.
   * - `status=success` keeps a red run's record from being ingested as
   *   though it were verification.
   *
   * Asserted against the real `QUERY=` shell assignment (indented inside a
   * `run: |` block, so no comment line can match), because dropping any one
   * of the three would otherwise be silent drift.
   */
  it("selects the ci.yml run by the release-candidate object ID, not by recency", () => {
    expect(workflow).toMatch(/^ +QUERY="head_sha=\$OBJECT_ID&event=push&status=success/m);
  });

  /**
   * PREREQUISITE FOR EVERY ITEM'S EVIDENCE, NOT JUST THIS ONE. Without a
   * shared `EO_RELEASE_GATE_JOURNAL_DIR`, each harness writes to an
   * `mkdtemp` directory it deletes on cleanup while the generator reads
   * `DEFAULT_JOURNAL_DIR` — so a CI-generated report links zero evidence
   * for anything, and this check's own emitted verdict is invisible.
   *
   * PLACEMENT IS THE POINT. Setting it on the GENERATOR step alone is the
   * exact broken configuration: the harness step would still write into an
   * `mkdtemp` directory it deletes, and the generator would read an empty
   * one. Job-level `env:` keys sit at indent 6 (job at 2, `env:` at 4);
   * a step's `env:` keys sit at indent 10. So: it must appear at job
   * level, it must appear in NO step, and it must appear exactly once.
   */
  it("gives the harnesses and the generator ONE journal to share, at JOB level", () => {
    expect(workflow).toMatch(/^ {6}EO_RELEASE_GATE_JOURNAL_DIR: \S/m);

    const inSteps = stepBlocks(workflow).filter((block) =>
      /^\s*EO_RELEASE_GATE_JOURNAL_DIR:/m.test(block),
    );
    expect(inSteps).toEqual([]);

    const assignments = workflow
      .split("\n")
      .filter((line) => /^\s*EO_RELEASE_GATE_JOURNAL_DIR: \S/.test(line));
    expect(assignments).toHaveLength(1);
  });

  /**
   * Many test files appending to one journal concurrently is what the
   * `--no-file-parallelism` script variant exists to prevent. Asserted on
   * the harness step's own `run:` LINE: the file's opening comment names
   * the script too, so a whole-file `toContain` would survive a revert to
   * plain `npm run test:e2e` — the broken state — with every test green.
   */
  it("runs the serialized release-evidence variant of the harness suite", () => {
    const harness = stepBlocks(workflow).filter((block) =>
      /^ {8}run: npm run test:e2e/m.test(block),
    );
    expect(harness).toHaveLength(1);
    expect(harness[0]).toMatch(/^ {8}run: npm run test:e2e:release-evidence$/m);
  });
});

describe("checkArm64Verification — native ARM64 host", () => {
  const native = {
    hostArch: "arm64",
    releaseCandidateObjectId: RC,
    closeOutSection: undefined,
    runRecord: { outcome: "absent" } as const,
  };

  it("passes on a green native build+test of the release candidate", () => {
    const result = checkArm64Verification({
      ...native,
      nativeRun: { command: "npm test", exitStatus: 0, commitSha: RC },
    });
    expect(result.verdict).toBe("PASS");
  });

  it("FAILs on a red native build+test", () => {
    const result = checkArm64Verification({
      ...native,
      nativeRun: { command: "npm test", exitStatus: 1, commitSha: RC },
    });
    expect(result.verdict).toBe("FAIL");
    expect(result.reasons.join(" ")).toContain("native ARM64 build+test FAILED");
  });

  it("FAILs when the hardware route was available but not taken", () => {
    const result = checkArm64Verification(native);
    expect(result.verdict).toBe("FAIL");
    expect(result.reasons.join(" ")).toContain("no native build+test was run");
  });

  /**
   * The gap this closes: route 1 previously returned without ever looking
   * at `releaseCandidateObjectId`, so a green build of ANY checkout — a
   * stale branch, a dirty tree, an unrelated commit — satisfied the item.
   */
  it("FAILs when the native run built a commit other than the release candidate", () => {
    const result = checkArm64Verification({
      ...native,
      nativeRun: {
        command: "npm test",
        exitStatus: 0,
        commitSha: "0000000000000000000000000000000000000000",
      },
    });
    expect(result.verdict).toBe("FAIL");
    expect(result.reasons.join(" ")).toContain("verifies a different artifact");
  });

  it("FAILs when the commit the native run built cannot be resolved at all", () => {
    const result = checkArm64Verification({
      ...native,
      nativeRun: { command: "npm test", exitStatus: 0, commitSha: undefined },
    });
    expect(result.verdict).toBe("FAIL");
    expect(result.reasons.join(" ")).toContain("could not be resolved");
  });
});

describe("checkArm64Verification — real-CI route", () => {
  it("passes on a green aarch64 CI run against the release candidate", () => {
    const result = checkArm64Verification(ciInput(runRecord()));
    expect(result.verdict).toBe("PASS");
    expect(result.details.join(" ")).toContain("aarch64");
  });

  /** A documented plan is not a verification — the distinction the release doc itself draws. */
  it("FAILs when no run record exists, however thoroughly the substitute is documented", () => {
    const result = checkArm64Verification(ciInput(undefined));
    expect(result.verdict).toBe("FAIL");
    expect(result.reasons.join(" ")).toContain("not a substitute");
  });

  /**
   * The vector the old filename heuristic could not catch: a runner LABELLED
   * arm that did not actually execute on ARM64 hardware. `uname -m` is
   * recorded precisely so this is checkable.
   */
  it("FAILs when the recorded arch is not really aarch64", () => {
    const result = checkArm64Verification(ciInput(runRecord({ arch: "x86_64" })));
    expect(result.verdict).toBe("FAIL");
    expect(result.reasons.join(" ")).toContain("runner label alone");
  });

  it("FAILs when the recorded run did not succeed", () => {
    const result = checkArm64Verification(ciInput(runRecord({ conclusion: "failure" })));
    expect(result.verdict).toBe("FAIL");
    expect(result.reasons.join(" ")).toContain('concluded "failure"');
  });

  it("FAILs when the run verified a different commit than the release candidate", () => {
    const result = checkArm64Verification(
      ciInput(runRecord({ commitSha: "0000000000000000000000000000000000000000" })),
    );
    expect(result.verdict).toBe("FAIL");
    expect(result.reasons.join(" ")).toContain("verifies a different artifact");
  });

  it("accepts arm64 as an alias for aarch64", () => {
    expect(checkArm64Verification(ciInput(runRecord({ arch: "arm64" }))).verdict).toBe("PASS");
  });

  it("reports every distinct defect on one record", () => {
    const result = checkArm64Verification(
      ciInput(runRecord({ arch: "x86_64", conclusion: "failure", commitSha: "other" })),
    );
    expect(result.reasons).toHaveLength(3);
  });

  /**
   * A record that cannot be read is not evidence — but it must not abort
   * the release-evidence run either. Before this, a drifted record threw a
   * `ZodError` out of `readArm64RunRecord`, taking down the whole
   * attestation suite and with it every OTHER item's evidence.
   */
  it("FAILs, rather than throwing, on a record it cannot read", () => {
    const result = checkArm64Verification({
      hostArch: "x64",
      releaseCandidateObjectId: RC,
      closeOutSection: undefined,
      runRecord: {
        outcome: "malformed",
        path: "/tmp/arm64-run-record.json",
        problem: "arch: Required",
      },
    });
    expect(result.verdict).toBe("FAIL");
    expect(result.reasons.join(" ")).toContain("arch: Required");
    expect(result.reasons.join(" ")).toContain("/tmp/arm64-run-record.json");
  });
});

/*
 * Scratch-state helpers, at module scope because BOTH the
 * `readArm64RunRecord` unit tests and the against-the-real-repository
 * tests need to control `$EO_ARM64_RUN_RECORD` — the latter so their
 * assertions can be exact instead of "one of the three possible outcomes".
 */
const previousRecordEnv = process.env[ARM64_RUN_RECORD_ENV];
const scratch: string[] = [];

afterEach(() => {
  if (previousRecordEnv === undefined) delete process.env[ARM64_RUN_RECORD_ENV];
  else process.env[ARM64_RUN_RECORD_ENV] = previousRecordEnv;
  for (const dir of scratch.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function writeScratchRecord(contents: string): string {
  const dir = mkdtempSync(join(tmpdir(), "eo-arm64-record-"));
  scratch.push(dir);
  const path = join(dir, "arm64-run-record.json");
  writeFileSync(path, contents, "utf-8");
  return path;
}

/**
 * A throwaway repo root with a record archived at the REAL in-repo path,
 * so the fallback branch can be asserted EXACTLY. Pointing the fallback at
 * this checkout instead would force a shape-only assertion (`one of
 * absent|ok|malformed`), which every possible return value satisfies —
 * i.e. no assertion at all.
 */
function scratchRepoRoot(contents?: string): string {
  const root = mkdtempSync(join(tmpdir(), "eo-arm64-repo-"));
  scratch.push(root);
  if (contents !== undefined) {
    const path = join(root, ARM64_RUN_RECORD_PATH);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, contents, "utf-8");
  }
  return root;
}

describe("readArm64RunRecord", () => {
  /**
   * `$EO_ARM64_RUN_RECORD` is how CI hands the DOWNLOADED artifact to this
   * check without committing it — see `release-e2e.yml`'s ingest step. It
   * had no test at all, so the one path CI actually uses was unverified.
   */
  it("reads the record `$EO_ARM64_RUN_RECORD` points at", () => {
    process.env[ARM64_RUN_RECORD_ENV] = writeScratchRecord(
      materializeCiRunRecord(CI_RUN_RECORD_BODY),
    );
    const read = readArm64RunRecord(REPO_ROOT);
    expect(read.outcome).toBe("ok");
    if (read.outcome !== "ok") throw new Error("unreachable");
    expect(read.record.commitSha).toBe(RC);
  });

  it("reports `absent` when the override points at nothing", () => {
    process.env[ARM64_RUN_RECORD_ENV] = join(tmpdir(), "eo-arm64-does-not-exist", "record.json");
    expect(readArm64RunRecord(REPO_ROOT).outcome).toBe("absent");
  });

  it("reports `malformed` on unparseable JSON", () => {
    process.env[ARM64_RUN_RECORD_ENV] = writeScratchRecord("{not json");
    const read = readArm64RunRecord(REPO_ROOT);
    expect(read.outcome).toBe("malformed");
    if (read.outcome !== "malformed") throw new Error("unreachable");
    expect(read.problem).toContain("unparseable");
  });

  it("reports `malformed` on a missing required key", () => {
    const { arch: _dropped, ...withoutArch } = runRecord();
    process.env[ARM64_RUN_RECORD_ENV] = writeScratchRecord(JSON.stringify(withoutArch));
    const read = readArm64RunRecord(REPO_ROOT);
    expect(read.outcome).toBe("malformed");
    if (read.outcome !== "malformed") throw new Error("unreachable");
    expect(read.problem).toContain("arch");
  });

  /** `.strict()` exists so a producer quietly adding a field is caught, not ignored. */
  it("reports `malformed` on an unknown extra key", () => {
    process.env[ARM64_RUN_RECORD_ENV] = writeScratchRecord(
      JSON.stringify({ ...runRecord(), attestedBy: "nobody" }),
    );
    const read = readArm64RunRecord(REPO_ROOT);
    expect(read.outcome).toBe("malformed");
    if (read.outcome !== "malformed") throw new Error("unreachable");
    expect(read.problem).toContain("attestedBy");
  });

  /**
   * An empty `$EO_ARM64_RUN_RECORD` is what a workflow expression for an
   * unset value renders as, and it must mean "no override" rather than
   * "read the file at path ``". Asserted against a repo root this test
   * OWNS, so the expected outcome is exact rather than "whatever the real
   * checkout happens to contain today".
   */
  it("falls back to the in-repo path when the override is empty", () => {
    const root = scratchRepoRoot(materializeCiRunRecord(CI_RUN_RECORD_BODY));
    process.env[ARM64_RUN_RECORD_ENV] = "";
    const read = readArm64RunRecord(root);
    expect(read.outcome).toBe("ok");
    if (read.outcome !== "ok") throw new Error("unreachable");
    expect(read.path).toBe(join(root, ARM64_RUN_RECORD_PATH));
    expect(read.record.commitSha).toBe(RC);
  });

  it("falls back to the in-repo path when the override is absent entirely", () => {
    const root = scratchRepoRoot(materializeCiRunRecord(CI_RUN_RECORD_BODY));
    delete process.env[ARM64_RUN_RECORD_ENV];
    const read = readArm64RunRecord(root);
    expect(read.outcome).toBe("ok");
    if (read.outcome !== "ok") throw new Error("unreachable");
    expect(read.record.arch).toBe("aarch64");
  });

  it("reports `absent` when neither the override nor the in-repo path exists", () => {
    process.env[ARM64_RUN_RECORD_ENV] = "";
    expect(readArm64RunRecord(scratchRepoRoot())).toEqual({ outcome: "absent" });
  });
});

describe("resolveBuiltCommitSha", () => {
  // Skipped, never silently passed, where there is no repository to ask —
  // e.g. inside a `git archive` export of this tree.
  it.skipIf(HEAD_SHA === undefined)("resolves this working tree's HEAD", () => {
    expect(resolveBuiltCommitSha(REPO_ROOT)).toBe(RC);
    expect(RC).toMatch(/^[0-9a-f]{40}$/);
  });

  it("returns undefined where there is no git repository to ask", () => {
    const dir = mkdtempSync(join(tmpdir(), "eo-arm64-nogit-"));
    try {
      expect(resolveBuiltCommitSha(dir)).toBeUndefined();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("against the real repository", () => {
  /**
   * The run-record half is asserted EXACTLY, by controlling
   * `$EO_ARM64_RUN_RECORD`. Asserting `one of absent|ok|malformed` against
   * the real checkout would be a tautology — `Arm64RunRecordRead`'s
   * discriminant has exactly those three members, so every possible return
   * value satisfies it and the assertion can never fail.
   */
  it("reads the compatibility matrix's ARM64 close-out section", () => {
    process.env[ARM64_RUN_RECORD_ENV] = join(tmpdir(), "eo-arm64-does-not-exist", "record.json");
    const input = readArm64VerificationInput(REPO_ROOT, RC, "x64");
    expect(input.hostArch).toBe("x64");
    expect(input.releaseCandidateObjectId).toBe(RC);
    expect(input.closeOutSection).toBeDefined();
    expect(input.nativeRun).toBeUndefined();
    expect(input.runRecord).toEqual({ outcome: "absent" });
  });

  it("threads a real, readable run record through to the check input", () => {
    process.env[ARM64_RUN_RECORD_ENV] = writeScratchRecord(
      materializeCiRunRecord(CI_RUN_RECORD_BODY),
    );
    const input = readArm64VerificationInput(REPO_ROOT, RC, "x64");
    expect(input.runRecord.outcome).toBe("ok");
    if (input.runRecord.outcome !== "ok") throw new Error("unreachable");
    expect(input.runRecord.record.commitSha).toBe(RC);
    // …and the composed check then PASSes on it, which is the only thing
    // that makes the produce->consume loop's closure demonstrable at all.
    expect(checkArm64Verification(input).verdict).toBe("PASS");
  });
});
