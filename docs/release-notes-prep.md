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
- [x] Real `v1.0.0` publish — owned by phase 23, not this phase.

## Evidence (2026-08-06)

The box above was ticked by the closeout pass that checked it, against the public registry
rather than against a workflow's report of itself. Read-only throughout; nothing was published,
tagged or dispatched.

- `npm view crabgic versions` lists `1.0.0` through `1.5.0`; `npm view crabgic dist-tags`
  returns `{ latest: '1.5.0' }`.
- `npm view crabgic@1.0.0 dist.attestations` returns a `provenance` object whose
  `predicateType` is `https://slsa.dev/provenance/v1`. That is the only provenance fact checked
  here, and it is stated no more strongly than that.
- The current line was published by the tag-gated `publish` run
  [30581930006](https://github.com/WitchyNibbles/crabgic/actions/runs/30581930006) at `6b9dd7b`,
  whose publish job 91005463475 logs `+ crabgic@1.5.0` after signing a provenance statement.
- Disclosed, because it is easy to misread: the **v1.0.0** tag's own publish run 30249669814 is
  **red**. What failed in it is the POST-publish re-check — the registry had not begun serving a
  brand-new package name — not the publish, which succeeded with provenance. The first bullet
  above is that re-check, passing today.

Captured verbatim in `docs/evidence/phase-23/closeout/c14-release-docs-citations.txt`.

## Re-check 2026-08-07 — release-time verdict for the 1.6.0 cut

**Verdict: available as of 2026-08-07T10:02:31Z** — read in the sense this check exists to
establish, stated explicitly below because the 2026-07-26 sense above stopped being true at the
v1.0.0 publish.

The re-check was run against the live public registry at the timestamp above. Real output, pasted
rather than reconstructed:

```
$ date -u +%Y-%m-%dT%H:%M:%SZ
2026-08-07T10:02:31Z

$ npm view crabgic

crabgic@1.5.0 | Apache-2.0 | deps: 4 | versions: 10
crabgic CLI & doctor (roadmap/09-cli-and-doctor.md).
https://github.com/WitchyNibbles/crabgic#readme

bin: crabgic, crabgic-supervisord

dist
.tarball: https://registry.npmjs.org/crabgic/-/crabgic-1.5.0.tgz
.shasum: 15bcfe1c3a3df0143fd254af0a15a147c9eea337
.integrity: sha512-DPcZSUO+3+tCRDpvT5tNR9fuuJLwHIftB3TRqZYk3OuWr5kVcgiIdjny+jHh7WD0+KyCdEGuZ352tx18QAKq+A==
.unpackedSize: 1.4 MB

dependencies:
@anthropic-ai/claude-agent-sdk: 0.3.218, @modelcontextprotocol/sdk: 1.29.0, zod: 4.4.3, zod-to-json-schema: 3.25.2

maintainers:
- witchynibbles <eimimartinezarenas@gmail.com>

dist-tags:
latest: 1.5.0

published a week ago by witchynibbles <eimimartinezarenas@gmail.com>

$ npm view crabgic dist-tags
{ latest: '1.5.0' }

$ npm view crabgic@1.6.0 version
npm error code E404
npm error 404 No match found for version 1.6.0
npm error 404
npm error 404  The requested resource 'crabgic@1.6.0' could not be found or you do not have permission to access it.
```

**What the word means here, and what it does not.** `available` above means: the name `crabgic`
resolves to **this project's own package**, published by this project's own maintainer account, and
the version about to be cut — `1.6.0` — is **unclaimed on the registry** (`E404` for
`crabgic@1.6.0`, quoted above), so the publish can proceed. It does **not** mean the 2026-07-26
sense, "no package has ever been published under this name": ten versions, `1.0.0` through `1.5.0`,
are published, and `latest` is `1.5.0`. The original 2026-07-26 record stands verbatim above as the
record of the pre-first-publish state; this section supersedes it in place for release-time purposes
rather than rewriting it.

**Why it is recorded at all.** `e2e/release/src/npmNameRecheck.ts` requires a
`Verdict: available|taken … as of <ISO-8601>` on one line, no older than its
`NPM_NAME_RECHECK_MAX_AGE_DAYS` window of 7 days, and folds any failure into the
`reproducible-build` gate item as a blocking reason. The 2026-07-26 record went stale on 2026-08-02
and was **11 days old** on 2026-08-07 — measured by running the real function against this repo, not
inferred: `{ recordedAt: "2026-07-26T18:11:17Z", ageDays: 11, verdictAvailable: true, fresh: false }`
with one blocking reason. That window is exactly what makes a release-time re-check auditable, and
this section is the re-check for the 1.6.0 cut.

**A disclosed limitation of the check itself, filed rather than papered over.** The check has only
two verdict words, and both were minted before the first publish: `taken` means _somebody else_
claimed the name and fails the gate outright as a product decision for the owner. It has no way to
express "the name is ours and the version we are cutting is free", which is the true state from
v1.0.0 onward — so the honest verdict word is `available` **only** under the redefinition stated
above, and a reader who assumes the 2026-07-26 sense would be misled. The semantic gap is filed as
the defect record `23-npm-name-recheck-cannot-express-owned-name.md` under
`docs/evidence/criteria-closeout/defects/`; the wording of this section is a judgement call and is
flagged to the owner rather than settled here.
