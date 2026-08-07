/**
 * The resolver's own test suite.
 *
 * `docs/verification-playbook.md` is blunt about why this file has to exist:
 * "mutation-test your resolver, or you do not know whether its silence means
 * clean." A pass that skipped it shipped 91 phantom problems from naive
 * apostrophe pairing; a pass that did it caught a fabricated quote in its own
 * draft.
 *
 * There is a second, sharper lesson encoded here. A sibling pass built a scratch
 * resolver over this same corpus, mutation-tested it three ways, passed all
 * three — and still silently missed four real instances of the very class it was
 * censusing, because its ASSOCIATION GRAMMAR (which quote belongs to which
 * marker) dropped every quote that had prose between it and its marker. The
 * mutations all landed on the rules; none landed on the grammar that decides
 * which text the rules ever see. So this suite mutation-tests the grammar
 * first, and the rules second.
 *
 * Every assertion below is written against a synthetic fixture repository, not
 * against the live corpus, for a stated reason: sibling batches are correcting
 * the very citations that would otherwise be the fixtures, and a suite that
 * asserts "phase-17 is still stale" reddens the moment somebody fixes phase-17.
 * The proof that this resolver catches the REAL historical drifts is pinned
 * where it cannot rot — executed against worktrees at the exact merge shas, in
 * `docs/evidence/citation-resolver/red-corpus-batchN.txt`.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  BASELINE_FILE,
  diffAgainstBaseline,
  isOutOfSpanPin,
  isStalePin,
} from "./citation-content/baseline.mjs";
import {
  logReachedTheSuite,
  matchJobLogLine,
  normalizeJobLogLine,
  stripAnsi,
} from "./citation-content/job-log.mjs";
import {
  extractFragments,
  parseDeclarations,
  parseQuotedAssertion,
} from "./citation-content/quoted-assertion.mjs";
import {
  applyMarkerRewrites,
  buildMarkerEdits,
  citationOf,
  main,
  resolveCorpus,
  sweepProse,
} from "./check-citation-content.mjs";

const REPO_ROOT = path.dirname(import.meta.dirname);
const temporaries = [];

afterEach(() => {
  while (temporaries.length > 0) rmSync(temporaries.pop(), { recursive: true, force: true });
});

/** A minimal repository the resolver can be pointed at with `--repo`. */
function makeFixtureRepo(files) {
  const root = mkdtempSync(path.join(tmpdir(), "citation-content-"));
  temporaries.push(root);
  const write = (relative, contents) => {
    const absolute = path.join(root, relative);
    mkdirSync(path.dirname(absolute), { recursive: true });
    writeFileSync(absolute, contents, "utf8");
  };
  write("roadmap/99-fixture.md", "# fixture\n\nNo references here.\n");
  write("docs/evidence/criteria-closeout/defects/99-fixture.md", "# fixture defect\n");
  for (const [relative, contents] of Object.entries(files)) write(relative, contents);
  return { root, write };
}

function record(citations, { criterionIndex = 1, ticked = true } = {}) {
  return JSON.stringify(
    {
      schemaVersion: 1,
      phase: "99",
      criteria: [{ index: criterionIndex, ticked, citations }],
    },
    null,
    2,
  );
}

const GUARD_SOURCE = [
  'import { validateAdfSafeSubset } from "@crabgic/renderer";', // 1
  "", // 2
  "export function guard(candidate: unknown): void {", // 3
  "  const findings = validateAdfSafeSubset(candidate);", // 4
  '  if (findings.length > 0) throw new Error("unsafe");', // 5
  "}", // 6
].join("\n");

function firstFragment(entries) {
  return entries[0].fragments[0].resolution;
}

function resolveFixture(files) {
  const { root } = makeFixtureRepo(files);
  return { root, ...resolveCorpus(root) };
}

describe("association grammar — which quote belongs to which marker", () => {
  const files = { "src/guard.ts": GUARD_SOURCE };

  it("associates a quote with the marker immediately before it", () => {
    const { entries } = resolveFixture({
      ...files,
      "docs/evidence/criteria-closeout/phase-99.json": record([
        {
          kind: "test",
          ref: "src/guard.ts:4",
          quotedAssertion: ":4 'const findings = validateAdfSafeSubset(candidate);'",
        },
      ]),
    });
    expect(firstFragment(entries).status).toBe("OK");
  });

  it("associates a quote with its marker ACROSS intervening prose — the gap a sibling resolver had", () => {
    const { entries } = resolveFixture({
      ...files,
      "docs/evidence/criteria-closeout/phase-99.json": record([
        {
          kind: "test",
          ref: "src/guard.ts:4",
          quotedAssertion:
            ":4 — the guard delegates rather than maintaining a second whitelist, which is the " +
            "whole substance of the criterion, and the delegation reads " +
            "'const findings = validateAdfSafeSubset(candidate);'",
        },
      ]),
    });
    // The distance between marker and quote must not change the verdict.
    expect(firstFragment(entries).status).toBe("OK");
    expect(firstFragment(entries).low).toBe(4);
  });

  it("checks a MARKERLESS quote against the citation's declared span rather than skipping it", () => {
    const clean = resolveFixture({
      ...files,
      "docs/evidence/criteria-closeout/phase-99.json": record([
        {
          kind: "test",
          ref: "src/guard.ts:4",
          quotedAssertion:
            "the delegation reads 'const findings = validateAdfSafeSubset(candidate);'",
        },
      ]),
    });
    expect(firstFragment(clean.entries).status).toBe("OK");

    // MUTATION: move only the ref. A resolver that silently drops unmarked
    // quotes stays green here — which is exactly how four real findings hid.
    const moved = resolveFixture({
      ...files,
      "docs/evidence/criteria-closeout/phase-99.json": record([
        {
          kind: "test",
          ref: "src/guard.ts:1",
          quotedAssertion:
            "the delegation reads 'const findings = validateAdfSafeSubset(candidate);'",
        },
      ]),
    });
    expect(firstFragment(moved.entries).status).toBe("MOVED");
  });

  it("uses a `:NN` written INSIDE the quoted span as that span's marker, and notes it", () => {
    const parsed = parseQuotedAssertion(
      "evidence: ':4 const findings = validateAdfSafeSubset(candidate);'",
      "src/guard.ts",
    );
    expect(parsed.fragments[0].low).toBe(4);
    expect(parsed.fragments[0].text.startsWith("const findings")).toBe(true);
    expect(parsed.fragments[0].notes.join(" ")).toContain("inside the quoted span");
  });

  it("never lets a `:NN` inside a quote become the marker for the NEXT quote", () => {
    const parsed = parseQuotedAssertion(
      ":4 'const findings = validateAdfSafeSubset(candidate);' and :5 was ':99 not a marker' then 'if (findings.length > 0) throw new Error(\"unsafe\");'",
      "src/guard.ts",
    );
    const last = parsed.fragments[parsed.fragments.length - 1];
    expect(last.low).toBe(5);
  });

  it("switches file on a path-qualified marker, and only when it carries a line number", () => {
    const withLine = parseQuotedAssertion(
      "see other.test.ts:12 'expect(x).toBe(1);'",
      "src/guard.ts",
    );
    expect(withLine.fragments[0].filePath).toBe("other.test.ts");
    // A filename merely MENTIONED must not re-point the quotes after it: doing so
    // re-pointed seven phase-00 fragments at a deleted path during development.
    const bare = parseQuotedAssertion(
      "see other.test.ts — :4 'const findings = validateAdfSafeSubset(candidate);'",
      "src/guard.ts",
    );
    expect(bare.fragments[0].filePath).toBe("src/guard.ts");
  });
});

describe("resolver mutations — each must be caught", () => {
  const files = { "src/guard.ts": GUARD_SOURCE };
  const cite = (quotedAssertion, ref = "src/guard.ts:4") => ({
    ...files,
    "docs/evidence/criteria-closeout/phase-99.json": record([
      { kind: "test", ref, quotedAssertion },
    ]),
  });

  it("M1 falsified quote text → ABSENT", () => {
    const { entries } = resolveFixture(
      cite(":4 'const findings = NEVER_IN_ANY_FILE_XYZZY(candidate);'"),
    );
    expect(firstFragment(entries).status).toBe("ABSENT");
  });

  it("M2 every marker shifted +10 (an insertion above) → MOVED, with the true line reported", () => {
    const { entries } = resolveFixture(
      cite(":14 'const findings = validateAdfSafeSubset(candidate);'", "src/guard.ts:14"),
    );
    const resolution = firstFragment(entries);
    expect(resolution.status).toBe("MOVED");
    expect(resolution.occurrences).toEqual([[4, 4]]);
  });

  it("M3 marker past EOF → PAST-EOF", () => {
    const { entries } = resolveFixture(
      cite(":9999 'THIS TEXT IS NOWHERE IN THE FIXTURE FILE AT ALL'", "src/guard.ts:6"),
    );
    expect(firstFragment(entries).status).toBe("PAST-EOF");
  });

  it("M4 possessive apostrophes between quotes produce no phantom fragments (the 91-phantom regression)", () => {
    const { fragments } = extractFragments(
      "the pass's own draft claimed :4 'const findings = validateAdfSafeSubset(candidate);' " +
        "because the reviewer's note said the guard's delegation was the point",
    );
    expect(fragments).toHaveLength(1);
    expect(fragments[0].text).toBe("const findings = validateAdfSafeSubset(candidate);");
  });

  it("M5 right text, wrong file → the quote does not resolve against the file it was moved to", () => {
    const { entries } = resolveFixture({
      "src/guard.ts": GUARD_SOURCE,
      "src/other.ts": "export const unrelated = 1;\n",
      "docs/evidence/criteria-closeout/phase-99.json": record([
        {
          kind: "test",
          ref: "src/other.ts:1",
          quotedAssertion: ":1 'const findings = validateAdfSafeSubset(candidate);'",
        },
      ]),
    });
    expect(firstFragment(entries).status).toBe("ABSENT");
  });

  it("M6 a baseline tampered to claim OK for a moved citation does not buy silence — --check recomputes", () => {
    const { root } = makeFixtureRepo(
      cite(":14 'const findings = validateAdfSafeSubset(candidate);'", "src/guard.ts:6"),
    );
    expect(main(["--seed", "--repo", root])).toBe(0);
    expect(main(["--check", "--repo", root])).toBe(0);

    const baselinePath = path.join(root, BASELINE_FILE);
    const baseline = JSON.parse(readFileSync(baselinePath, "utf8"));
    const key = Object.keys(baseline.citations)[0];
    expect(baseline.citations[key].pins[0]).toContain("MOVED");
    // Forge the pin: claim the citation resolves exactly where it says it does.
    baseline.citations[key].pins[0] = "OK/collapsed@14";
    writeFileSync(baselinePath, `${JSON.stringify(baseline, null, 2)}\n`, "utf8");
    expect(main(["--check", "--repo", root])).toBe(1);
  });
});

describe("trust controls — these are what keep the check from crying wolf", () => {
  it("a wrapped assertion joined onto one line matches at level 1 (the `:53` negative control)", () => {
    const { entries } = resolveFixture({
      "src/wrapped.test.ts": [
        'it("refuses", () => {', // 1
        "  expect(", // 2
        "    lint(candidate, DEFAULT_POLICY),", // 3
        "  ).toBe(false);", // 4
        "});", // 5
      ].join("\n"),
      "docs/evidence/criteria-closeout/phase-99.json": record([
        {
          kind: "test",
          ref: "src/wrapped.test.ts:2-4",
          quotedAssertion: ":2-4 'expect( lint(candidate, DEFAULT_POLICY), ).toBe(false);'",
        },
      ]),
    });
    const resolution = firstFragment(entries);
    expect(resolution.status).toBe("OK");
    expect(resolution.level).toBe("collapsed");
  });

  it("a prettier trailing comma before `)` matches at level 3, not as a defect", () => {
    const { entries } = resolveFixture({
      "src/wrapped.test.ts": ["expect(", "  runLifecycle(run),", ").toBe(true);"].join("\n"),
      "docs/evidence/criteria-closeout/phase-99.json": record([
        {
          kind: "test",
          ref: "src/wrapped.test.ts:1-3",
          quotedAssertion: ":1-3 'expect(runLifecycle(run)).toBe(true);'",
        },
      ]),
    });
    const resolution = firstFragment(entries);
    expect(resolution.status).toBe("OK");
    expect(resolution.level).toBe("code");
  });

  it("markdown emphasis in a `.md` target matches at level 4, not as a defect", () => {
    const { entries } = resolveFixture({
      "README.md": ["# Fixture", "", "The **ARM64** target is _untested_ on real hardware."].join(
        "\n",
      ),
      "docs/evidence/criteria-closeout/phase-99.json": record([
        {
          kind: "artifact",
          ref: "README.md:3",
          quotedAssertion: ":3 'The ARM64 target is untested on real hardware.'",
        },
      ]),
    });
    const resolution = firstFragment(entries);
    expect(resolution.status).toBe("OK");
    expect(resolution.level).toBe("prose");
  });

  it("repeat text in a frozen report is position-unverified, NOT moved — and the occurrence scan is uncapped", () => {
    const lines = [];
    for (let i = 0; i < 60; i += 1) lines.push(`  { "id": "item-${String(i)}", "exitStatus": 0 },`);
    const { entries } = resolveFixture({
      "docs/evidence/phase-99/report.json": lines.join("\n"),
      "docs/evidence/criteria-closeout/phase-99.json": record([
        {
          kind: "artifact",
          ref: "docs/evidence/phase-99/report.json:55",
          quotedAssertion: ":55 '\"exitStatus\": 0'",
        },
      ]),
    });
    const resolution = firstFragment(entries);
    // A scan capped at 50 occurrences would never see line 55 and would report MOVED.
    expect(resolution.status).toBe("OK");
    expect(resolution.repeat).toBe(true);
    expect(resolution.occurrences.length).toBe(60);
  });

  it("a fragment outside its citation's declared span is a flag on the pin, not a stale status", () => {
    const { entries } = resolveFixture({
      "src/guard.ts": GUARD_SOURCE,
      "docs/evidence/criteria-closeout/phase-99.json": record([
        {
          kind: "test",
          ref: "src/guard.ts:4",
          quotedAssertion:
            ":4 'const findings = validateAdfSafeSubset(candidate);' and :5 'if (findings.length > 0) throw new Error(\"unsafe\");'",
        },
      ]),
    });
    const outside = entries[0].fragments[1].resolution;
    expect(outside.status).toBe("OK");
    expect(outside.outsideSpan).toBe(true);
    expect(entries[0].pins[1]).toContain("!span");
    expect(isStalePin(entries[0].pins[1])).toBe(false);
    expect(isOutOfSpanPin(entries[0].pins[1])).toBe(true);
  });

  it("byte-drift in a committed docs/evidence artifact is its own hard class (reverse probe)", () => {
    const files = {
      "docs/evidence/phase-99/transcript.txt": [
        "$ npm test",
        "exit=0",
        "625 files / 6216 tests",
      ].join("\n"),
      "docs/evidence/criteria-closeout/phase-99.json": record([
        {
          kind: "artifact",
          ref: "docs/evidence/phase-99/transcript.txt:3",
          quotedAssertion: ":3 '625 files / 6216 tests'",
        },
      ]),
    };
    const { root, write } = makeFixtureRepo(files);
    expect(main(["--seed", "--repo", root])).toBe(0);
    expect(main(["--check", "--repo", root])).toBe(0);
    // Reverse probe: edit the committed evidence, not the record.
    write(
      "docs/evidence/phase-99/transcript.txt",
      ["$ npm test", "exit=0", "", "625 files / 6216 tests"].join("\n"),
    );
    const { entries } = resolveCorpus(root);
    const baseline = JSON.parse(readFileSync(path.join(root, BASELINE_FILE), "utf8"));
    const divergences = diffAgainstBaseline(entries, baseline);
    expect(divergences.map((divergence) => divergence.class)).toEqual(["frozen"]);
    expect(main(["--check", "--repo", root])).toBe(1);
  });
});

describe("the ratchet", () => {
  const drifted = (refLine) => ({
    "src/guard.ts": GUARD_SOURCE,
    "docs/evidence/criteria-closeout/phase-99.json": record([
      {
        kind: "test",
        ref: `src/guard.ts:${String(refLine)}`,
        quotedAssertion: `:${String(refLine)} 'const findings = validateAdfSafeSubset(candidate);'`,
      },
    ]),
  });

  it("goes red on the PR that moves lines under a merged citation, and green again once the baseline records it", () => {
    const { root, write } = makeFixtureRepo(drifted(4));
    expect(main(["--seed", "--repo", root])).toBe(0);
    expect(main(["--check", "--repo", root])).toBe(0);
    // Simulate the measured failure mode: a later PR inserts lines above.
    write("src/guard.ts", `// inserted\n// by a later PR\n${GUARD_SOURCE}`);
    expect(main(["--check", "--repo", root])).toBe(1);
    expect(main(["--update-baseline", "--repo", root])).toBe(0);
    expect(main(["--check", "--repo", root])).toBe(0);
    const baseline = JSON.parse(readFileSync(path.join(root, BASELINE_FILE), "utf8"));
    expect(Object.values(baseline.citations)[0].pins[0]).toContain("MOVED");
  });

  it("refuses to regenerate a baseline that would bless a new citation pointing at the wrong line", () => {
    const { root, write } = makeFixtureRepo(drifted(4));
    expect(main(["--seed", "--repo", root])).toBe(0);
    // A NEW citation (different ref, so a new key) that does not resolve where it claims.
    write(
      "docs/evidence/criteria-closeout/phase-99.json",
      record([
        {
          kind: "test",
          ref: "src/guard.ts:1",
          quotedAssertion: ":1 'const findings = validateAdfSafeSubset(candidate);'",
        },
      ]),
    );
    expect(main(["--check", "--repo", root])).toBe(1);
    expect(main(["--update-baseline", "--repo", root])).toBe(1);
    expect(main(["--update-baseline", "--repo", root, "--allow-unanchored"])).toBe(0);
  });

  it("cannot be bypassed by deleting the baseline — first-seeding needs --seed", () => {
    const { root, write } = makeFixtureRepo(drifted(4));
    expect(main(["--seed", "--repo", root])).toBe(0);
    write(
      "docs/evidence/criteria-closeout/phase-99.json",
      record([
        {
          kind: "test",
          ref: "src/guard.ts:1",
          quotedAssertion: ":1 'const findings = validateAdfSafeSubset(candidate);'",
        },
      ]),
    );
    expect(main(["--update-baseline", "--repo", root])).toBe(1);
    // --seed cannot be used to sidestep that refusal either.
    expect(main(["--seed", "--repo", root])).toBe(1);
    // The bypass proper: delete the baseline and regenerate. Refused, nothing written.
    const baselinePath = path.join(root, BASELINE_FILE);
    const before = readFileSync(baselinePath, "utf8");
    rmSync(baselinePath);
    expect(main(["--update-baseline", "--repo", root])).toBe(1);
    expect(existsSync(baselinePath)).toBe(false);
    writeFileSync(baselinePath, before, "utf8");
    expect(main(["--check", "--repo", root])).toBe(1);
  });

  it("records --allow-unanchored in the baseline itself, so the diff confesses", () => {
    const { root, write } = makeFixtureRepo(drifted(4));
    expect(main(["--seed", "--repo", root])).toBe(0);
    expect(JSON.parse(readFileSync(path.join(root, BASELINE_FILE), "utf8")).allowUnanchored).toBe(
      undefined,
    );
    write(
      "docs/evidence/criteria-closeout/phase-99.json",
      record([
        {
          kind: "test",
          ref: "src/guard.ts:1",
          quotedAssertion: ":1 'const findings = validateAdfSafeSubset(candidate);'",
        },
      ]),
    );
    expect(main(["--update-baseline", "--repo", root, "--allow-unanchored"])).toBe(0);
    const baseline = JSON.parse(readFileSync(path.join(root, BASELINE_FILE), "utf8"));
    expect(baseline.allowUnanchored).toBe(true);
    expect(baseline.unanchoredAccepted).toBe(1);
    expect(baseline.allowUnanchoredWarning).toContain("do NOT resolve");
  });

  it("seeds known-stale legacy drift instead of failing on it — zero day-one noise", () => {
    const { root } = makeFixtureRepo(drifted(1));
    expect(main(["--seed", "--repo", root])).toBe(0);
    expect(main(["--check", "--repo", root])).toBe(0);
    const baseline = JSON.parse(readFileSync(path.join(root, BASELINE_FILE), "utf8"));
    expect(baseline.counts.seededStale).toBe(1);
  });
});

describe("same-ref citations in one criterion", () => {
  const twoCitations = {
    "src/x.ts": ["line one ALPHA();", "line two BETA();", "line three GAMMA();"].join("\n"),
    "docs/evidence/criteria-closeout/phase-99.json": record([
      { kind: "ci-run", ref: "CI / unit-test, job 1", quotedAssertion: "'not a file quote'" },
      { kind: "test", ref: "src/x.ts:3", quotedAssertion: ":3 'line one ALPHA();'" },
      { kind: "test", ref: "src/x.ts:3", quotedAssertion: ":3 'line two BETA();'" },
    ]),
  };

  it("selects the right citation past an interleaved ci-run, by ordinal not by ref", () => {
    // Selecting by `ref` alone returned citation 1 for BOTH entries. That gave
    // them the same edit hash (an edit to the second read as no edit), and in
    // `--fix` it applied citation 2's edit at citation 2's offset into citation
    // 1's string — corrupting the record and reporting success.
    const { root, entries } = resolveFixture(twoCitations);
    expect(entries).toHaveLength(2);
    expect(entries[0].ordinal).toBe(0);
    expect(entries[1].ordinal).toBe(1);
    expect(entries[0].quotedAssertionHash).not.toBe(entries[1].quotedAssertionHash);
    const parsed = JSON.parse(
      readFileSync(path.join(root, "docs/evidence/criteria-closeout/phase-99.json"), "utf8"),
    );
    expect(citationOf(parsed, entries[0]).quotedAssertion).toContain("ALPHA");
    expect(citationOf(parsed, entries[1]).quotedAssertion).toContain("BETA");
  });

  it("builds each citation's edits against its OWN string", () => {
    const { root, entries } = resolveFixture(twoCitations);
    const parsed = JSON.parse(
      readFileSync(path.join(root, "docs/evidence/criteria-closeout/phase-99.json"), "utf8"),
    );
    for (const entry of entries) {
      const citation = citationOf(parsed, entry);
      const rewritten = applyMarkerRewrites(citation.quotedAssertion, buildMarkerEdits(entry));
      // Every rewrite lands on a marker; no fragment text is ever mangled.
      expect(rewritten).toMatch(/^:\d+ '[^']+'$/);
    }
    expect(
      applyMarkerRewrites(
        citationOf(parsed, entries[0]).quotedAssertion,
        buildMarkerEdits(entries[0]),
      ),
    ).toBe(":1 'line one ALPHA();'");
    expect(
      applyMarkerRewrites(
        citationOf(parsed, entries[1]).quotedAssertion,
        buildMarkerEdits(entries[1]),
      ),
    ).toBe(":2 'line two BETA();'");
  });
});

describe("the declaration vocabulary", () => {
  it("reads a declaration head and ignores prose that merely contains the words", () => {
    expect(parseDeclarations("JOINED, NORMALIZED: :4 'x'")).toEqual(["JOINED", "NORMALIZED"]);
    expect(parseDeclarations("the record NORMALIZED the quote: :4 'x'")).toEqual([]);
  });

  it("records the declaration in the baseline, and never waives anchoring", () => {
    const { root } = makeFixtureRepo({
      "src/guard.ts": GUARD_SOURCE,
      "docs/evidence/criteria-closeout/phase-99.json": record([
        {
          kind: "test",
          ref: "src/guard.ts:1",
          quotedAssertion: "JOINED: :1 'const findings = validateAdfSafeSubset(candidate);'",
        },
      ]),
    });
    expect(main(["--seed", "--repo", root])).toBe(0);
    const baseline = JSON.parse(readFileSync(path.join(root, BASELINE_FILE), "utf8"));
    const pinned = Object.values(baseline.citations)[0];
    expect(pinned.declared).toEqual(["JOINED"]);
    // Declared or not, the quote is at :4 and the citation says :1.
    expect(pinned.pins[0]).toContain("MOVED");
  });
});

describe("the prose lane", () => {
  it("fails a reference past a file's end", () => {
    const { root } = makeFixtureRepo({
      "src/guard.ts": GUARD_SOURCE,
      "roadmap/99-fixture.md": "See `src/guard.ts:900` for the guard.\n",
    });
    const rows = sweepProse(root);
    expect(rows.filter((row) => row.tier === "past-eof")).toHaveLength(1);
  });

  it("reports, never fails, a reference that names no single file", () => {
    const { root } = makeFixtureRepo({
      "src/guard.ts": GUARD_SOURCE,
      "src/nested/guard.ts": GUARD_SOURCE,
      "roadmap/99-fixture.md": "See `guard.ts:2`.\n",
    });
    const rows = sweepProse(root);
    expect(rows.map((row) => row.tier)).toEqual(["unresolved"]);
  });

  it("FAILS on a deleted repo-rooted path — the case the lane exists for", () => {
    // Measured toothless once: deleting a file cited twice in a defect record
    // left the check green, the references silently degrading to
    // "bare-basename (unchecked)", a counter nothing gates on.
    const { root, write } = makeFixtureRepo({
      "packages/thing/src/gone.ts": "export const a = 1;\n",
      "docs/evidence/criteria-closeout/defects/99-fixture.md":
        "Measured at `packages/thing/src/gone.ts:1`.\n",
    });
    expect(sweepProse(root).map((row) => row.tier)).toEqual(["ok"]);
    rmSync(path.join(root, "packages/thing/src/gone.ts"));
    const after = sweepProse(root);
    expect(after.map((row) => row.tier)).toEqual(["missing"]);
    expect(main(["--seed", "--repo", root])).toBe(0);
    expect(main(["--check", "--repo", root])).toBe(1);
    // Control: restoring the file returns the lane to silence, so the failure
    // is about the deletion and not about the reference's shape.
    write("packages/thing/src/gone.ts", "export const a = 1;\n");
    expect(main(["--check", "--repo", root])).toBe(0);
  });

  it("does not let a gitignored build directory make a fragment look repo-rooted", () => {
    // Found by merging three sibling PRs in: a worktree where anyone had run
    // `npm test` has a generated `coverage/` directory, which made the
    // long-standing reference `coverage/ratchet-store.ts:138` (written relative
    // to `packages/gates/src/`) look repo-rooted and fail. A verdict that
    // depends on whether the tests have been run yet is not a verdict.
    const { root } = makeFixtureRepo({
      "roadmap/99-fixture.md": "See `coverage/ratchet-store.ts:138`.\n",
    });
    mkdirSync(path.join(root, "coverage"), { recursive: true });
    writeFileSync(path.join(root, "coverage", "index.html"), "<html></html>", "utf8");
    expect(sweepProse(root).map((row) => row.tier)).toEqual(["unresolved"]);
  });

  it("keeps a package-relative fragment reported, not failed — it names no root", () => {
    const { root } = makeFixtureRepo({
      "docs/evidence/criteria-closeout/defects/99-fixture.md": "See `store/append-entry.ts:145`.\n",
    });
    expect(sweepProse(root).map((row) => row.tier)).toEqual(["unresolved"]);
  });

  it("ignores references inside fenced blocks — those are examples, not claims", () => {
    const { root } = makeFixtureRepo({
      "roadmap/99-fixture.md": ["```", "src/nowhere.ts:900", "```", ""].join("\n"),
    });
    expect(sweepProse(root)).toHaveLength(0);
  });

  it("the live corpus has no unresolvable or past-EOF prose reference", () => {
    const rows = sweepProse(REPO_ROOT);
    expect(rows.filter((row) => row.tier === "past-eof")).toEqual([]);
    expect(rows.filter((row) => row.tier === "ok").length).toBeGreaterThan(500);
  });
});

describe("job-log normalization", () => {
  const ESC = String.fromCharCode(27);
  const raw = `2026-08-06T10:00:00.1234567Z ${ESC}[32m✓${ESC}[39m  src/corpus.test.ts (34 tests) 24ms`;

  it("strips ANSI — a raw byte-compare fails on every colored vitest line", () => {
    expect(stripAnsi(raw)).not.toContain(ESC);
    expect(raw.includes("✓  src/corpus.test.ts")).toBe(false);
  });

  it("the one-space form is the correct normalization", () => {
    expect(normalizeJobLogLine(raw)).toBe("✓  src/corpus.test.ts (34 tests) 24ms");
    expect(matchJobLogLine(raw, "✓  src/corpus.test.ts (34 tests) 24ms")).toBe("one-space");
  });

  it("the two-space form twelve merged records use is grandfathered, not failed", () => {
    expect(matchJobLogLine(raw, " ✓  src/corpus.test.ts")).toBe("two-space");
  });

  it("a wrong quote still fails", () => {
    expect(matchJobLogLine(raw, "✓  src/corpus.test.ts (35 tests) 24ms")).toBe(null);
  });

  it("distinguishes a job that never reached the suite from a wrong quote", () => {
    // Measured live: the ubuntu-24.04-arm leg failed repo-wide during `Set up
    // job`, so its log has no per-file test line at all. Comparing quotes
    // against it would report every citation in the corpus as fabricated.
    const setupFailure = [
      "2026-08-06T10:00:00.0000000Z ##[group]Run actions/checkout@v4",
      `2026-08-06T10:00:01.0000000Z ${ESC}[31mFailed to resolve action download info. Error: Service Unavailable${ESC}[39m`,
    ];
    expect(logReachedTheSuite(setupFailure)).toBe(false);
    expect(logReachedTheSuite([...setupFailure, raw])).toBe(true);
    // A green run that simply does not contain the quoted line still reads as
    // "reached the suite", so a genuinely wrong quote is still a defect.
    expect(logReachedTheSuite([raw])).toBe(true);
    expect(matchJobLogLine(raw, "✓  src/nowhere.test.ts")).toBe(null);
  });
});

describe("the test process's git environment", () => {
  it("carries no GIT_* variable — the scrub that prevents this suite's own incident", () => {
    // This is the suite that caused it. On 2026-08-06 a fixture here spawned
    // `git init`/`config`/`commit`/`update-ref` at a temp directory and instead
    // wrote `core.bare = true` and a placeholder identity into the shared
    // `.git/config`, put two junk commits on the branch, clobbered
    // `refs/remotes/origin/main`, and left `git status` failing in the main
    // checkout — because `git` reads GIT_DIR before it reads `cwd`, and the
    // pre-push hook exports one. `vitest.setup.mjs` removes them; this asserts
    // it is still wired, so the prevention cannot be deleted in silence.
    expect(Object.keys(process.env).filter((name) => name.startsWith("GIT_"))).toEqual([]);
  });
});

describe("--fix", () => {
  it("carries markerPosition/markerText through the REAL parse and resolve into the edits", () => {
    // The regression this pins: `resolveRecord` must copy `markerPosition` and
    // `markerText` off the parsed fragment. Nothing else in the suite touches
    // that propagation, and hand-building the edits (as the test below does)
    // does not exercise it — so without this case, deleting those two lines
    // leaves every test green while `--fix` rewrites nothing and reports
    // success. Drive the whole pipeline: parseQuotedAssertion -> resolveRecord
    // -> buildMarkerEdits -> applyMarkerRewrites.
    const { entries } = resolveFixture({
      "src/guard.ts": GUARD_SOURCE,
      "docs/evidence/criteria-closeout/phase-99.json": record([
        {
          kind: "test",
          ref: "src/guard.ts:1",
          quotedAssertion: ":1 'const findings = validateAdfSafeSubset(candidate);'",
        },
      ]),
    });
    const [entry] = entries;
    expect(entry.fragments[0].markerPosition).toBe(0);
    expect(entry.fragments[0].markerText).toBe(":1");
    const edits = buildMarkerEdits(entry);
    expect(edits).toEqual([{ position: 0, text: ":1", replacement: ":4" }]);
    expect(
      applyMarkerRewrites(":1 'const findings = validateAdfSafeSubset(candidate);'", edits),
    ).toBe(":4 'const findings = validateAdfSafeSubset(candidate);'");
  });

  it("declines to guess: a fragment whose text repeats gets no edit", () => {
    const { entries } = resolveFixture({
      "src/repeat.ts": ["const x = 1;", "const y = 2;", "const x = 1;"].join("\n"),
      "docs/evidence/criteria-closeout/phase-99.json": record([
        { kind: "test", ref: "src/repeat.ts:2", quotedAssertion: ":2 'const x = 1;'" },
      ]),
    });
    expect(entries[0].fragments[0].resolution.status).toBe("MOVED-AMBIG");
    expect(buildMarkerEdits(entries[0])).toEqual([]);
  });

  it("re-anchors exactly the marker's digits and nothing else around them", () => {
    // The rewrite is a pure string edit, tested as one. It is deliberately NOT
    // tested by driving `git` over a fixture repository: an earlier version of
    // this suite did exactly that, and under a fully parallel `npm test` its
    // `git init` / `git commit` / `git update-ref` landed in the REAL worktree —
    // two commits on the branch and a clobbered `refs/remotes/origin/main`. A
    // unit test must not be able to mutate the repository it is testing, whatever
    // the root cause of the escape was, so the git-driving half is gone and
    // `--fix`'s guard is covered by the read-only case below.
    const assertion =
      "the guard delegates: :1 'const findings = validateAdfSafeSubset(candidate);' — note :1 again";
    const edits = [{ position: 21, text: ":1", replacement: ":4" }];
    expect(applyMarkerRewrites(assertion, edits)).toBe(
      "the guard delegates: :4 'const findings = validateAdfSafeSubset(candidate);' — note :1 again",
    );
  });

  it("refuses to touch records this branch has not modified", () => {
    const { root } = makeFixtureRepo({
      "src/guard.ts": GUARD_SOURCE,
      "docs/evidence/criteria-closeout/phase-99.json": record([
        {
          kind: "test",
          ref: "src/guard.ts:1",
          quotedAssertion: ":1 'const findings = validateAdfSafeSubset(candidate);'",
        },
      ]),
    });
    // Not a git repository, so nothing is "this branch's own draft".
    expect(main(["--fix", "--repo", root])).toBe(1);
    const before = readFileSync(
      path.join(root, "docs/evidence/criteria-closeout/phase-99.json"),
      "utf8",
    );
    expect(before).toContain("src/guard.ts:1");
  });
});
