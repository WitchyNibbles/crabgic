import { describe, expect, it } from "vitest";
import { DEFAULT_PRESENTATION_POLICY } from "@crabgic/contracts";
import {
  PROSE_BLOCK_MAX_CHARS,
  PROSE_BLOCK_MAX_LINES,
  HEADING_REQUIRED_ABOVE_LINES,
  findWalls,
  decideFormatAction,
  DEFAULT_GATE_CONFIG,
  readGateConfig,
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

  /**
   * This used to assert the budget was DERIVED (`3 lines x 80 columns` = 240).
   * That derivation was a guess in a lab coat, and measurement destroyed it: at
   * 240 the gate would have refused 69% of 1,878 real messages, because the
   * owner's median paragraph is 228. The budget is now calibrated against the
   * owner's own judgement, so what has to hold is parity with the policy — not
   * an arithmetic identity that made a made-up number look principled.
   */
  it("takes the calibrated prose budget from the policy, not from arithmetic", () => {
    expect(PROSE_BLOCK_MAX_CHARS).toBe(DEFAULT_PRESENTATION_POLICY.limits.proseBlockMaxChars);
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
    const decision = decideFormatAction(
      { last_assistant_message: wall },
      { enabled: true, mode: "blocking" },
    );
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

/**
 * The gate merged BLOCKING, on thresholds nobody had measured, into a plugin
 * installed in other people's repositories — with no way to tune it and no way
 * to switch it off. `docs/design/format-gate-production.md` §L3 and §4 close
 * both: a project config, and an advisory mode that observes instead of
 * blocking so the thresholds can be calibrated against real firings first.
 */
describe("gate configuration", () => {
  const wall = "word ".repeat(120).trim();

  it("does nothing at all when disabled", () => {
    expect(decideFormatAction({ last_assistant_message: wall }, { enabled: false })).toBeNull();
  });

  it("in advisory mode reports the walls but does not block", () => {
    const decision = decideFormatAction(
      { last_assistant_message: wall },
      { enabled: true, mode: "advisory" },
    );
    expect(decision?.advisory).toBe(true);
    expect(decision?.decision).toBeUndefined();
    expect(decision?.walls?.length).toBeGreaterThan(0);
  });

  it("blocks when configured to block", () => {
    expect(
      decideFormatAction({ last_assistant_message: wall }, { enabled: true, mode: "blocking" })
        ?.decision,
    ).toBe("block");
  });

  /**
   * Parity with the policy, NOT a hardcoded literal. This asserted
   * `{enabled: true, mode: "blocking"}` by hand, so when the policy's default
   * moved to `advisory` the hook silently disagreed with it and the test still
   * passed — the exact drift the parity discipline exists to catch, defeated by
   * writing the expectation out longhand.
   */
  it("defaults to whatever the policy defaults to", () => {
    expect(DEFAULT_GATE_CONFIG).toEqual(DEFAULT_PRESENTATION_POLICY.formatGate);
  });

  it("observes instead of blocking by default, until the post-style rate is known", () => {
    const decision = decideFormatAction({ last_assistant_message: wall });
    expect(decision?.advisory).toBe(true);
    expect(decision?.decision).toBeUndefined();
  });

  it("keeps the engine's loop guard ahead of the config — a re-entry never blocks", () => {
    expect(
      decideFormatAction(
        { last_assistant_message: wall, stop_hook_active: true },
        { enabled: true, mode: "blocking" },
      ),
    ).toBeNull();
  });

  it.each([
    [
      "no file",
      () => {
        throw new Error("ENOENT");
      },
    ],
    ["malformed JSON", () => "{ not json"],
    ["no formatGate member", () => JSON.stringify({ limits: {} })],
    ["a wrong-typed switch", () => JSON.stringify({ formatGate: { enabled: "yes" } })],
    ["an unknown mode", () => JSON.stringify({ formatGate: { mode: "shout" } })],
  ])("falls back to the default config on %s", (_label, read) => {
    expect(readGateConfig("/anywhere", read as () => string)).toEqual(DEFAULT_GATE_CONFIG);
  });

  it("reads a real override", () => {
    const read = () => JSON.stringify({ formatGate: { enabled: false, mode: "advisory" } });
    expect(readGateConfig("/anywhere", read)).toEqual({ enabled: false, mode: "advisory" });
  });
});

describe("telemetry", () => {
  const wall = "word ".repeat(120).trim();

  it("records a firing without ever recording the message text", () => {
    const entries: Record<string, unknown>[] = [];
    main({
      read: () => ({ last_assistant_message: wall }),
      write: () => undefined,
      config: { enabled: true, mode: "blocking" },
      record: (e: Record<string, unknown>) => entries.push(e),
      now: () => "2026-08-11T00:00:00.000Z",
    });
    expect(entries).toHaveLength(1);
    const entry = entries[0]!;
    expect(entry["rules"]).toEqual(["prose-block"]);
    expect(entry["mode"]).toBe("blocking");
    expect(typeof entry["messageDigest"]).toBe("string");
    // The load-bearing property: the owner's prose must never land on disk.
    expect(JSON.stringify(entry)).not.toContain("word word");
  });

  it("records in advisory mode too, and writes no decision", () => {
    const entries: unknown[] = [];
    const written: string[] = [];
    main({
      read: () => ({ last_assistant_message: wall }),
      write: (s: string) => written.push(s),
      config: { enabled: true, mode: "advisory" },
      record: (e: unknown) => entries.push(e),
      now: () => "t",
    });
    expect(entries).toHaveLength(1);
    expect(written).toEqual([]);
  });

  it("records nothing for a well-formed report", () => {
    const entries: unknown[] = [];
    main({
      read: () => ({ last_assistant_message: "Done.\n\n## Next\n\n- run the gate" }),
      write: () => undefined,
      config: { enabled: true, mode: "blocking" },
      record: (e: unknown) => entries.push(e),
      now: () => "t",
    });
    expect(entries).toEqual([]);
  });

  it("a failing telemetry sink never affects the turn — the block still lands", () => {
    const written: string[] = [];
    expect(() =>
      main({
        read: () => ({ last_assistant_message: wall }),
        write: (s: string) => written.push(s),
        config: { enabled: true, mode: "blocking" },
        record: () => {
          throw new Error("disk full");
        },
        now: () => "t",
      }),
    ).not.toThrow();
    // Observability failing must not swallow the decision either.
    expect(written).toHaveLength(1);
    expect(JSON.parse(written[0]!).decision).toBe("block");
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

  it("writes a block decision for a wall when configured to block", () => {
    const written: string[] = [];
    main({
      read: () => ({ last_assistant_message: "word ".repeat(120).trim() }),
      write: (s: string) => written.push(s),
      config: { enabled: true, mode: "blocking" },
      record: () => undefined,
    });
    expect(written).toHaveLength(1);
    expect(JSON.parse(written[0]!).decision).toBe("block");
  });
});
