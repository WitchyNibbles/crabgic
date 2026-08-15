import js from "@eslint/js";
import tseslint from "typescript-eslint";
import eslintConfigPrettier from "eslint-config-prettier";
import globals from "globals";

export default tseslint.config(
  {
    ignores: ["**/dist/**", "**/coverage/**", "**/node_modules/**", "**/*.d.ts", ".changeset/**"],
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
