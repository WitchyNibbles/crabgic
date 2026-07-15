# Contributing

Thanks for your interest in the Engineering Orchestrator. This repository
follows a phase-based roadmap (see `roadmap/`) and a strict TDD workflow.
Please read this document before opening a pull request.

## The phase workflow

Every unit of work in this repository — whether it's a roadmap phase or a
smaller follow-up change — follows the same sequence, and every step must
leave evidence behind, not just a claim:

1. **Failing tests first.** Before writing any implementation, write the
   test (or CI check, or fixture) that should fail against the current
   state of the repository. Run it and capture the failing output. This
   applies to meta-checks and toolchain enforcement points too (lint rules,
   coverage gates, commit-message rules), not only application code.
2. **Implement.** Write the minimal code needed to make the failing
   test/check pass.
3. **Verify green.** Re-run the test/check and capture the passing output.
   Both the failing and the passing runs are the evidence a change is real,
   not asserted.
4. **Independent review.** Every change gets reviewed before merge —
   correctness, security implications (whenever the attack surface
   changes), and adherence to the phase's own exit criteria.
5. **Exit-criteria evidence.** A phase (or change) is "done" only when every
   item in its exit-criteria checklist maps to a committed artifact, a CI
   run, or a journal entry — not a checkbox ticked from memory.

See `roadmap/README.md` for the ground rules this workflow is drawn from,
and `roadmap/NN-*.md` for any individual phase's specific work items, test
plan, and exit criteria.

## Before you open a pull request

- **Build, typecheck, test, lint all pass locally:**

  ```sh
  npm ci
  npm run build
  npm run typecheck
  npm test          # includes the 80% line+branch coverage gate
  npm run lint
  npm run format
  ```

- **Commit messages follow Conventional Commits**, restricted to this
  repository's closed set of types:

  ```
  feat|fix|refactor|docs|test|chore|perf|ci
  ```

  Example: `fix: correct workspace glob in root package.json`. Commit
  messages are linted by `commitlint` (see `commitlint.config.js`).

- **New/changed public behavior gets a changeset** (see `.changeset/`):

  ```sh
  npx changeset add
  ```

- **Coverage stays at or above 80% line+branch** on new/changed code — this
  is a greenfield-project rule, not a per-PR negotiation.

- **Don't touch a phase's declared "Interfaces produced"** without a
  coordinated cross-phase edit — the roadmap phase files name exact,
  stable identifiers (package paths, exported symbols, constants) that
  downstream phases depend on by name.

## Code style

- TypeScript, strict mode, `NodeNext` module resolution (see
  `tsconfig.base.json`). Formatting is enforced by Prettier
  (`.prettierrc.json`) and linting by ESLint (`eslint.config.js`) — run
  `npm run format:write` / `npm run lint:fix` before committing.
- Many small files over few large ones; keep functions small and errors
  handled explicitly and comprehensively — never swallowed silently.

## Security

If you believe you've found a security vulnerability, please follow the
private disclosure process in `SECURITY.md` instead of opening a public
issue or pull request.

## License

By contributing, you agree that your contributions will be licensed under
the Apache License, Version 2.0 (see `LICENSE` and `NOTICE`).
