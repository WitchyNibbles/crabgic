import type { LintFinding, LintStageInput } from "./lint-types.js";

/**
 * URL-policy stage — roadmap/17 work item 3. Rejects raw HTML tags,
 * `javascript:`/`data:` URLs, and embedded remote images (markdown image
 * syntax pointing at any URL). Everything else — bare `https://` links,
 * markdown `[text](https://...)` links — is allowed; the scheme allowlist is
 * exactly `https:` (see `isAllowedLinkScheme`).
 */

export const STAGE_NAME_URL_POLICY = "url-policy";

// M1 fix (adversarial-review MEDIUM): the original attribute-separator
// group required literal WHITESPACE before any attribute content
// (`(?:\s[^<>]*)?`), so a slash-delimited attribute tag with no space
// before its first attribute — `<svg/onload=alert(1)>`, `<img/src=x
// onerror=y>` — stopped matching at the tag name and passed clean. The
// separator now also accepts `/` (HTML's own attribute/self-closing
// delimiter), matching real browser tag-parsing behavior.
const RAW_HTML_TAG_PATTERN = /<\/?[a-zA-Z][a-zA-Z0-9-]*(?:[\s/][^<>]*)?>/g;

// A URL with a `scheme://authority` shape (the only shape a legitimate
// `https://` link ever takes) — checked against the scheme allowlist.
const AUTHORITY_URL_PATTERN = /\b[a-zA-Z][a-zA-Z0-9+.-]*:\/\/[^\s)\]"'<>]+/g;

// The dangerous schemeless-authority `scheme:...` forms this stage exists
// to catch never carry a `//` authority component (e.g.
// `javascript:alert(1)`, `data:text/html;base64,...`) — matched by an
// explicit, fixed scheme name list rather than a generic `word:` pattern,
// which would false-positive on ordinary "Label:value" template text (e.g.
// a Jira template's `Ref:PROJ-123`).
const DANGEROUS_SCHEMELESS_PATTERN = /\b(javascript|data|vbscript|file):[^\s)\]"'<>]+/gi;

// Markdown image syntax: ![alt](url) — flagged unconditionally (roadmap/17:
// "no embedded remote images"), regardless of scheme.
const MARKDOWN_IMAGE_PATTERN = /!\[[^\]]*]\(([^)]+)\)/g;

const ALLOWED_LINK_SCHEMES = new Set(["https"]);

function findAllMatches(text: string, pattern: RegExp): RegExpExecArray[] {
  const matches: RegExpExecArray[] = [];
  const re = new RegExp(pattern.source, pattern.flags);
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    matches.push(match);
    if (match[0].length === 0) re.lastIndex += 1;
  }
  return matches;
}

function schemeOf(url: string): string | undefined {
  const match = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(url.trim());
  return match?.[1]?.toLowerCase();
}

export function urlPolicyStage(input: LintStageInput): readonly LintFinding[] {
  const text = input.candidate;
  const findings: LintFinding[] = [];

  for (const match of findAllMatches(text, RAW_HTML_TAG_PATTERN)) {
    findings.push({
      stage: STAGE_NAME_URL_POLICY,
      severity: "block",
      message: `raw HTML tag "${match[0]}" is not permitted in rendered communication text`,
      span: { start: match.index, end: match.index + match[0].length },
    });
  }

  for (const match of findAllMatches(text, MARKDOWN_IMAGE_PATTERN)) {
    findings.push({
      stage: STAGE_NAME_URL_POLICY,
      severity: "block",
      message: `embedded remote image "${match[0]}" is not permitted in rendered communication text`,
      span: { start: match.index, end: match.index + match[0].length },
    });
  }

  for (const match of findAllMatches(text, DANGEROUS_SCHEMELESS_PATTERN)) {
    const scheme = (match[1] ?? "").toLowerCase();
    findings.push({
      stage: STAGE_NAME_URL_POLICY,
      severity: "block",
      message: `disallowed URL scheme "${scheme}:" is not permitted`,
      span: { start: match.index, end: match.index + match[0].length },
    });
  }

  for (const match of findAllMatches(text, AUTHORITY_URL_PATTERN)) {
    const scheme = schemeOf(match[0]);
    if (scheme !== undefined && !ALLOWED_LINK_SCHEMES.has(scheme)) {
      findings.push({
        stage: STAGE_NAME_URL_POLICY,
        severity: "block",
        message: `URL scheme "${scheme}:" is not on the allowlist (only https: is permitted)`,
        span: { start: match.index, end: match.index + match[0].length },
      });
    }
  }

  return findings;
}
