import type { LintFinding, LintStageInput } from "./lint-types.js";

/**
 * `toADF` — Jira Cloud safe-subset markdown converter (roadmap/17
 * §Interfaces produced). By CONSTRUCTION, this converter only ever emits
 * node/mark types on `ADF_ALLOWED_NODE_TYPES`/`ADF_ALLOWED_MARK_TYPES` — it
 * has no mapping path to `layout*`, `panel`, `media*`, `mention`, `status`,
 * `emoji`, or `table*` nodes; any markdown construct it does not recognize
 * (a table, an image, an HTML block) degrades to a plain paragraph/text
 * node rather than ever being converted to a disallowed node type.
 * `validateAdfSafeSubset` is a separate, independent defense-in-depth
 * walker (roadmap/17 work item 5's failing-first fixture: "a disallowed ADF
 * node (e.g. `layoutSection`) must be rejected before the whitelist
 * exists") — it is exercised directly against hand-built `AdfNode` fixtures
 * in `adf.test.ts`, and wired into `lint()`'s own ADF-safe-subset stage for
 * the `jira_milestone_comment` kind.
 */

export const ADF_ALLOWED_NODE_TYPES = [
  "doc",
  "paragraph",
  "text",
  "heading",
  "bulletList",
  "orderedList",
  "listItem",
  "codeBlock",
  "blockquote",
  "hardBreak",
] as const;

export const ADF_ALLOWED_MARK_TYPES = ["link", "strong", "em", "code"] as const;

export const STAGE_NAME_ADF_SAFE_SUBSET = "adf-safe-subset";

// M2 fix (adversarial-review MEDIUM): phase 18 uses `validateAdfSafeSubset`
// standalone, with no `url-policy` stage running ahead of it (that stage
// only ever sees `lint()`'s own `jira_milestone_comment` candidate text, not
// an externally-sourced `AdfDocument` 18 hands this validator directly) — so
// a `link` mark's `href` ATTRIBUTE must be checked here too, not just its
// `type`. Same allowlist as `url-policy.ts`'s `ALLOWED_LINK_SCHEMES`
// (kept as an independent constant, not a cross-module import, since this
// validator is documented as "a separate, independent defense-in-depth
// walker" from the rest of the lint pipeline).
const ADF_ALLOWED_LINK_SCHEME = "https";

function hrefScheme(href: string): string | undefined {
  const match = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(href.trim());
  return match?.[1]?.toLowerCase();
}

/** `true` iff `href` is a string with an `https:` scheme — the only safe link-mark target. */
function isSafeHref(href: unknown): boolean {
  return typeof href === "string" && hrefScheme(href) === ADF_ALLOWED_LINK_SCHEME;
}

export interface AdfMark {
  readonly type: string;
  readonly attrs?: Record<string, unknown>;
}

export interface AdfNode {
  readonly type: string;
  readonly attrs?: Record<string, unknown>;
  readonly content?: readonly AdfNode[];
  readonly text?: string;
  readonly marks?: readonly AdfMark[];
}

export interface AdfDocument {
  readonly type: "doc";
  readonly version: 1;
  readonly content: readonly AdfNode[];
}

/**
 * Walks `doc` and returns one finding per node/mark type outside the
 * whitelist — never a bare boolean (matching `LintFinding`'s own
 * convention). Independent of, and never invoked by, `toADF` itself (a
 * converter that never produces a disallowed node needs no self-check) —
 * this exists so a hand-built or externally-sourced `AdfDocument` (e.g. an
 * 18-side incoming-payload fixture) can be validated against the identical
 * whitelist, per roadmap/17 §Test plan: "`toADF` output checked against the
 * same safe-subset whitelist 18 validates incoming payloads with."
 */
export function validateAdfSafeSubset(doc: AdfDocument): readonly LintFinding[] {
  const findings: LintFinding[] = [];

  function walk(node: AdfNode): void {
    if (!(ADF_ALLOWED_NODE_TYPES as readonly string[]).includes(node.type)) {
      findings.push({
        stage: STAGE_NAME_ADF_SAFE_SUBSET,
        severity: "block",
        message: `ADF node type "${node.type}" is not in the safe-subset whitelist`,
      });
    }
    for (const mark of node.marks ?? []) {
      if (!(ADF_ALLOWED_MARK_TYPES as readonly string[]).includes(mark.type)) {
        findings.push({
          stage: STAGE_NAME_ADF_SAFE_SUBSET,
          severity: "block",
          message: `ADF mark type "${mark.type}" is not in the safe-subset whitelist`,
        });
      } else if (mark.type === "link") {
        const href = mark.attrs?.["href"];
        if (!isSafeHref(href)) {
          findings.push({
            stage: STAGE_NAME_ADF_SAFE_SUBSET,
            severity: "block",
            message: `ADF link mark href ${JSON.stringify(href)} is not permitted (only an https: scheme is allowed)`,
          });
        }
      }
    }
    for (const child of node.content ?? []) {
      walk(child);
    }
  }

  for (const node of doc.content) walk(node);
  return findings;
}

interface InlineParseResult {
  readonly nodes: AdfNode[];
}

// Inline tokenizer: bold (**text**), italic (*text*/_text_), inline code
// (`text`), links ([text](https://...)), and explicit hard breaks (a
// backslash immediately before a newline — collapsed by the caller before
// this runs — or two-trailing-spaces has already been stripped by the
// renderer's own whitespace policy, so hard breaks are only recognized here
// as an explicit `\` line-continuation marker).
function parseInline(text: string): InlineParseResult {
  const nodes: AdfNode[] = [];
  const pattern = /\*\*(.+?)\*\*|\*(.+?)\*|_(.+?)_|`(.+?)`|\[([^\]]+)]\(([^)]+)\)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      nodes.push({ type: "text", text: text.slice(lastIndex, match.index) });
    }
    if (match[1] !== undefined) {
      nodes.push({ type: "text", text: match[1], marks: [{ type: "strong" }] });
    } else if (match[2] !== undefined) {
      nodes.push({ type: "text", text: match[2], marks: [{ type: "em" }] });
    } else if (match[3] !== undefined) {
      nodes.push({ type: "text", text: match[3], marks: [{ type: "em" }] });
    } else if (match[4] !== undefined) {
      nodes.push({ type: "text", text: match[4], marks: [{ type: "code" }] });
    } else if (match[5] !== undefined && match[6] !== undefined) {
      nodes.push({
        type: "text",
        text: match[5],
        marks: [{ type: "link", attrs: { href: match[6] } }],
      });
    }
    lastIndex = pattern.lastIndex;
  }
  if (lastIndex < text.length) {
    nodes.push({ type: "text", text: text.slice(lastIndex) });
  }
  if (nodes.length === 0) {
    nodes.push({ type: "text", text: "" });
  }
  return { nodes };
}

function headingLevel(marker: string): number {
  return Math.min(marker.length, 3);
}

/**
 * Converts a constrained markdown subset — paragraphs, `#`/`##`/`###`
 * headings, `-`/`*` bullet lists, `1.` ordered lists, fenced code blocks,
 * `>` blockquotes, and inline bold/italic/code/link marks — into an
 * `AdfDocument`. Unrecognized block constructs (tables, raw HTML, images)
 * fall back to a plain paragraph containing their literal text, never to a
 * disallowed node type.
 */
export function toADF(markdown: string): AdfDocument {
  const lines = markdown.split("\n");
  const content: AdfNode[] = [];
  let i = 0;

  function flushParagraph(paragraphLines: string[]): void {
    if (paragraphLines.length === 0) return;
    const text = paragraphLines.join(" ").trim();
    if (text.length === 0) return;
    content.push({ type: "paragraph", content: parseInline(text).nodes });
  }

  let paragraphBuffer: string[] = [];

  while (i < lines.length) {
    const line = lines[i]!;

    const headingMatch = /^(#{1,6})\s+(.*)$/.exec(line);
    const bulletMatch = /^[-*]\s+(.*)$/.exec(line);
    const orderedMatch = /^\d+\.\s+(.*)$/.exec(line);
    const blockquoteMatch = /^>\s?(.*)$/.exec(line);
    const fenceMatch = /^```/.test(line);

    if (fenceMatch) {
      flushParagraph(paragraphBuffer);
      paragraphBuffer = [];
      const codeLines: string[] = [];
      i += 1;
      while (i < lines.length && !/^```/.test(lines[i]!)) {
        codeLines.push(lines[i]!);
        i += 1;
      }
      content.push({
        type: "codeBlock",
        content: [{ type: "text", text: codeLines.join("\n") }],
      });
      i += 1;
      continue;
    }

    if (headingMatch) {
      flushParagraph(paragraphBuffer);
      paragraphBuffer = [];
      content.push({
        type: "heading",
        attrs: { level: headingLevel(headingMatch[1]!) },
        content: parseInline(headingMatch[2]!.trim()).nodes,
      });
      i += 1;
      continue;
    }

    if (bulletMatch) {
      flushParagraph(paragraphBuffer);
      paragraphBuffer = [];
      const items: AdfNode[] = [];
      while (i < lines.length) {
        const itemMatch = /^[-*]\s+(.*)$/.exec(lines[i]!);
        if (!itemMatch) break;
        items.push({
          type: "listItem",
          content: [{ type: "paragraph", content: parseInline(itemMatch[1]!).nodes }],
        });
        i += 1;
      }
      content.push({ type: "bulletList", content: items });
      continue;
    }

    if (orderedMatch) {
      flushParagraph(paragraphBuffer);
      paragraphBuffer = [];
      const items: AdfNode[] = [];
      while (i < lines.length) {
        const itemMatch = /^\d+\.\s+(.*)$/.exec(lines[i]!);
        if (!itemMatch) break;
        items.push({
          type: "listItem",
          content: [{ type: "paragraph", content: parseInline(itemMatch[1]!).nodes }],
        });
        i += 1;
      }
      content.push({ type: "orderedList", content: items });
      continue;
    }

    if (blockquoteMatch) {
      flushParagraph(paragraphBuffer);
      paragraphBuffer = [];
      const quoteLines: string[] = [];
      while (i < lines.length) {
        const quoteMatch = /^>\s?(.*)$/.exec(lines[i]!);
        if (!quoteMatch) break;
        quoteLines.push(quoteMatch[1]!);
        i += 1;
      }
      content.push({
        type: "blockquote",
        content: [{ type: "paragraph", content: parseInline(quoteLines.join(" ")).nodes }],
      });
      continue;
    }

    if (line.trim().length === 0) {
      flushParagraph(paragraphBuffer);
      paragraphBuffer = [];
      i += 1;
      continue;
    }

    paragraphBuffer.push(line);
    i += 1;
  }

  flushParagraph(paragraphBuffer);

  return { type: "doc", version: 1, content };
}

/**
 * The ADF safe-subset pipeline stage, applied only to `jira_milestone_comment`
 * (the only `ArtifactKind` ever transported through Jira Cloud's ADF
 * representation) — every other kind is a structural no-op here.
 */
export function adfSafeSubsetStage(input: LintStageInput): readonly LintFinding[] {
  if (input.kind !== "jira_milestone_comment") return [];
  return validateAdfSafeSubset(toADF(input.candidate));
}
