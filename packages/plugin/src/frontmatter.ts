/**
 * A minimal parser for the `---`-delimited frontmatter this package's own
 * `skills/*.md` and `agents/*.md` files use. Deliberately NOT a general YAML
 * parser — no new external dependency was added for this phase (root
 * lockfile constraint), and this package only ever emits (and therefore only
 * ever needs to read back) a small, flat `key: value` shape of its own
 * choosing: strings, booleans, and JSON-array-shaped values (`tools: [...]`).
 */
export interface ParsedFrontmatter {
  readonly attributes: Readonly<Record<string, string | boolean | readonly string[]>>;
  /**
   * Each key's VERBATIM value text, trimmed but otherwise untouched — quotes
   * still on, no boolean/array interpretation.
   *
   * `attributes` is lossy on purpose (it hands callers usable values), and one
   * of its losses is load-bearing: `parseScalar` strips a layer of double
   * quotes, so `k: "30"` and `k: 30` become indistinguishable there while
   * `k: '30'` does not. A caller that must judge the LITERAL a downstream YAML
   * parser will see — as `validateSubagentFile` does for `maxTurns` — has to
   * read it before that stripping, which is what this map is for.
   */
  readonly raw: Readonly<Record<string, string>>;
  readonly body: string;
}

export class FrontmatterParseError extends Error {
  constructor(reason: string) {
    super(`could not parse frontmatter: ${reason}`);
    this.name = "FrontmatterParseError";
  }
}

function parseScalar(raw: string): string | boolean | readonly string[] {
  const trimmed = raw.trim();
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (Array.isArray(parsed) && parsed.every((v) => typeof v === "string")) {
        return parsed as string[];
      }
    } catch {
      // Fall through to the raw-string form below.
    }
  }
  // Strip a single layer of matching quotes, if present.
  if (trimmed.length >= 2 && trimmed[0] === '"' && trimmed[trimmed.length - 1] === '"') {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

/** Parses `content`'s leading `---`-delimited frontmatter block. Throws `FrontmatterParseError` if the content doesn't start with `---` or the closing delimiter is missing. */
export function parseFrontmatter(content: string): ParsedFrontmatter {
  const lines = content.split("\n");
  if (lines[0]?.trim() !== "---") {
    throw new FrontmatterParseError('content must start with a "---" delimiter line');
  }
  const closingIndex = lines.slice(1).findIndex((line) => line.trim() === "---");
  if (closingIndex === -1) {
    throw new FrontmatterParseError('no closing "---" delimiter found');
  }
  const frontmatterLines = lines.slice(1, closingIndex + 1);
  const body = lines
    .slice(closingIndex + 2)
    .join("\n")
    .replace(/^\n+/, "");

  const attributes: Record<string, string | boolean | readonly string[]> = {};
  const raw: Record<string, string> = {};
  for (const line of frontmatterLines) {
    if (line.trim().length === 0) continue;
    const separatorIndex = line.indexOf(":");
    if (separatorIndex === -1) {
      throw new FrontmatterParseError(
        `malformed frontmatter line (no ":"): ${JSON.stringify(line)}`,
      );
    }
    const key = line.slice(0, separatorIndex).trim();
    const value = line.slice(separatorIndex + 1);
    attributes[key] = parseScalar(value);
    raw[key] = value.trim();
  }

  return { attributes, raw, body };
}
