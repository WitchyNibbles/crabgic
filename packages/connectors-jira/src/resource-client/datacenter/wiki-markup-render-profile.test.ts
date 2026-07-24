import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { DEFAULT_COMMUNICATION_POLICY } from "@eo/contracts";
import { lint, toADF, toWikiMarkup, type AdfDocument } from "@eo/renderer";
import { adfDocumentToWikiMarkup } from "./wiki-markup-render-profile.js";

/** Builds a minimal single-paragraph `AdfDocument` wrapping one plain text node — used to test the serializer's escaping in isolation, independent of `toADF`'s own markdown parsing (which would consume/alter some of the adversarial characters below before they ever reach the serializer). */
function docWithText(text: string): AdfDocument {
  return {
    type: "doc",
    version: 1,
    content: [{ type: "paragraph", content: [{ type: "text", text }] }],
  };
}

/** `true` iff every literal `{`, `[`, `|`, or `!` in `wiki` is escaped (immediately preceded by a backslash) — the property that neutralizes macro/link/embed/table injection regardless of where in the string it occurs (including a char "relocated" to a new line via an embedded `\n`, since this checks EVERY occurrence, not just line-leading ones). */
function hasUnescapedWikiMetacharacter(wiki: string): boolean {
  return /(^|[^\\])[{[|!]/.test(wiki);
}

/**
 * roadmap/19-jira-datacenter-adapter.md work item 4: "`RenderedArtifact` →
 * Jira wiki markup serializer (DC has no ADF) + golden corpus; MUST pass
 * 17's blocking-artifact-lint unchanged." Failing test first: a
 * `RenderedArtifact` golden fixture run through the not-yet-built profile
 * fails 17's lint corpus before the serializer strips prohibited
 * content/attribution correctly.
 *
 * Design: `../issue-plans.ts`/`../comment-worklog-attachment-plans.ts`
 * (18's plan builders, REUSED VERBATIM by this phase's DC resource client
 * — see `./jira-datacenter-resource-client.ts`) always produce an
 * `AdfDocument` via `@eo/renderer`'s `toADF`, regardless of deployment
 * type — this keeps the intake/milestone-sync engine (18 work item 4)
 * "reused unmodified against either client," per roadmap/19's own
 * Interfaces-consumed bullet. `adfDocumentToWikiMarkup` is this phase's
 * OWN serializer, walking that SAME `AdfDocument` tree directly (never
 * re-deriving from the original markdown, which is unavailable at the DC
 * apply boundary) to Jira wiki-markup syntax — cross-tested here against
 * `@eo/renderer`'s own markdown-based `toWikiMarkup` (roadmap/17's
 * "Jira Data Center wiki-markup fallback profile") to prove both
 * serializers agree on output for every corpus item, since they both
 * ultimately derive from the same source markdown.
 */
const GOLDEN_CORPUS: readonly string[] = [
  "# Heading",
  "plain **bold** and *italic* and `code` and [a link](https://example.com).",
  "- bullet one\n- bullet two",
  "1. first\n2. second",
  "> a quoted blockquote line",
  "```\nconst x = 1;\n```",
  [
    "# Milestone Update",
    "",
    "Outcome: **shipped** the thing.",
    "",
    "- verified in staging",
    "- rolled out to 10% of traffic",
    "",
    "> Risk: none identified.",
  ].join("\n"),
];

describe("adfDocumentToWikiMarkup — golden corpus parity with @eo/renderer's toWikiMarkup", () => {
  it.each(GOLDEN_CORPUS)(
    "produces byte-identical output to toWikiMarkup for corpus item %#",
    (markdown) => {
      const viaAdf = adfDocumentToWikiMarkup(toADF(markdown));
      const viaMarkdown = toWikiMarkup(markdown);
      expect(viaAdf).toBe(viaMarkdown);
    },
  );

  it("converts a heading, matching toWikiMarkup's h1.-h3. clamping", () => {
    expect(adfDocumentToWikiMarkup(toADF("###### Deep"))).toBe("h3. Deep");
  });

  it("converts bold/italic/code/link marks", () => {
    const doc = toADF("plain **bold** and *italic* and `code` and [link](https://example.com)");
    expect(adfDocumentToWikiMarkup(doc)).toBe(
      "plain *bold* and _italic_ and {{code}} and [link|https://example.com]",
    );
  });

  it("converts a blockquote to bq. syntax", () => {
    expect(adfDocumentToWikiMarkup(toADF("> quoted text"))).toBe("bq. quoted text");
  });

  it("converts a fenced code block to {code}...{code}", () => {
    expect(adfDocumentToWikiMarkup(toADF("```\nconst x = 1;\n```"))).toBe(
      "{code}\nconst x = 1;\n{code}",
    );
  });
});

describe("wiki-markup rendering passes 17's blocking-artifact-lint unchanged", () => {
  it("a jira_milestone_comment candidate that passes lint() converts to wiki markup with no structural violation reintroduced", () => {
    const candidate = [
      "Outcome: shipped the milestone.",
      "Evidence: CI green, 3 reviewers approved.",
      "Risk: none identified.",
      "Next: monitor for 48h.",
      "Ref: PROJ-123",
    ].join("\n");

    const outcome = lint(candidate, "jira_milestone_comment", DEFAULT_COMMUNICATION_POLICY);
    expect(outcome.ok).toBe(true);

    const wikiMarkup = adfDocumentToWikiMarkup(toADF(candidate));
    // The lint pass already vetted `candidate` itself — this serializer is a
    // pure downstream format converter, so its output must never contain
    // any node/mark this connector doesn't recognize as safe, and must
    // preserve the same content (modulo Jira wiki-markup syntax tokens).
    expect(wikiMarkup).toContain("Outcome: shipped the milestone.");
    expect(wikiMarkup).toContain("PROJ-123");
  });
});

describe("adversarial: wiki-markup metacharacter escaping (macro/link/table injection)", () => {
  /**
   * Adversarial-review MAJOR finding: `renderInlineNode` emitted `node.text`
   * verbatim — no escaping of `{`, `[`, `]`, `|`, or macro tokens.
   * `assertSafeAdfDocument` (adf-guard.ts) validates node/mark TYPES, link
   * hrefs, and secret-shaped text but does NOT (and, correctly, should
   * not) scan text CONTENT for wiki syntax — ADF text is inert JSON on
   * Cloud. On Data Center, the SAME text becomes LIVE wiki markup once
   * this serializer emits it, so escaping wiki metacharacters in leaf
   * text content is this phase's own (DC-render-profile) responsibility.
   * Confirmed counterexample (roadmap/19 §Security's own named concern —
   * "no injection escaping DC's wiki syntax — e.g. {code}/{noformat}/macro
   * injection"): an ADF text node reading
   * `Risk {html}<script>alert(1)</script>{html} {code}rm -rf{code} {noformat}x{noformat}`
   * passed through unescaped becomes LIVE Jira wiki markup — where the
   * `{html}` macro is enabled, this is stored XSS.
   */
  it.each([
    ["{html}<script>alert(1)</script>{html}", "html macro wrapping a raw <script> tag"],
    ["{code}rm -rf /{code}", "code macro"],
    ["{noformat}ignore this{noformat}", "noformat macro"],
    ["{color:red}danger{color}", "color macro"],
    ["{quote}not a real quote{quote}", "quote macro"],
    [
      "click [here|javascript:alert(document.cookie)]",
      "literal bracket-syntax link with a javascript: target (not via an ADF link mark)",
    ],
    ["||header1||header2||\n|injected|row|", "table-row smuggling via literal | delimiters"],
    ["!http://evil.example.com/track.png!", "embedded-image/attachment reference"],
  ])("neutralizes %s (%s) — every wiki metacharacter is backslash-escaped", (dangerous) => {
    const wiki = adfDocumentToWikiMarkup(docWithText(dangerous));
    expect(hasUnescapedWikiMetacharacter(wiki)).toBe(false);
  });

  it("the same macro-injection payload still PASSES 17's blocking-artifact-lint as ordinary candidate text — proving lint alone does not (and is not meant to) catch Jira-wiki-specific macro syntax; this connector's own serializer is the closing control", () => {
    // Deliberately contains NO raw HTML tag and NO javascript:/data:/vbscript:/file:
    // scheme (17's own url-policy stage already blocks those independently,
    // per `@eo/renderer`'s `url-policy.ts` — that is a DIFFERENT, already-
    // closed vector, not what this test demonstrates). This candidate
    // isolates the gap that is genuinely Jira-wiki-specific: 17's lint has
    // (and should have) no opinion on `{macro}` bracket syntax at all,
    // since that syntax means nothing outside Jira wiki markup.
    const candidate = [
      "Outcome: {html}a friendly greeting{html} shipped.",
      "Evidence: {code}rm -rf /{code} ran clean.",
      "Risk: {noformat}none identified{noformat}.",
      "Next: monitor for 48h.",
      "Ref: PROJ-123",
    ].join("\n");

    const outcome = lint(candidate, "jira_milestone_comment", DEFAULT_COMMUNICATION_POLICY);
    expect(outcome.ok).toBe(true);

    const wiki = adfDocumentToWikiMarkup(toADF(candidate));
    expect(hasUnescapedWikiMetacharacter(wiki)).toBe(false);
    // Content preservation still holds — escaping neutralizes the MACRO
    // trigger without discarding the surrounding content.
    expect(wiki).toContain("PROJ-123");
  });

  it("escapes the backslash character itself FIRST, so a user-supplied backslash can never be combined with an escaped brace to fool a naive 'preceded by backslash' check", () => {
    const BACKSLASH = String.fromCharCode(92); // one real '\' character
    const input = `a${BACKSLASH}{code}`; // real chars: a \ { c o d e }
    const wiki = adfDocumentToWikiMarkup(docWithText(input));
    // The user's OWN backslash must itself become an escaped "\\" (two
    // backslashes), and the brace gets its OWN, independent escape prefix
    // — never a single shared backslash that could be (mis)read as
    // belonging to the user's original character instead of to Jira's
    // own escape mechanism.
    const expected = `a${BACKSLASH}${BACKSLASH}${BACKSLASH}{code${BACKSLASH}}`;
    expect(wiki).toBe(expected);
    expect(hasUnescapedWikiMetacharacter(wiki)).toBe(false);
  });
});

describe("property: structural limits preserved under fuzzed input", () => {
  it("never produces output longer than a small constant multiple of the input markdown's length", () => {
    fc.assert(
      fc.property(
        fc.string({ maxLength: 500 }).filter((s) => !s.includes("\0")),
        (markdown) => {
          const doc = toADF(markdown);
          const wiki = adfDocumentToWikiMarkup(doc);
          // Wiki-markup syntax tokens (h1./*[|]{{}}) can only ever expand
          // text by a small bounded factor per character — never unbounded
          // growth, which would indicate a runaway/recursive bug.
          expect(wiki.length).toBeLessThanOrEqual(markdown.length * 4 + 64);
        },
      ),
      { numRuns: 200 },
    );
  });

  it("FIXED (was vacuous): a raw '<' passes through inert as plain wiki text (Jira wiki markup never interprets bare '<' as markup), and NEVER introduces a NEW 'javascript:' substring absent from the source", () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 300 }), (markdown) => {
        const wiki = adfDocumentToWikiMarkup(toADF(markdown));
        // A literal '<' in the source survives verbatim into the output —
        // this is intentionally NOT stripped/escaped by this serializer
        // (bare '<' has no special meaning in Jira wiki markup on its
        // own; the actual escalation path is via a `{html}` macro, which
        // the property below closes off directly regardless of any '<'
        // present).
        if (markdown.includes("<")) {
          expect(wiki).toContain("<");
        }
        if (!markdown.toLowerCase().includes("javascript:")) {
          expect(wiki.toLowerCase()).not.toContain("javascript:");
        }
      }),
      { numRuns: 200 },
    );
  });

  it("no fuzzed leaf text can ever leave an UNESCAPED wiki metacharacter in the rendered output — the actual property that neutralizes {html}/{code}/{noformat}/macro injection regardless of source shape", () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 300 }), (text) => {
        const wiki = adfDocumentToWikiMarkup(docWithText(text));
        expect(hasUnescapedWikiMetacharacter(wiki)).toBe(false);
      }),
      { numRuns: 300 },
    );
  });
});

/** Builds a single-`codeBlock`-node `AdfDocument` wrapping one plain text child — mirrors `toADF`'s own codeBlock shape (a single text node holding the fenced content). */
function docWithCodeBlock(text: string): AdfDocument {
  return {
    type: "doc",
    version: 1,
    content: [{ type: "codeBlock", content: [{ type: "text", text }] }],
  };
}

/**
 * Strips this serializer's OWN emitted `{code}\n`/`\n{code}` fence
 * markers (which of course literally contain "{code}" — that is not the
 * vulnerability) before checking, so `containsLiveCodeOrNoformatCloseToken`
 * below only inspects the actual BODY content for a live breakout token.
 * When `wiki` contains more than one codeBlock/fence in a larger document
 * (e.g. the full-candidate lint test), this strips every `{code}` line
 * that is exactly a bare fence marker (a whole line consisting of nothing
 * but `{code}`) rather than the first/last occurrence positionally.
 */
function stripOwnFenceMarkers(wiki: string): string {
  return wiki
    .split("\n")
    .filter((line) => line !== "{code}")
    .join("\n");
}

/**
 * `true` iff `wiki` (the FULL rendered output, fence markers stripped
 * first) contains a literal, unescaped `{code}` or `{noformat}` closing-
 * shaped token — the exact substring that would prematurely close a real
 * Jira `{code}` macro and let whatever follows be parsed as live wiki
 * markup again.
 */
function containsLiveCodeOrNoformatCloseToken(wiki: string): boolean {
  // Case-INSENSITIVE, matching the serializer's own neutralization
  // pattern (see wiki-markup-render-profile.ts's own doc comment on why:
  // Jira DC's macro-close matcher's case-sensitivity can't be verified
  // without a live instance, so this checker — and the serializer it
  // tests — both treat `{CODE}`/`{NoFormat}` as equally dangerous as
  // `{code}`/`{noformat}`, the conservative assumption).
  return /\{(code|noformat)(:[^}]*)?\}/i.test(stripOwnFenceMarkers(wiki));
}

describe("adversarial (residual, second adversarial-review pass): codeBlock macro-breakout", () => {
  /**
   * Adversarial-review residual finding: `renderBlockNode`'s `"codeBlock"`
   * case joined each child's `.text` VERBATIM (`(node.content ?? [])
   * .map((child) => child.text ?? "").join("")`), bypassing
   * `renderInlineNode`'s escaping entirely (codeBlock content is never
   * routed through it). In real Jira wiki markup, a `{code}` block's body
   * ends at the FIRST literal `{code}` (or `{code:...}`) it contains — so
   * codeBlock content containing that token breaks OUT of the block, and
   * anything after it is parsed as live wiki markup again (the same
   * `{html}`-macro/stored-XSS class the inline-text fix already closed,
   * reachable here through a DIFFERENT, unescaped code path).
   *
   * Backslash-escaping does NOT help here — `{code}`/`{noformat}` bodies
   * are rendered LITERALLY by Jira (that is the entire point of those two
   * macros), so `\{code\}` would display a visible backslash rather than
   * neutralizing anything. The chosen mitigation instead breaks the
   * literal byte-sequence of the closing token itself by inserting a
   * zero-width space (U+200B) immediately after the token's opening `{`
   * — `{code}` becomes `{<ZWSP>code}`, which is no longer the 6-character
   * sequence Jira's macro parser scans for, while remaining visually
   * IDENTICAL when rendered (a zero-width space renders as nothing in
   * every mainstream renderer/terminal/editor) — this is the standard,
   * well-established technique for defusing a literal token match without
   * altering displayed content (the same class of trick used to break
   * auto-linking of URLs/mentions/banned strings elsewhere). Scoped
   * NARROWLY to the two verbatim-content macro names Jira actually
   * recognizes for a fenced block (`code`, `noformat`) — not a blanket
   * `{anything}` pattern, which would falsely mangle ordinary code
   * containing completely unrelated brace-delimited constructs (JS/TS
   * object literals, JSX props, CSS rules, JSON) that have nothing to do
   * with Jira macro syntax at all.
   */
  const ZWSP = "​";

  it("RED-proof (documents the pre-fix vulnerability): a raw {code}-in-codeBlock breakout, once neutralized, no longer contains the live closing token", () => {
    const doc = docWithCodeBlock("x\n{code}\n{html}<script>alert(1)</script>{html}\n{code}\ny");
    const wiki = adfDocumentToWikiMarkup(doc);
    expect(containsLiveCodeOrNoformatCloseToken(wiki)).toBe(false);
  });

  it("neutralizes a {noformat}-in-codeBlock breakout the same way", () => {
    const doc = docWithCodeBlock("before{noformat}\n{html}evil{html}\n{noformat}after");
    const wiki = adfDocumentToWikiMarkup(doc);
    expect(containsLiveCodeOrNoformatCloseToken(wiki)).toBe(false);
  });

  it("neutralizes a parameterized {code:...}/{noformat:...} closing-shaped token too", () => {
    const doc = docWithCodeBlock("a{code:javascript}b{noformat:title=x}c");
    const wiki = adfDocumentToWikiMarkup(doc);
    expect(containsLiveCodeOrNoformatCloseToken(wiki)).toBe(false);
  });

  it("neutralizes a case-varied {CODE}/{NoFormat} token too — Jira DC's actual close-token case-sensitivity cannot be verified without a live instance, so this is the conservative assumption", () => {
    const doc = docWithCodeBlock("a{CODE}b{NoFormat}c{Code:javascript}d");
    const wiki = adfDocumentToWikiMarkup(doc);
    expect(containsLiveCodeOrNoformatCloseToken(wiki)).toBe(false);
  });

  it("neutralization is invisible: the zero-width space is inserted right after the token's opening brace, preserving every other character", () => {
    const doc = docWithCodeBlock("{code}");
    const wiki = adfDocumentToWikiMarkup(doc);
    expect(wiki).toBe(`{code}\n{${ZWSP}code}\n{code}`);
    // Stripping the zero-width space reproduces the ORIGINAL body exactly
    // — nothing else about the content was altered.
    expect(wiki.replaceAll(ZWSP, "")).toBe("{code}\n{code}\n{code}");
  });

  it("benign golden: ordinary code containing braces around ordinary identifiers (JS/TS/JSON/CSS-shaped, no 'code'/'noformat' token) renders byte-identical, unmangled", () => {
    const benignSnippets = [
      "if (x) { return y; }",
      "const { name } = user;",
      "function f(props: { code: string }) {}",
      '{"code": 123, "message": "ok"}',
      ".btn { color: red; }",
      "<div>{children}</div>",
    ];
    for (const snippet of benignSnippets) {
      const wiki = adfDocumentToWikiMarkup(docWithCodeBlock(snippet));
      expect(wiki).toBe(`{code}\n${snippet}\n{code}`);
    }
  });

  it("still passes 17's blocking-artifact-lint as an ordinary candidate (the macro token is inert Jira-wiki-specific text, not something 17's generic lint pipeline needs to know about)", () => {
    // `jira_milestone_comment`'s own `maxLines: 6` leaves no room for both
    // its 5-line Outcome/Evidence/Risk/Next/Ref template AND a 3-line
    // fenced code block in the same candidate — `pr_body` is used instead
    // (same `renderWithRegeneration`/`lint()` pipeline, a 4-line template
    // + `maxLines: 12`, ample room), proving the identical point: 17's
    // generic lint pipeline has no opinion on Jira-wiki-specific macro
    // syntax regardless of which templated `ArtifactKind` is checked.
    const candidate = [
      "Outcome: investigated.",
      "Validation: PROJ-1",
      "Risk: none identified.",
      "Tracking: PROJ-1",
      "",
      "```",
      "before{code}",
      "{html}evil{html}",
      "{code}after",
      "```",
    ].join("\n");
    const outcome = lint(candidate, "pr_body", DEFAULT_COMMUNICATION_POLICY);
    expect(outcome.ok).toBe(true);

    const wiki = adfDocumentToWikiMarkup(toADF(candidate));
    expect(containsLiveCodeOrNoformatCloseToken(wiki)).toBe(false);
  });

  it("property: no fuzzed codeBlock text can ever leave a live {code}/{noformat} closing-shaped token in the rendered output", () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 300 }), (text) => {
        const wiki = adfDocumentToWikiMarkup(docWithCodeBlock(text));
        expect(containsLiveCodeOrNoformatCloseToken(wiki)).toBe(false);
      }),
      { numRuns: 300 },
    );
  });
});

describe("adversarial (residual): link-mark href defensively escaped too", () => {
  /**
   * `href` is upstream-validated https-only by `../adf-guard.ts`'s
   * `isSafeHref`, but that check only inspects the SCHEME — it does not,
   * and cannot, prevent the URL's remainder from carrying a raw `]`/`|`/
   * `{` character (e.g. captured by `toADF`'s own markdown-link regex,
   * whose URL capture group `[^)]+` does not exclude those characters).
   * A raw `]` inside `href` would prematurely close the `[text|href]`
   * construct this serializer itself emits; a raw `{` could reopen a
   * macro immediately after. Defensively escaping `href` through the
   * SAME `escapeWikiMetacharacters` leaf-text path closes this — unlike
   * the codeBlock case, a link's href is ordinary INLINE wiki content
   * (never inside a `{code}`/`{noformat}` body), where Jira's normal
   * backslash-escaping IS honored.
   */
  it("a link href containing a raw ']' does not prematurely close the [text|href] construct", () => {
    const doc: AdfDocument = {
      type: "doc",
      version: 1,
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "click",
              marks: [{ type: "link", attrs: { href: "https://example.com/]{html}evil{html}" } }],
            },
          ],
        },
      ],
    };
    const wiki = adfDocumentToWikiMarkup(doc);
    // The construct's OWN structural `[`/`|`/`]` (the link wrapper this
    // serializer itself emits) are expected to remain unescaped — only
    // the HREF's raw ']'/'{'/'}' characters must be escaped. Asserting
    // against the exact expected output (rather than the generic
    // "no unescaped metacharacter anywhere" helper, which would also flag
    // this construct's own intentional wrapper brackets) proves precisely
    // that: the dangerous raw adjacency "]{html}" from the source href
    // never survives unescaped into the output.
    expect(wiki).toBe("[click|https://example.com/\\]\\{html\\}evil\\{html\\}]");
    expect(wiki).not.toContain("]{html}"); // the raw, unescaped adjacency is gone
  });
});
