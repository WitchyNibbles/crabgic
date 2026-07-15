# Release notes prep

This document tracks release-facing facts recorded ahead of time, so phase
23 (release hardening) has a settled record to re-check against rather than
re-deriving them from scratch.

## npm package name availability — `engineering-orchestrator`

**Verdict: available (unclaimed) as of 2026-07-15T14:04:27Z.**

```
$ npm view engineering-orchestrator
npm error code E404
npm error 404 Not Found - GET https://registry.npmjs.org/engineering-orchestrator - Not found
npm error 404
npm error 404  The requested resource 'engineering-orchestrator@*' could not be found or you do not have permission to access it.
npm error 404
npm error 404 Note that you can also install from a
npm error 404 tarball, folder, http url, or git url.
npm error A complete log of this run can be found in: /home/eimi/.npm/_logs/2026-07-15T14_04_27_174Z-debug-0.log
```

An npm registry `404` for `npm view <name>` means no package has ever been
published under that name — i.e. the name is currently available to claim.
This was checked twice during phase 01 (once at 2026-07-15T13:48:36Z, again
at 2026-07-15T14:04:27Z above); both checks returned the same `E404`
verdict.

This name is the one `packages/cli`'s `package.json` declares (`"name":
"engineering-orchestrator"`) as the package intended to be published — see
`docs/evidence/phase-01/README.md` for the design-decision note on why the
CLI package, specifically, carries this name (the monorepo root itself is
`private: true` and never published).

**Re-check required at phase 23.** Per phase 01's own Risks section
("npm package-name collision"): this phase only records the verdict above.
Phase 23's real `v1.0.0` publish step re-checks the same name against this
record before publishing; if the name has since been claimed by someone
else, that is a product decision escalated to the repository owner at that
point — not resolved retroactively here.

## Status

- [x] `engineering-orchestrator` name-availability verdict recorded
      (work item 6, this document).
- [ ] Real `v1.0.0` publish — owned by phase 23, not this phase.
