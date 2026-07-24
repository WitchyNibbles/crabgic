/**
 * A minimal line-based diff renderer — roadmap/10-plugin-and-installer.md
 * §In scope, "Lifecycle": "full dry-run diff preview (`--json`)." A classic
 * LCS (longest-common-subsequence) diff; deliberately hand-rolled rather
 * than a new external dependency (this phase may not add one not already
 * in the root lockfile), and more than adequate for the small,
 * few-hundred-line artifacts this installer ever touches.
 */
export type DiffLine = { readonly kind: "context" | "add" | "remove"; readonly text: string };

function longestCommonSubsequenceLengths(
  oldLines: readonly string[],
  newLines: readonly string[],
): number[][] {
  const table: number[][] = Array.from({ length: oldLines.length + 1 }, () =>
    new Array<number>(newLines.length + 1).fill(0),
  );
  for (let i = oldLines.length - 1; i >= 0; i--) {
    for (let j = newLines.length - 1; j >= 0; j--) {
      table[i]![j] =
        oldLines[i] === newLines[j]
          ? table[i + 1]![j + 1]! + 1
          : Math.max(table[i + 1]![j]!, table[i]![j + 1]!);
    }
  }
  return table;
}

/** Renders a unified-style, line-by-line diff between `oldText` and `newText`. */
export function computeLineDiff(oldText: string, newText: string): readonly DiffLine[] {
  const oldLines = oldText.split("\n");
  const newLines = newText.split("\n");
  const lcs = longestCommonSubsequenceLengths(oldLines, newLines);

  const result: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < oldLines.length && j < newLines.length) {
    if (oldLines[i] === newLines[j]) {
      result.push({ kind: "context", text: oldLines[i]! });
      i++;
      j++;
    } else if (lcs[i + 1]![j]! >= lcs[i]![j + 1]!) {
      result.push({ kind: "remove", text: oldLines[i]! });
      i++;
    } else {
      result.push({ kind: "add", text: newLines[j]! });
      j++;
    }
  }
  while (i < oldLines.length) {
    result.push({ kind: "remove", text: oldLines[i]! });
    i++;
  }
  while (j < newLines.length) {
    result.push({ kind: "add", text: newLines[j]! });
    j++;
  }
  return result;
}

/** Renders `computeLineDiff`'s output as plain `+`/`-`/` ` prefixed text lines, for human-readable `--dry-run` output. */
export function renderUnifiedDiff(oldText: string, newText: string): string {
  return computeLineDiff(oldText, newText)
    .map((line) => `${line.kind === "add" ? "+" : line.kind === "remove" ? "-" : " "}${line.text}`)
    .join("\n");
}
