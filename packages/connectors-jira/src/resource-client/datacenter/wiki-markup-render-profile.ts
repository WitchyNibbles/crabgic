import type { AdfDocument, AdfNode } from "@eo/renderer";

/**
 * `wikiMarkupRenderProfile` — roadmap/19-jira-datacenter-adapter.md
 * §Interfaces produced: "`RenderedArtifact` → Jira wiki-markup serializer,
 * plus its golden corpus." Data Center has no ADF; 17's own `toWikiMarkup`
 * (`@eo/renderer`) already converts the ORIGINAL markdown string directly
 * — but 18's shared plan builders (`../issue-plans.ts`,
 * `../comment-worklog-attachment-plans.ts`, REUSED VERBATIM by this
 * phase's DC resource client so the intake/milestone-sync engine stays
 * "reused unmodified against either client") only ever hand this
 * connector an already-built `AdfDocument` (via `@eo/renderer`'s `toADF`)
 * — the original markdown is gone by the time a DC apply call needs wiki
 * markup. `adfDocumentToWikiMarkup` is this phase's own serializer,
 * walking that SAME `AdfDocument` tree directly rather than re-deriving
 * markdown, engineered to agree byte-for-byte with `toWikiMarkup` for
 * every corpus item (`./wiki-markup-render-profile.test.ts`'s golden
 * corpus proves this for both serializers, since they both ultimately
 * derive from the same source markdown through `toADF`/`toWikiMarkup`
 * respectively).
 *
 * Node/mark coverage is intentionally scoped to EXACTLY
 * `ADF_ALLOWED_NODE_TYPES`/`ADF_ALLOWED_MARK_TYPES` (`@eo/renderer`'s own
 * safe-subset whitelist) — this serializer is only ever invoked on an
 * `AdfDocument` that has ALREADY passed `../adf-guard.ts`'s
 * `assertSafeAdfDocument` (18's plan builders call that guard before this
 * phase's DC apply client ever sees the payload; roadmap/19 reuses that
 * guard unmodified rather than inventing a parallel DC-only check), so an
 * out-of-whitelist node/mark reaching this function would already be a
 * defect upstream, not something this serializer needs to re-validate.
 *
 * **Wiki-metacharacter escaping (adversarial-review MAJOR fix).**
 * `assertSafeAdfDocument` validates node/mark TYPES, link `href` schemes,
 * and secret-shaped text — it does NOT (and correctly should not) scan
 * text CONTENT for wiki syntax, since ADF text is inert JSON on Cloud.
 * On Data Center, the SAME text becomes LIVE wiki markup the instant this
 * serializer emits it verbatim — a leaf text node reading
 * `{html}<script>...</script>{html}` would open a real `{html}` macro
 * (roadmap/19 §Security's own named concern: "no injection escaping DC's
 * wiki syntax — e.g. {code}/{noformat}/macro injection"; where the
 * `{html}` macro is enabled on the target instance, this is stored XSS).
 * Escaping leaf TEXT content is therefore this render profile's own
 * responsibility, never `@eo/renderer`'s (17 is Jira-deployment-agnostic
 * by design and has no reason to know Jira wiki syntax at all).
 *
 * `escapeWikiMetacharacters` (below) backslash-escapes every occurrence
 * — not just a "leading" occurrence — of each STRUCTURAL wiki
 * metacharacter in leaf text, before any mark-wrapping is applied. This
 * is deliberately unconditional-by-position: an attacker could otherwise
 * try to "relocate" a dangerous character to the start of a fresh line
 * via an embedded `\n` to slip past a leading-character-only escaper;
 * escaping every occurrence regardless of position closes that off too,
 * since the SAME character is escaped no matter where in the string it
 * ends up.
 */

/**
 * The exact escape set and why each member is here — every one of these
 * OPENS or CLOSES a Jira wiki-markup STRUCTURAL construct when it
 * appears as a literal, unescaped character in running text:
 *
 *  - `{` / `}` — open/close a MACRO (`{html}`, `{code}`, `{noformat}`,
 *    `{color}`, `{quote}`, ...). This is the primary vector the
 *    adversarial finding named (up to stored XSS via `{html}`).
 *  - `[` / `]` — open/close a LINK or embed reference written as literal
 *    bracket syntax (`[text|url]`) — Jira's wiki renderer recognizes this
 *    even when typed as plain characters, not only via an ADF `link`
 *    mark (whose `href` is separately validated upstream by
 *    `../adf-guard.ts`'s `isSafeHref`, https-only — that check does not,
 *    and cannot, cover a link written as literal text instead of a mark).
 *  - `|` — delimits a link's text/target halves AND table-row cells
 *    (`|cell|cell|`, `||header||header||`) — the "table-row smuggling"
 *    vector.
 *  - `!` — opens/closes an embedded attachment/image reference
 *    (`!image.png!`), the same structural-embed risk class as `[]`.
 *  - `\` — Jira's OWN escape character; it is escaped FIRST (by being a
 *    member of this same character class, matched left-to-right over the
 *    ORIGINAL string in one pass — `String.replace` never re-scans its
 *    own output) so a user-supplied backslash can never be combined with
 *    one of this function's own escape prefixes to fool a naive
 *    "preceded by backslash" reader into treating a brace/bracket as
 *    already-escaped when it is actually the user's unescaped character.
 *
 * Deliberately EXCLUDES pure VISUAL-formatting delimiters (`*_+-^~?`) —
 * those can, at most, misrender text as bold/italic/strikethrough/etc.
 * (a cosmetic spoofing concern), never open a macro, a link/embed
 * reference, or a table row (the STRUCTURAL/injection class this fix
 * targets). Escaping this narrower, correctly-scoped set also avoids
 * mangling extremely common, benign content that contains no macro/
 * link/embed/table syntax at all (issue keys like "PROJ-123", percentages,
 * underscored identifiers) — a partial-but-overreaching escape set that
 * degrades ordinary content without closing a real vector is its own
 * kind of hasty, worse-than-none fix; this set is scoped to exactly the
 * characters that can trigger STRUCTURAL parsing.
 */
const WIKI_METACHARACTER_PATTERN = /[\\{}[\]|!]/g;

function escapeWikiMetacharacters(text: string): string {
  return text.replace(WIKI_METACHARACTER_PATTERN, (ch) => `\\${ch}`);
}

/**
 * Second adversarial-review pass, residual finding: `{code}`/`{noformat}`
 * BLOCK content is rendered LITERALLY by Jira — that is the entire point
 * of those two macros — so `escapeWikiMetacharacters`'s backslash
 * escaping does NOT work inside them (`\{code\}` would display a visible
 * backslash, never neutralize anything; using it here would be exactly
 * the kind of hasty, incomplete fix this project has already learned to
 * avoid). A `{code}` block's body ends at the FIRST literal `{code}` (or
 * `{code:...}`) it contains, and (defensively — Jira's exact per-macro
 * grammar isn't verifiable without a live instance) the same is true of
 * `{noformat}`/`{noformat:...}` — so EITHER token appearing literally in
 * codeBlock content can break out of the fence this serializer itself
 * emits, letting whatever follows be parsed as live wiki markup again.
 *
 * Mitigation: insert a zero-width space (U+200B) immediately after the
 * token's opening `{` — `{code}` becomes `{<ZWSP>code}`, no longer the
 * literal byte-sequence Jira's macro parser scans for to close/open a
 * macro, while rendering VISUALLY IDENTICAL in every mainstream renderer
 * (a zero-width space displays as nothing) — the standard, well-
 * established technique for defusing a literal-token match without
 * altering displayed content. Scoped NARROWLY to the two verbatim-content
 * macro names Jira recognizes for a fenced/preformatted block (`code`,
 * `noformat`) — never a blanket `{anything}` pattern, which would
 * needlessly mangle ordinary code containing completely unrelated
 * brace-delimited constructs (JS/TS object literals, JSX props, CSS
 * rules, JSON) that have nothing to do with Jira macro syntax.
 *
 * Case-INSENSITIVE (`i` flag) by deliberate, conservative choice: whether
 * Jira DC's macro close-token matcher is case-sensitive cannot be
 * verified without a live instance (docs/evidence/phase-19/README.md
 * carries this as a named live-verification contingency for 23's live DC
 * matrix). Over-neutralizing an uppercase/mixed-case `{CODE}`/`{NoFormat}`
 * occurring in ordinary code content is harmless — it is rare, and the
 * ZWSP insertion is visually invisible either way — so the conservative
 * (matches more, never less) choice costs nothing and closes the gap if
 * Jira's real parser turns out to be case-insensitive.
 */
const ZERO_WIDTH_SPACE = "​";
const CODE_BLOCK_BREAKOUT_TOKEN_PATTERN = /\{(code|noformat)(:[^}]*)?\}/gi;

function neutralizeCodeBlockBreakoutTokens(text: string): string {
  return text.replace(
    CODE_BLOCK_BREAKOUT_TOKEN_PATTERN,
    (_match, name: string, params: string | undefined) =>
      `{${ZERO_WIDTH_SPACE}${name}${params ?? ""}}`,
  );
}

function renderInlineNodes(nodes: readonly AdfNode[]): string {
  return nodes.map(renderInlineNode).join("");
}

function renderInlineNode(node: AdfNode): string {
  if (node.type === "hardBreak") {
    return "\n";
  }
  // `node.text` is a TRUE LEAF — escaped here, once. `node.content`
  // (a node with children rather than direct text) is rendered via
  // `renderInlineNodes`, which recurses to each child's OWN leaf-text
  // escaping — never re-escaped a second time at this level, which would
  // double-escape the backslashes this function's own escaping already
  // introduced.
  let text =
    node.text !== undefined
      ? escapeWikiMetacharacters(node.text)
      : node.content !== undefined
        ? renderInlineNodes(node.content)
        : "";
  for (const mark of node.marks ?? []) {
    switch (mark.type) {
      case "strong":
        text = `*${text}*`;
        break;
      case "em":
        text = `_${text}_`;
        break;
      case "code":
        text = `{{${text}}}`;
        break;
      case "link": {
        // Residual (adversarial-review, second pass): `href` is upstream-
        // validated https-ONLY (`../adf-guard.ts`'s `isSafeHref`) — that
        // check inspects the SCHEME, not the rest of the URL, so a raw
        // `]`/`{`/`|` captured into `href` (e.g. via `toADF`'s own
        // markdown-link regex, whose URL group does not exclude those
        // characters) could still prematurely close this `[text|href]`
        // construct or reopen a macro immediately after. `href` is
        // ordinary INLINE wiki content (never inside a `{code}`/
        // `{noformat}` body), where backslash-escaping IS honored, so the
        // same leaf-text escape function applies here too.
        const rawHref = typeof mark.attrs?.["href"] === "string" ? mark.attrs["href"] : "";
        text = `[${text}|${escapeWikiMetacharacters(rawHref)}]`;
        break;
      }
      default:
        // Unrecognized mark type — never reachable past `assertSafeAdfDocument`
        // (see module doc comment), but fails safe by emitting the plain
        // text rather than throwing mid-render if it somehow is.
        break;
    }
  }
  return text;
}

function headingPrefix(level: number): string {
  return `h${Math.min(Math.max(level, 1), 3)}.`;
}

function renderListItems(items: readonly AdfNode[], bullet: string): string {
  return items
    .map((item) => {
      const paragraph = item.content?.[0];
      const inline = paragraph?.content !== undefined ? renderInlineNodes(paragraph.content) : "";
      return `${bullet} ${inline}`;
    })
    .join("\n");
}

function renderBlockNode(node: AdfNode): string {
  switch (node.type) {
    case "paragraph":
      return renderInlineNodes(node.content ?? []);
    case "heading": {
      const level = typeof node.attrs?.["level"] === "number" ? node.attrs["level"] : 1;
      return `${headingPrefix(level)} ${renderInlineNodes(node.content ?? [])}`;
    }
    case "bulletList":
      return renderListItems(node.content ?? [], "*");
    case "orderedList":
      return renderListItems(node.content ?? [], "#");
    case "codeBlock": {
      const text = (node.content ?? []).map((child) => child.text ?? "").join("");
      return `{code}\n${neutralizeCodeBlockBreakoutTokens(text)}\n{code}`;
    }
    case "blockquote": {
      const paragraph = node.content?.[0];
      const inline = paragraph?.content !== undefined ? renderInlineNodes(paragraph.content) : "";
      return `bq. ${inline}`;
    }
    default:
      // Unrecognized top-level node type — never reachable past
      // `assertSafeAdfDocument` (see module doc comment); falls back to a
      // best-effort plain-text rendering rather than throwing mid-render.
      return renderInlineNodes(node.content ?? []);
  }
}

/**
 * Converts a (already safe-subset-validated) `AdfDocument` to Jira wiki
 * markup — `h1.`-`h3.` headings, `*bold*`, `_italic_`, `{{code}}`,
 * `[text|url]` links, `*`/`#` list bullets, `{code}...{code}` fenced
 * blocks, and `bq. ` blockquotes — matching `@eo/renderer`'s
 * `toWikiMarkup` syntax choices exactly.
 */
export function adfDocumentToWikiMarkup(doc: AdfDocument): string {
  return doc.content
    .map(renderBlockNode)
    .join("\n\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
