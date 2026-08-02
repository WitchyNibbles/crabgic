# Phase 23 — work items 8 & 9: security review + release docs / ARM64 close-out

**Pre-rename names — annotated 2026-08-02, not rewritten.** This file was written before
`3e74cc7` (2026-07-26) renamed the project from `engineering-orchestrator` to `crabgic`, so
the names in it were the real ones when it was captured. This is an evidence file: the
original text stays verbatim and the mapping lives here. Read `@eo/x` as `@crabgic/x`; read
the product / binary / cache-path segment `engineering-orchestrator` as `crabgic`; and read
the gateway MCP server literal `eo_gateway` as `crabgic_gateway`, which is what
`GATEWAY_MCP_SERVER_NAME` holds today (`packages/contracts/src/gateway/server-name.ts:26`).
Nothing else about the citations changed — the modules, paths and tests they name are the
same ones. Two reading rules follow. Quotations keep their old names verbatim, because a
quotation records what its source said, not what is true now. And where this file asserts the
_absence_ of a hand-typed server literal (interface-ledger Gap 11), it asserts it about the
constant's value at the time; that rule is unchanged and the scan targets `"crabgic_gateway"`
today (`docs/evidence/phase-02/closeout-c8-gateway-literal-scan.txt`).

Governing spec: `roadmap/23-release-hardening.md`, work items 8 and 9. This note records the
process and sources for `docs/security-posture.md`, `docs/compatibility-matrix.md`,
`docs/operator-guide.md`, and `docs/upgrade-guide.md`, and the ARM64 close-out decision — a
docs-only pass, no `packages/*` edits.

## Scope of this pass

- **Read:** `roadmap/23-release-hardening.md` in full (work items 8/9, the security test-plan
  section, the docs exit criterion); `docs/threat-model.md` in full (all nine STRIDE surfaces
  - cross-surface themes + the reviewer's own open items); `docs/engine-baseline.md` in full;
    `docs/interface-ledger.md` (Gaps 1, 2, 5, 6, 10, 11, 12, 14 — the gaps the threat model and
    the phase evidence trail cite); `docs/release-notes-prep.md`; and every
    `docs/evidence/phase-*/README.md` for phases 02, 03, 05, 06 (including
    `wi6-security-hardening.md` and `wi7-adversarial-validation.md`), 07, 09, 10, 11, 12, 14, 15,
    16, 17, 18, 19, 20, 21, 22, plus the `docs/evidence/phase-23/provisioning/` capture logs.
- **Read (code, for citation accuracy only — not edited):** `packages/cli/src/commands/{dispatch.ts,help.ts,real-handlers.ts}`,
  `packages/cli/src/argv/types.ts`, `packages/cli/src/approval/prompt.ts`,
  `packages/cli/src/intake/run-intake-command.ts`, `e2e/release-gate-report.json`,
  `e2e/provisioning/src/provisioning.ts`, `docker/jira-datacenter/**`, `docker/grafana/**` —
  used only to verify that every CLI command and version claim in the new docs matches the
  real, shipped surface.
- **Written:** `docs/security-posture.md`, `docs/compatibility-matrix.md`,
  `docs/operator-guide.md`, `docs/upgrade-guide.md`, this file.
- **Not touched:** any file under `packages/*`, any other file under `docs/*`, the roadmap, or
  `docs/interface-ledger.md` itself (read-only per this task's constraints).

## Security review (work item 8) — method and verdict

`docs/threat-model.md` is a **design-level** document (dated 2026-07-15) that explicitly names
phase 23 as its own designated re-verification point: "Re-review is required once each phase
lands... this document should be revisited (not just re-cited) at that point" (§Scope and
non-goals; Review note item 7). This pass performed that re-verification by cross-checking
every mitigation the threat model cites against the actual implementation evidence now on
record for all nine surfaces (UDS, worker runtime, envelope compiler, installer, gateway,
connectors, capability quarantine, renderer, learning store) — all nine have since landed,
each with at least one adversarial-validation pass recorded in its own `docs/evidence/phase-*/`
directory.

**Verdict, recorded in full in `docs/security-posture.md`:** no unresolved CRITICAL or HIGH
security finding blocks this release. Every CRITICAL/HIGH finding an adversarial-validation
pass raised against any of the nine surfaces was fixed with a RED→GREEN regression test,
recorded in that phase's own evidence file, and in several cases (03, 07) independently
re-audited a second time after the fix. The specific findings, their fixes, and their exact
evidence citations are tabulated in `docs/security-posture.md`'s "CRITICAL/HIGH findings found
and fixed" section — eleven rows, spanning envelope compiler (03), git control repo (07),
intake/approval (11), renderer (17), gateway (16, three findings), Jira connector (18),
capability quarantine (12), and Grafana connector (20). A twelfth surface-level finding
(learning store, 22) was classified MAJOR by its own validator (not CRITICAL/HIGH — it required
direct in-process API access, unreachable from any model/MCP path) and is documented in
`docs/security-posture.md`'s per-surface section 9 rather than the CRITICAL/HIGH table, per
the validator's own severity call.

Nine items are recorded as **disclosed, non-blocking residual risk** in
`docs/security-posture.md` — every one is a design-time limitation the owning phase's own
evidence or the threat model itself already names (same-uid trust flattening,
`canUseTool`-under-`dontAsk` being an unprobed engine fact, the worktree-anchor live-matching
gap, quote-unaware Bash splitting, the capability-quarantine `JournalEntryType` gap, the
stage-5 sandbox harness's unverified invocation API, the optional upstream-MCP-client wrap's
unresolved quarantine status, renderer/gates' independently-maintained secret-pattern sets,
and the performance-budget's journal-anchored-but-not-signature-bound tamper-evidence). None
of these were newly discovered by this pass, and none meets the CRITICAL/HIGH bar that would
block release per 14's own gate semantics (mirrored explicitly in `docs/security-posture.md`'s
sign-off section).

**This review did not run new adversarial tests itself.** It is a cross-check that (a) every
mitigation the threat model specifies actually exists in the shipped code, and (b) every
severity-tagged finding already on record has a corresponding fix, not a re-derivation of new
attack surface. This is stated explicitly in `docs/security-posture.md`'s closing section,
"What this review does not claim."

## Compatibility matrix / release docs (work item 9) — method

`docs/compatibility-matrix.md` cites, per row: `docs/engine-baseline.md` for every Claude
Code/SDK version claim; the committed `docker/jira-datacenter/{10.3,11.3}/docker-compose.yml`
and `docker/grafana/{11.6,12.4,13.1}/docker-compose*.yml` recipes for container availability;
and the live capture logs under `docs/evidence/phase-23/provisioning/` for which containers
have actually been smoke-tested versus which are recipe-only.

**The one genuine gap found during this pass:** Grafana OSS 13.1 is not yet vendor-published
(Docker Hub returns `404` for `grafana-oss:13.1`/`:13.1.0`/`:13.1.1` as of this repository's
project date, while `grafana-enterprise:13.1` was published two days earlier) — captured
verbatim in `docs/evidence/phase-23/provisioning/grafana-13.1-tag-check.txt` and the
corresponding failing smoke-test log
(`grafana-13.1-oss-smoke-test-FAILS-vendor-tag-not-published.txt`). This is disclosed plainly
in `docs/compatibility-matrix.md` as a vendor-side timing gap, not a defect in this repository's
own recipe or provisioning harness — the compose file is already pinned to the tag it will
resolve to the moment Grafana Labs publishes it.

Every other compatibility claim in the new document is marked either verified (with its
citation) or **EVIDENCE-PENDING** (with the specific reason and the exact
`e2e/release-gate-report.json` item it corresponds to) — see
`docs/compatibility-matrix.md`'s "What is EVIDENCE-PENDING vs. verified" closing section,
cross-referenced directly against the current `e2e/release-gate-report.json` snapshot
(`releaseCandidateObjectId: 008ae4b2848d3d3c84a5b2d19100f12e073235e3`, `scoringMode: "interim"`,
all 15 checklist items currently `EVIDENCE-PENDING`). This document does not contradict or
attempt to override that report's own verdicts — it is more granular where individual
container smoke tests have actually run live, but agrees that the release candidate as a whole
has not yet cleared the full live-conformance matrix.

`docs/operator-guide.md` and `docs/upgrade-guide.md` cite real CLI command shapes read
directly from `packages/cli/src/commands/help.ts`'s `COMMAND_HELP` table,
`packages/cli/src/argv/types.ts`'s command interfaces, and `packages/cli/src/commands/
dispatch.ts`'s actual routing (including which commands still return the typed
`NOT_IMPLEMENTED` shape at this repository's current build — `connection *`, `trust *`,
`status` with no `run-id`). No command syntax in either document was invented.

## ARM64 close-out

**Honest status recorded in `docs/compatibility-matrix.md`: ARM64 has not been
hardware-verified.** This session's host is x86_64
(`6.6.87.2-microsoft-standard-WSL2`, per `docs/engine-baseline.md`'s own header) — no ARM64
hardware or emulated environment was available to verify against. Per this task's explicit
instruction, the compatibility matrix does **not** claim ARM64 was hardware-verified; instead
it:

1. Records x86-64 (this host, WSL2) as the fully hardware-verified substrate — every engine
   probe, every phase's gate results, and this very pass all ran on it.
2. Identifies the mechanism to close the gap: GitHub-hosted ARM64 runners
   (`ubuntu-24.04-arm` and siblings), the standard way to run this repository's existing CI
   suite on real ARM64 hardware without provisioning dedicated hardware in this development
   environment.
3. Marks execution against that mechanism as pending — consistent with, not contradicting,
   the current `e2e/release-gate-report.json`'s own `arm64-verification` item, which is
   `EVIDENCE-PENDING` in the snapshot read during this pass.
4. Names the concrete closing action (run the existing suite once on a GitHub-hosted ARM64
   runner against the exact release-candidate object ID, archive the resulting green run as
   the required `EvidenceRecord`) without performing it here — this is a docs-only pass with
   no CI-triggering capability.

## Gate check for the four new docs + this file

```
$ npx prettier --check docs/security-posture.md docs/compatibility-matrix.md \
    docs/operator-guide.md docs/upgrade-guide.md docs/evidence/phase-23/security-review-and-docs.md
```

Result recorded at the end of this docs-authoring pass — see the session's own command output;
all five files passed `prettier --check` with zero reformatting needed
(`docs/*.md` is not excluded by `.prettierignore` except for `README.md`, `CLAUDE.md`,
`docs/claude-code-adaptation.md`, and `docs/interface-ledger.md`, none of which this pass
touched).

No literal `eo_gateway` string was written in any of the five files produced by this pass —
every reference to the gateway's single MCP server name uses the `GATEWAY_MCP_SERVER_NAME`
constant's name in prose, consistent with interface-ledger Gap 11's sole-definition-site
discipline (the scanner itself is scoped to `packages/*`, but this pass avoided the literal in
`docs/*` as well, per this task's own explicit constraint).

## Files produced by this pass

- `docs/security-posture.md`
- `docs/compatibility-matrix.md`
- `docs/operator-guide.md`
- `docs/upgrade-guide.md`
- `docs/evidence/phase-23/security-review-and-docs.md` (this file)

No `packages/*` file, no other `docs/*` file, and no roadmap file was edited.
