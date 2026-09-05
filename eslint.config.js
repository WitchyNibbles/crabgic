import js from "@eslint/js";
import tseslint from "typescript-eslint";
import eslintConfigPrettier from "eslint-config-prettier";
import globals from "globals";

export default tseslint.config(
  {
    /**
     * The recursive coverage glob names GENERATED report directories, which every workspace
     * root grows on `npm test`. It also matched `packages/gates/src/coverage/**`
     * — the changed-line coverage gate's own source — so 25 tracked source files
     * were exempt from `npm run lint` entirely, and were hiding real errors.
     *
     * ⚠️ THE RE-INCLUSION IS ANCHORED AT THE REPO ROOT, not on `src/`. An
     * earlier form of this comment claimed no generated report is ever under a
     * `src/` segment, and that is FALSE on disk right now:
     * `coverage/lcov-report/packages/gates/src/coverage/` is one. What makes
     * the negation safe is that every generated report lives beneath a
     * `coverage/` report root, so no such path can begin with `packages/` —
     * which this pattern requires. Re-widening the negation to a recursive
     * `src/coverage` glob would start feeding istanbul's own HTML to eslint.
     */
    ignores: [
      "**/dist/**",
      "**/coverage/**",
      "!packages/*/src/coverage/**",
      "**/node_modules/**",
      "**/*.d.ts",
      ".changeset/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
    rules: {
      "no-console": "off",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
  {
    files: ["**/*.mjs", "**/*.cjs", "**/*.js"],
    ...tseslint.configs.disableTypeChecked,
  },
  {
    /**
     * Claude Code `Workflow` scripts (roadmap/25 WI 7).
     *
     * They run inside the harness against injected globals and cannot import —
     * that is the constraint, not an oversight, and it is why the pipeline's
     * decisions live in `src/pipeline-driver.ts` where they can be tested.
     * Declaring the globals here is what lets the linter check these files at
     * all; without it every one is 12 `no-undef` errors and the real defects
     * hide among them.
     */
    files: ["packages/plugin/workflows/**/*.mjs"],
    languageOptions: {
      globals: {
        agent: "readonly",
        args: "readonly",
        budget: "readonly",
        log: "readonly",
        parallel: "readonly",
        phase: "readonly",
        pipeline: "readonly",
        workflow: "readonly",
      },
      parserOptions: { ecmaFeatures: { globalReturn: true } },
    },
  },
  eslintConfigPrettier,
);
