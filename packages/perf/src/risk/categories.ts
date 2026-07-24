import { PERFORMANCE_RISK_CATEGORIES, type PerformanceRiskCategory } from "@eo/contracts";

/**
 * Re-exported for convenience (mirrors `@eo/gates/risk-tags.ts`'s own
 * re-export-for-convenience pattern for `IntentContractSectionKey`) so
 * callers of this module don't need a second `@eo/contracts` import just
 * for the type/list — roadmap/15 §In scope, "Risk detection": "Categories:
 * CPU, allocation, copying, I/O, networking, database, serialization,
 * concurrency, caching, dataset-size, user-visible hot paths" (the 11
 * categories `@eo/contracts`' `PERFORMANCE_RISK_CATEGORIES` already names).
 */
export { PERFORMANCE_RISK_CATEGORIES };
export type { PerformanceRiskCategory };

/**
 * Diff-path heuristic table — one or more regexes per risk category, each
 * matched against a changed file's repo-relative path. This phase's own
 * minimal-sufficient choice: no fixed heuristic taxonomy is pinned by any
 * cited source material (roadmap/15 §In scope only names the 11
 * categories, never the detection rule), so this module documents its own
 * interpretation openly (see docs/evidence/phase-15/README.md) rather than
 * silently inventing one. Deliberately permissive (a path may match more
 * than one category) — risk detection is a lightweight TAG, not a full
 * benchmark (roadmap/15 §In scope: "a lightweight risk tag, not a full
 * benchmark").
 */
export const DIFF_PATH_RISK_PATTERNS: ReadonlyMap<PerformanceRiskCategory, readonly RegExp[]> =
  new Map([
    ["cpu", [/\b(hash|crypto|compress|codec|regex|sort|algorithm|compute)\b/i]],
    ["allocation", [/\b(alloc|buffer|pool|arena)\b/i]],
    ["copying", [/\b(clone|copy|duplicate|deepcopy)\b/i]],
    ["io", [/(^|\/)(fs|file|disk|stream)s?(\/|\.|$)/i, /\bfilesystem\b/i]],
    ["networking", [/\b(net|socket|http|https|websocket|grpc|fetch)\b/i]],
    ["database", [/\b(db|database|sql|query|repository|orm|prisma|knex)\b/i]],
    ["serialization", [/\b(serde|proto|marshal|encode|decode|serializ|deserializ)\w*\b/i]],
    ["concurrency", [/\b(concurren\w*|thread|worker|mutex|lock|async|queue)\b/i]],
    ["caching", [/\b(cache|memo\w*)\b/i]],
    ["dataset_size", [/\b(dataset|bulk|batch|import|export|migration|seed)\b/i]],
    ["user_visible_hot_path", [/\b(route|handler|controller|page|component|render|view)\b/i]],
  ]);
