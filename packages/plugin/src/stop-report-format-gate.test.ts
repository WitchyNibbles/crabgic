import { describe, expect, it } from "vitest";
import { DEFAULT_PRESENTATION_POLICY } from "@crabgic/contracts";
import {
  PROSE_BLOCK_MAX_CHARS,
  PROSE_BLOCK_MAX_LINES,
  HEADING_REQUIRED_ABOVE_LINES,
  ASSUMED_WRAP_COLUMNS,
  findWalls,
  decideFormatAction,
  main,
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore -- plain .mjs hook, loaded directly by the engine; no .d.ts by design.
} from "../hooks/stop-report-format-gate.mjs";

/**
 * `docs/presentation-policy.md` said of the manager-session channel: "there is
 * no deterministic signal to hang one on". `docs/engine-baseline.md` §19.3 —
 * probe-verified at 2.1.220, and written before this hook existed — records
 * that the `Stop` payload carries `last_assistant_message`, and notes it as
 * "the field a regex-classifying gate would key on".
 *
 * That claim was right about RUN STATE and wrong about FORMATTING. Classifying
 * run state from prose would be guessing at something the supervisor already
 * knows authoritatively. Formatting is not like that: it is a property OF the
 * text, so the text is the authoritative source rather than a proxy for one.
 *
 * FALSE POSITIVES ARE THE EXPENSIVE FAILURE. This hook blocks a turn, on every
 * session end, in every project with the plugin installed. A missed wall costs
 * one hard-to-read answer; a wrongly-blocked turn costs the owner a wasted
 * round trip on a report that was fine. Every rule below is therefore
 * deliberately conservative, and everything ambiguous allows the stop.
 */

describe("limits stay in parity with the policy", () => {
  it("restates PresentationPolicy's limits rather than inventing its own", () => {
    // The hook is a plain `.mjs` the engine loads directly and cannot import
    // the workspace package, exactly as `stop-autonomy-gate.mjs` cannot import
    // RUN_LIFECYCLE_STATES. Same remedy: restate, then fail this test on drift.
    expect(PROSE_BLOCK_MAX_LINES).toBe(DEFAULT_PRESENTATION_POLICY.limits.proseBlockMaxLines);
    expect(HEADING_REQUIRED_ABOVE_LINES).toBe(
      DEFAULT_PRESENTATION_POLICY.limits.headingRequiredAboveLines,
    );
  });

  it("derives the character budget from the line budget, not from a magic number", () => {
    expect(PROSE_BLOCK_MAX_CHARS).toBe(PROSE_BLOCK_MAX_LINES * ASSUMED_WRAP_COLUMNS);
  });
});

describe("findWalls", () => {
  const wall = "word ".repeat(120).trim(); // ~600 chars, one paragraph, no newlines

  it("flags a single over-long paragraph even though it is one source line", () => {
    // The manager writes into a WRAPPING markdown TUI, so counting newlines the
    // way `renderHumanReport` does would miss the most common wall of all: one
    // enormous paragraph that is a single line in the source and fifteen on
    // screen. This is why the hook measures characters and the renderer
    // measures lines — same limit, two channels, two correct spellings of it.
    expect(findWalls(wall)).toContainEqual(expect.objectContaining({ kind: "prose-block" }));
  });

  it("passes a short answer untouched", () => {
    expect(findWalls("Done. The gate passed.")).toEqual([]);
  });

  it("passes a long but STRUCTURED report", () => {
    const structured = [
      "3 gates passed, 1 failed.",
      "",
      "## Failed",
      "",
      "- lint: no evidence reference",
      "- types: two errors in cli",
      "",
      "## Next",
      "",
      "- rerun after the fix",
    ].join("\n");
    expect(findWalls(structured)).toEqual([]);
  });

  it("flags an unstructured message that is long but has no headings or bullets", () => {
    const flat = Array.from({ length: HEADING_REQUIRED_ABOVE_LINES + 3 }, (_u, i) => `line ${i}.`);
    expect(findWalls(flat.join("\n"))).toContainEqual(
      expect.objectContaining({ kind: "no-structure" }),
    );
  });

  /**
   * The exclusions below are the whole reason this hook is safe to make
   * blocking. Each is a construct that legitimately runs long and is NOT a
   * wall, and each would otherwise be a routine false positive.
   */
  /**
   * REGRESSION, found in review 2026-08-11. The `no-structure` rule counted
   * every non-empty line, fenced content included, so an ordinary
   * "here is the fix: <code>" answer with a five-line code block was BLOCKED.
   * That is among the commonest shapes a coding assistant produces.
   *
   * The original test for this passed while the bug was live, because its
   * fenced block was a single long line — 4 non-empty lines total, under the
   * 5-line threshold. The assertion was right and the input too weak to
   * discriminate. Every case below is therefore sized to exceed the threshold
   * on its own, so it fails if the exclusion is removed.
   */
  it("ignores fenced code, however long", () => {
    const code = ["Here is the fix.", "", "```ts", wall, "```"].join("\n");
    expect(findWalls(code)).toEqual([]);
  });

  it("does not count fenced lines toward the structure threshold", () => {
    const many = Array.from({ length: HEADING_REQUIRED_ABOVE_LINES + 6 }, (_u, i) => `line${i}();`);
    const answer = ["Here is the fix:", "", "```ts", ...many, "```", "", "Run the tests."].join(
      "\n",
    );
    expect(findWalls(answer)).toEqual([]);
  });

  it("does not count a pasted log or diff toward the structure threshold", () => {
    const log = [
      "The failure:",
      "",
      "```",
      "FAIL src/a.test.ts",
      ...Array.from({ length: HEADING_REQUIRED_ABOVE_LINES + 3 }, (_u, i) => `  at line ${i}`),
      "```",
    ].join("\n");
    expect(findWalls(log)).toEqual([]);
  });

  it("still flags genuinely unstructured prose of the same length", () => {
    // The control for the three above: same line count, no fence. If this ever
    // passes, the exclusions have been widened into an amnesty.
    const prose = Array.from(
      { length: HEADING_REQUIRED_ABOVE_LINES + 6 },
      (_u, i) => `Sentence number ${String(i)} about the change.`,
    ).join("\n");
    expect(findWalls(prose)).toContainEqual(expect.objectContaining({ kind: "no-structure" }));
  });

  it("ignores tables", () => {
    const table = [
      "4 findings.",
      "",
      "| id | detail |",
      "| -- | ------ |",
      ...Array.from({ length: 8 }, (_u, i) => `| r${String(i)} | ${"x".repeat(90)} |`),
    ].join("\n");
    expect(findWalls(table)).toEqual([]);
  });

  it("ignores a long blockquote — quoted text is not the author's prose", () => {
    expect(findWalls(`They said:\n\n> ${wall}`)).toEqual([]);
  });

  it("ignores a long bullet — bullets are the policy's PREFERRED shape", () => {
    expect(findWalls(`Findings.\n\n- ${wall}`)).toEqual([]);
  });

  it("tolerates a paragraph exactly at the budget — a limit is a floor", () => {
    expect(findWalls("x".repeat(PROSE_BLOCK_MAX_CHARS))).toEqual([]);
  });
});

describe("decideFormatAction", () => {
  const wall = "word ".repeat(120).trim();

  it("blocks a wall, and the reason names the rule and the remedy", () => {
    const decision = decideFormatAction({ last_assistant_message: wall });
    expect(decision?.decision).toBe("block");
    expect(decision?.reason).toMatch(/answer first|headings|bullets/i);
  });

  /**
   * `stop_hook_active` (engine-baseline §19.2) is checked FIRST, before the
   * message is even looked at. Without it a model that cannot get under the
   * budget — or a rule that is simply wrong about some input — would wedge the
   * session, which is the worst failure available to a blocking Stop hook.
   */
  it("never blocks twice — the engine's loop guard is honoured before anything else", () => {
    expect(decideFormatAction({ last_assistant_message: wall, stop_hook_active: true })).toBeNull();
  });

  it("allows the stop when the message is absent, empty or not a string", () => {
    for (const payload of [
      {},
      { last_assistant_message: "" },
      { last_assistant_message: null },
      { last_assistant_message: 42 },
      null,
      undefined,
    ]) {
      expect(decideFormatAction(payload)).toBeNull();
    }
  });

  it("allows a well-formed report", () => {
    expect(
      decideFormatAction({
        last_assistant_message: "Done.\n\n## Next\n\n- run the gate",
      }),
    ).toBeNull();
  });
});

describe("main — fails open", () => {
  it("writes nothing when the payload cannot be read", () => {
    const written: string[] = [];
    main({
      read: () => {
        throw new Error("no stdin");
      },
      write: (s: string) => written.push(s),
    });
    expect(written).toEqual([]);
  });

  it("writes a block decision for a wall", () => {
    const written: string[] = [];
    main({
      read: () => ({ last_assistant_message: "word ".repeat(120).trim() }),
      write: (s: string) => written.push(s),
    });
    expect(written).toHaveLength(1);
    expect(JSON.parse(written[0]!).decision).toBe("block");
  });
});
