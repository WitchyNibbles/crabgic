// Conventional-commit types restricted to the roadmap's closed set
// (phase 01, work item 4): feat|fix|refactor|docs|test|chore|perf|ci.
// Notably excludes conventional-commit's own defaults `build` and `revert`
// and any others outside this closed list.
export default {
  extends: ["@commitlint/config-conventional"],
  rules: {
    "type-enum": [2, "always", ["feat", "fix", "refactor", "docs", "test", "chore", "perf", "ci"]],
  },
};
