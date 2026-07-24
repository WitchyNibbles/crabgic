/**
 * Marker-delimited add-only merge for text artifacts (`CLAUDE.md`) —
 * roadmap/10-plugin-and-installer.md §Test plan, Unit: "add-only merge
 * writer (marker round-trip, idempotent re-merge — running `install` twice
 * diffs clean)." Everything outside the markers is the user's own content
 * and is never touched; everything between the markers is fully replaced
 * on each (re-)merge, so re-running install with identical desired content
 * is a byte-for-byte no-op.
 */
export const MANAGED_BLOCK_BEGIN =
  "<!-- BEGIN ENGINEERING ORCHESTRATOR MANAGED BLOCK (do not edit between these markers; re-run `engineering-orchestrator upgrade` instead) -->";
export const MANAGED_BLOCK_END = "<!-- END ENGINEERING ORCHESTRATOR MANAGED BLOCK -->";

export interface TextMergeResult {
  readonly content: string;
  readonly changed: boolean;
}

function buildBlock(desiredBlockContent: string): string {
  return `${MANAGED_BLOCK_BEGIN}\n${desiredBlockContent.trimEnd()}\n${MANAGED_BLOCK_END}`;
}

/**
 * Merges `desiredBlockContent` into `existingContent` (`undefined` for a
 * brand-new file):
 *  - No existing content → the managed block alone.
 *  - Existing content with no markers → the block is APPENDED, every
 *    existing byte preserved verbatim (add-only).
 *  - Existing content with both markers → only the text BETWEEN them is
 *    replaced; everything before/after is preserved verbatim. Idempotent:
 *    merging the same `desiredBlockContent` twice produces identical output
 *    the second time (`changed: false`).
 */
export function mergeManagedTextBlock(
  existingContent: string | undefined,
  desiredBlockContent: string,
): TextMergeResult {
  const block = buildBlock(desiredBlockContent);

  if (existingContent === undefined) {
    return { content: `${block}\n`, changed: true };
  }

  const beginIndex = existingContent.indexOf(MANAGED_BLOCK_BEGIN);
  const endIndex = existingContent.indexOf(MANAGED_BLOCK_END);

  if (beginIndex === -1 || endIndex === -1 || endIndex < beginIndex) {
    // No (valid) existing managed block — append, preserving every
    // meaningful byte of existing content (trailing-newline count is
    // normalized to a single canonical blank-line separator, so
    // `stripManagedTextBlock` can reverse this exactly).
    const trimmed = existingContent.replace(/\n+$/, "");
    const prefix = trimmed.length > 0 ? `${trimmed}\n\n` : "";
    return { content: `${prefix}${block}\n`, changed: true };
  }

  const before = existingContent.slice(0, beginIndex);
  const after = existingContent.slice(endIndex + MANAGED_BLOCK_END.length);
  const newContent = `${before}${block}${after}`;
  return { content: newContent, changed: newContent !== existingContent };
}

/**
 * The inverse of a merge: removes the managed block (markers included) from
 * `content`, returning whatever the user's own content was before/after it.
 * Used by `../uninstall.ts` to remove ONLY this installer's own managed
 * content from a merged file, never anything the user added themselves. If
 * `content` has no (valid) markers at all, it is returned unchanged.
 */
export function stripManagedTextBlock(content: string): string {
  const beginIndex = content.indexOf(MANAGED_BLOCK_BEGIN);
  const endIndex = content.indexOf(MANAGED_BLOCK_END);
  if (beginIndex === -1 || endIndex === -1 || endIndex < beginIndex) return content;

  // Mirrors the merge's own canonical-separator invariant above: strip the
  // blank-line separator immediately before BEGIN and the trailing newline
  // immediately after END, so a merge→strip round-trip restores exactly
  // the original pre-existing content.
  const before = content.slice(0, beginIndex).replace(/\n+$/, "");
  const after = content.slice(endIndex + MANAGED_BLOCK_END.length).replace(/^\n+/, "");

  if (before.length === 0) return after;
  return after.length > 0 ? `${before}\n\n${after}` : `${before}\n`;
}
