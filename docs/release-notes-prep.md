# Release notes prep

This document tracks release-facing facts recorded ahead of time, so phase
23 (release hardening) has a settled record to re-check against rather than
re-deriving them from scratch.

## npm package name availability — `crabgic`

**Verdict: available (unclaimed) as of 2026-07-26T18:11:17Z.**

RE-RECORDED 2026-07-26, and deliberately re-probed rather than rewritten. The project
was renamed from `engineering-orchestrator` to `crabgic`, and the transcript below is a
REAL `npm view crabgic` run captured at the timestamp above. Search-and-replacing the
old name inside the previous transcript would have produced a record claiming npm
returned output it never returned — fabricated evidence, which is precisely what this
document exists to prevent. The superseded `engineering-orchestrator` verdict
(2026-07-15T14:04:27Z, also a 404) is preserved in git history.

```
$ npm view crabgic
npm error code E404
npm error 404 Not Found - GET https://registry.npmjs.org/crabgic - Not found
npm error 404
npm error 404  The requested resource 'crabgic@*' could not be found or you do not have permission to access it.
npm error 404
npm error 404 Note that you can also install from a
npm error 404 tarball, folder, http url, or git url.
npm error A complete log of this run can be found in: /home/eimi/.npm/_logs/2026-07-26T18_11_18_037Z-debug-0.log
```

An npm registry `404` for `npm view <name>` means no package has ever been
published under that name — i.e. the name is currently available to claim.
This was checked twice during phase 01 (once at 2026-07-15T13:48:36Z, again
at 2026-07-15T14:04:27Z above); both checks returned the same `E404`
verdict.

This name is the one `packages/cli`'s `package.json` declares (`"name":
"crabgic"`) as the package intended to be published — see
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

- [x] `crabgic` name-availability verdict recorded
      (work item 6, this document).
- [ ] Real `v1.0.0` publish — owned by phase 23, not this phase.
