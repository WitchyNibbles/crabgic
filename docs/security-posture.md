# Security posture — threat model vs. implementation

**Status:** Phase 23 (release hardening) work item 8 — the security-review pass
`roadmap/23-release-hardening.md` requires against `docs/threat-model.md` (produced by
phase 02), focused on the 03/16 security keystones and 17's blocking-lint surface, mirroring
14's gate semantics: **a CRITICAL/HIGH finding blocks release.**

**Reviewer:** this orchestrated documentation pass, conducted by reading
`docs/threat-model.md` in full, then cross-checking every mitigation it cites against the
actual implementation evidence recorded under `docs/evidence/phase-*/README.md` (and the
per-file capture logs alongside those README's) for every phase the threat model names —
02, 03, 05, 06, 07, 09, 10, 11, 12, 14, 15, 16, 17, 18, 19, 20, 21, 22. This review does not
re-run any test itself; it verifies that the cited mitigation exists in the shipped code and
that every finding an adversarial validator raised against it was actually fixed and
re-verified, per the evidence trail already on record.

**Date:** 2026-07-24.

## Method

`docs/threat-model.md` was written at the design stage (2026-07-15, "Review note": "phases
03/05/06/10/12/16/17/22 are unimplemented as of this writing... every mitigation cited is a
specification commitment... not a verified-in-running-code fact"). It explicitly designates
phase 23 as "the roadmap's designated re-verification point" and asks that this document "be
revisited (not just re-cited)" once each phase lands. All nine surfaces have since landed;
every one of them was also subjected to at least one independent adversarial-validation pass
after its initial TDD build, and the fixes from those passes are the load-bearing evidence
this review cites. This document does not repeat the full STRIDE table — it states, per
surface, whether the design-time mitigation held up against implementation, citing the exact
file and evidence record, and calls out every CRITICAL/HIGH/MAJOR finding the adversarial
rounds found, with its fix and current status.

## Sign-off

**No unresolved CRITICAL or HIGH security finding blocks this release.** Every CRITICAL and
HIGH finding raised by an adversarial-validation pass against any of the nine threat-model
surfaces was fixed with a RED (reproduced against the pre-fix code) → GREEN (fixed,
re-verified) test pair, recorded in the cited evidence file, before that phase's own build
was considered closed. The table in "CRITICAL/HIGH findings found and fixed" below lists all
of them, by surface, with the exact fix and its regression test.

Three items are recorded as **disclosed, non-blocking residual risk** — each is a known,
intentional design limitation or a carry-forward already named in the owning phase's own
evidence, not a live exploitable gap discovered and left open. These are listed in "Residual
risk — disclosed, non-blocking" below, per the same disclosure discipline the threat model
itself already uses ("a cell with 'none material' as its residual risk... every other cell
names something concrete").

This mirrors 14's own gate semantics (`docs/evidence/phase-14/README.md`: a CRITICAL/HIGH
finding blocks; a fixed finding, re-verified, does not).

## CRITICAL/HIGH findings found and fixed

Every row below was raised by an independent adversarial-validation pass against an
otherwise-green TDD build, fixed with a failing-test-first regression, and re-verified
(several surfaces received a second, independent re-audit after the fix). Severity as
recorded by the validator that found it.

| Surface (threat-model §)                                                          | Severity              | Finding                                                                                                                                                                                                                                                                                                                                                                                                                | Fix                                                                                                                                                                                                                                                                                                                                                                                                                                               | Evidence                                                                                                                                                                                                                          |
| --------------------------------------------------------------------------------- | --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Envelope compiler (§3)                                                            | CRITICAL              | `compileEnvelope`'s `//`-anchor emission for `ownedPaths` had no validation and no worktree anchoring — a relative path like `["etc/cron.d"]` compiled to the filesystem-root grant `Edit(//etc/cron.d/**)`, an absolute system write from an innocuous input. No Edit/Write deny backstop existed.                                                                                                                    | `owned-path.ts`'s `validateOwnedPath` now rejects absolute/home-anchored/`..`-bearing/glob-bearing paths; every validated path is emitted worktree-anchored via a shared placeholder token; Edit/Write deny backstops added for every sensitive root plus the worktree's own `.git`. The property suite's "no allow outside the envelope" check was rewritten from a tautological string-equality test to a genuinely semantic confinement check. | `docs/evidence/phase-03/README.md` "CRITICAL 1 — owned-path confinement escape"; `fix-crit1-owned-path-escape-{failing,passing}.txt`; independently re-audited 2026-07-18 (~28 hostile paths, PASS, no new CRITICAL/MAJOR)        |
| Git control repo / worktrees (§ worker runtime, transitively)                     | CRITICAL              | Argument injection / option smuggling: `control-clone.ts`'s `fetchRefresh` and `overlap-analyzer.ts`'s `detectRenamesFromWorktree` passed caller-influenced values as bare positionals, letting a leading-`-` value (e.g. `--upload-pack=touch <marker>;git-upload-pack`) be parsed as a `git` flag — reproduced as a live RCE (a smuggled `touch`) and a live arbitrary-file-overwrite, both against real git 2.43.0. | Every named call site now inserts `--end-of-options` (or, for `rev-parse`, `--verify --end-of-options`, the one subcommand that doesn't honor a bare terminator) before any caller-influenced positional, plus boundary validation (`assertSafeRefPositional`, `assertObjectId`) rejecting a leading-`-` value before git is ever spawned.                                                                                                        | `docs/evidence/phase-07/README.md` "CRITICAL 1 — argument injection / option smuggling"; `fix-crit1-argument-injection-{failing,passing}.txt`; `argument-injection.regression.test.ts` reproduces both exploits, then blocks them |
| Intake / IntentContract / approval envelope (§ envelope compiler, upstream of §3) | CRITICAL              | Confused deputy: `contract.approve`'s handler took `changeSetId`/`digest`/`token` as three independent inputs and verified the token against the CALLER's own supplied `digest`, never confirming the token actually belonged to that `changeSetId`'s envelope — a token minted for ChangeSet A's envelope could flip a different ChangeSet B to `ready`.                                                              | The handler now derives the expected digest **server-side** (`changeSetId → envelope registry → canonicalHash`), cross-checks the caller's digest against it before the token is even touched, and verifies the token against the server-derived digest, never the caller-supplied one.                                                                                                                                                           | `docs/evidence/phase-11/README.md` "CRITICAL C1 (confused deputy)"; `contract-approve-handler.test.ts`'s "a valid token minted for a DIFFERENT ChangeSet's envelope cannot approve this ChangeSet" test                           |
| Renderer (§8)                                                                     | CRITICAL              | `secret-scan.ts`'s generic `sk-[A-Za-z0-9]{20,}` pattern broke at the first hyphen — hyphenated modern key formats (`sk-ant-...`, `sk-proj-...`) passed the lint clean, meaning a real Anthropic/OpenAI-shaped secret could reach a rendered Jira comment or PR body undetected.                                                                                                                                       | `secret-scan.ts` gained dedicated Anthropic-style, OpenAI-style, and hyphen-inclusive generic patterns.                                                                                                                                                                                                                                                                                                                                           | `docs/evidence/phase-17/README.md` "C1 (CRITICAL)"; `secret-scan.test.ts` new cases; new corpus fixtures `attack-secret-anthropic-key.json`, `attack-secret-openai-project-key.json`                                              |
| Gateway (§5)                                                                      | HIGH (#1)             | DNS-rebind TOCTOU: `http-client.ts` resolved+validated the hostname's IP for the SSRF check, but `http-transport.ts` dialed by hostname, which `node:https` re-resolves at connect time — a rebinding resolver could return a public IP at check time and a private/metadata IP at connect time, bypassing the SSRF guard entirely.                                                                                    | `http-transport.ts` now dials the one literal, pre-validated IP (`pinnedAddress`), preserving the hostname only as TLS SNI/`Host` header; `http-client.ts`'s preflight threads that single validated address through every hop — the address checked is the address dialed, never re-resolved.                                                                                                                                                    | `docs/evidence/phase-16/README.md` "HIGH #1"; `http-transport.test.ts`/`http-client.test.ts` "DNS pinning" describe blocks (rebinding-resolver simulation)                                                                        |
| Gateway (§5)                                                                      | HIGH (#2, "the crux") | `tracker.apply`/`observability.apply` dispatched straight to the raw provider client, bypassing `executeMutationPlan` entirely — no journal-before-I/O, no idempotency, no read-back/verify, and no SSRF-guarded `GatewayHttpClient` on the mutate path at all.                                                                                                                                                        | Mutating tools were split into a dedicated, schema-validated `RemoteMutationPlan`-only tool; `executeMutationPlan` is now the sole issuer of the mutation's network I/O, via the SSRF-guarded `GatewayHttpClient`.                                                                                                                                                                                                                                | `docs/evidence/phase-16/README.md` "HIGH #2"; `native-registry.test.ts`'s "HIGH #2 adversarial-review fix" describe block (journal-before-I/O + SSRF-guard proof)                                                                 |
| Gateway (§5)                                                                      | MEDIUM/HIGH (#3)      | The exactly-once crash matrix was proven only against a self-idempotent PUT; the pre-I/O bookkeeping record used a different `operationId` than the real dedup key, so a real restart never saw it — a kill-after-commit-before-record crash could re-apply a genuinely non-idempotent POST/create.                                                                                                                    | `mutation-pipeline.ts` now owns the full `pending → recorded/conflict/failed` state machine directly over the journal, using the **same** `operationId` for the pending write and every terminal write.                                                                                                                                                                                                                                           | `docs/evidence/phase-16/README.md` "MEDIUM/HIGH #3"; new kill-harness fixture `nonidempotent-post-and-crash.mjs`; "restart finds a pending record" / "a prior TERMINAL record is never silently re-run" test blocks               |
| Jira Cloud connector (§6, connectors)                                             | HIGH (H2)             | `planIssueTransition` trusted a caller-supplied `targetStageIsDone` boolean rather than resolving the transition's real target status server-side — a forged `false` on a genuinely closing transition skipped the done-transition evidence gate and the closing-transitions high-impact-capability flag, while the write still closed the issue for real.                                                             | `issues.planTransition` is now `async` and no longer accepts the boolean at all — it resolves the transition's real target status itself via a live `issues.transitions(issueKey)` read, and an unrecognized transition is refused, never guessed.                                                                                                                                                                                                | `docs/evidence/phase-18/README.md` "H2 (HIGH)"; rewritten `jira-resource-client.test.ts` `planTransition` suite                                                                                                                   |
| Stack detection / capability quarantine (§7)                                      | HIGH                  | `walkRepoTree`'s symlink handling had no visited-realpath tracking and a `maxEntries` bound that only decremented on files — a directory of self-referential symlinks recursed with unbounded branching factor, an unkillable synchronous CPU-bound hang (a DoS against any untrusted/cloned project this detector scans).                                                                                             | Every directory visit now carries a per-branch ancestor-realpath set; re-entering an already-visited realpath on the current path is refused, turning the walk into a true tree traversal regardless of symlink aliasing; a directory-visit budget was added as defense-in-depth.                                                                                                                                                                 | `docs/evidence/phase-12/README.md` "1 (HIGH, confirmed DoS)"; `safe-walk.test.ts`'s termination-bound and diamond-non-false-positive cases                                                                                        |
| Grafana connector (§6, connectors)                                                | HIGH                  | `verify()`/`reconcileAmbiguous()` compared the remote read-back against the raw, un-marked input, but `annotation`'s create request always injects an `eo-marker:<uid>` tag before sending — every genuinely successful annotation create was recorded `failed` against a real Grafana (an integration-safety defect: the exactly-once pipeline could never confirm its own successful writes for this resource kind). | Added a `canonicalizeDesiredInput` method every resource definition implements — the connector's actual desired wire state, never the raw caller input — and `verify()`/`reconcileAmbiguous()` now compare against it.                                                                                                                                                                                                                            | `docs/evidence/phase-20/README.md` "HIGH (annotation read-back verify structurally broken)"; `mutation-apply-client.test.ts`'s regression case                                                                                    |

No unresolved CRITICAL or HIGH finding remains against any of the nine threat-model surfaces
as of this review.

## Per-surface review (threat model §1–§9)

### 1. UDS control plane

Implementation: `packages/supervisor` (05). The design-time mitigations (`SO_PEERCRED`
uid-check, versioned handshake, journal-before-effect, `0600`/`0700` socket mode, 1 MiB
per-worker log ring buffer with backpressure) were all built and unit/property-tested; two
independent adversarial passes returned **no CRITICAL/MAJOR finding** for this package
(`docs/evidence/phase-05/README.md`: "Two independent Opus validators PASSED this phase's
exit criteria... no CRITICAL/MAJOR findings"). Three smaller items were raised and two fixed
in the same pass: a weak drop-count test oracle (fixed, mutant-killed) and an unbounded
ndjson line-read buffer on the real `uds-server.ts` connection handler that could OOM the
host from an admitted same-uid peer (fixed with a 1 MiB `MAX_LINE_BYTES` cap,
`LineTooLongError`). The residual same-uid trust-flattening risk the threat model names
(§Cross-surface residual theme 1) is a stated design choice, unchanged by implementation —
see "Residual risk" below.

### 2. Worker runtime

Implementation: `packages/engine-claude` (06), layered on `packages/engine-core`'s compiled
profile (03). The static allow/deny + OS sandbox enforcement core — the load-bearing
layer — was found **solid and unchanged** by 06's own pre-commit adversarial pass
(`docs/evidence/phase-06/wi7-adversarial-validation.md`: "The static enforcement core...
was found SOLID and is unchanged"). That same pass found one CONFIRMED CRITICAL, fixed
before the phase's first commit: `resume()`/`fork()` crashed permanently on the
`credentialsFile` auth path (`provisionWorkerAuth`'s exclusive-create threw on the second
call to the same, already-provisioned directory, indistinguishable from an ordinary crash —
a crash-loop for the confirmed-PASS credential fallback). Fixed by making
`provisionWorkerAuth` idempotent for that path (byte-identical dest accepted, mismatched dest
refused, symlink/non-regular dest still refused). A separate, earlier adversarial round
(06's own `wi6-security-hardening.md`) found and fixed five MAJOR/MINOR findings, most
notably **Finding 5**: `.credentials.json` provisioning followed a destination symlink with
no exclusivity check — a pre-planted symlink at the config-dir destination could leak the
owner's real subscription credentials. Fixed with an exclusive, no-follow create
(`O_CREAT|O_EXCL|O_WRONLY|O_NOFOLLOW`) that refuses both a pre-existing dest and a symlinked
dest, never following it. See "Residual risk" for the one carried-forward guarantee downgrade
(the per-call adjudication-**journaling** backstop is live-unverified pending an
engine-fact probe) — the load-bearing static enforcement is unaffected by it.

### 3. Envelope compiler

Implementation: `packages/engine-core` (03), the design's explicitly named "security
keystone." The CRITICAL owned-path confinement escape (table above) was the headline
finding; two MAJORs were fixed alongside it: a fake-engine shell-metacharacter smuggling gap
(`&`, `$`, backtick, `<`, `>`, newline could smuggle a command past the conformance oracle —
fixed by denying any segment carrying one, closing this fake engine, which 05/06 reuse as
their conformance oracle) and tautological tests (the "no allow outside the envelope"
property re-derived the compiler's own emitted string and could never detect a confinement
escape by construction — rewritten to a genuinely semantic check). A fresh, independent
re-audit after all fixes landed re-attacked all five findings (~28 hostile `ownedPaths`
through the real compiler, the full shell-metacharacter battery, an independent check that
the new confinement matcher is non-vacuous) and returned **PASS**, raising only three LOW
residuals, all disposed of or accepted as documented, non-exploitable hardening gaps
(`docs/evidence/phase-03/README.md`, "Independent re-audit (2026-07-18)").

### 4. Installer

Implementation: `packages/plugin` + `packages/cli`'s `src/installer/` (10). An adversarial
pass found one MEDIUM (confirmed monotonicity violation: `mergeSettingsJson`/`mergeMcpJson`
treated a present-but-non-object `enabledPlugins`/`mcpServers` value as absent and silently
overwrote it, destroying the user's own value — fixed by checking key presence, not
object-shape, before ever touching a key) and one LOW/MEDIUM (`eo-reviewer.md`'s subagent
declared `Bash` in its tool list, defeating the "manager subagents are never write-capable"
requirement since `Bash` isn't read-only-constrainable at the declaration level — fixed by
removing it and extending the plugin-manifest validator's `WRITE_CAPABLE_TOOLS` rejection set
to also cover `Bash`/`NotebookEdit`). Both fixed with regression tests
(`docs/evidence/phase-10/README.md`, "Adversarial-review fixes"). The `enabledPlugins` key
format (`<plugin-name>@<marketplace-name>`, not the bare name) was verified live against the
real `claude` 2.1.218 binary rather than assumed — see `docs/engine-baseline.md` §12.

### 5. Gateway

Implementation: `packages/gateway` (16), the design's other explicit "security keystone."
Five interrelated findings were found and fixed (table above: HIGH #1 DNS-pinning TOCTOU,
HIGH #2 the mutate-path SSRF/exactly-once bypass, MEDIUM/HIGH #3 the exactly-once
identity-mismatch, MEDIUM #4 an IPv4-mapped/NAT64-embedded IPv6 SSRF-classifier gap, MEDIUM
#5 no concurrency serialization on same-idempotency-key calls). All five are fixed and
re-verified against the full 278-test suite (`docs/evidence/phase-16/README.md`). The one
threat-model-acknowledged open item — the optional upstream-MCP-client wrap's quarantine
status — is unchanged by implementation and carried forward; see "Residual risk" below.

### 6. Connectors

Implementation: `packages/connectors-jira` (18, reused by 19) and `packages/connectors-grafana`
(20). Jira's H2 (forged `targetStageIsDone`, table above) was the headline finding; a MEDIUM
(M3) improved test coverage of the done-category resolution's own documented, intentional
"trust Jira's own fixed-enum `statusCategory.key`" choice, and two LOW findings (an
unrecognized MIME-type lookup-table gap) were fixed alongside. Grafana's HIGH annotation
verify-mismatch (table above) was fixed alongside two LOW findings (nested-secret redaction
missed a non-top-level key; a result-budget check was unasserted on one collapse branch — both
fixed). Phase 19 (Jira Data Center) found and fixed one residual MAJOR: `codeBlock` content in
DC wiki-markup rendering wasn't routed through the round-1 escaping path, so a `{code}`/
`{noformat}` breakout token inside a fenced block could re-enter live wiki-markup parsing (the
same stored-content class round 1 closed for inline text, reachable through a different path)
— fixed with a zero-width-space neutralization technique that leaves rendered output visually
identical (`docs/evidence/phase-19/README.md`, "MAJOR (residual)"). Phase 21 added a
`remote_verification` gate binding every requirement's `EvidenceRecord` to a confirmed remote
revision, plus a security-fixture manifest naming 7 blocking entries (forged admin/delete,
tenant boundary, redaction across Jira/Grafana/gateway) — see "13. Cross-cutting: connector
evidence & drift" below.

### 7. Capability quarantine

Implementation: `packages/detect` (12). The confirmed-DoS HIGH finding (table above) was the
headline result; the pipeline's structural no-child-process-during-detection guarantee and
its model-self-approval-fails-closed test were confirmed sound. Two items the threat model
itself named as unresolved remain unresolved, unchanged by implementation (both disclosed,
non-blocking — see "Residual risk"): the capability-audit-verdict `JournalEntryType` gap, and
the stage-5 sandboxed-test harness's exact invocation API, which 12's own risk text already
flagged as an unverified build-time spike.

### 8. Renderer

Implementation: `packages/renderer` (17). Eleven real defects were found in a second
adversarial round after the initial build, headlined by the CRITICAL secret-scan gap (table
above); the rest were HIGH/MEDIUM/LOW precision gaps in the Unicode-defense, URL-policy, ADF
safe-subset, and evidence-claims stages (missing GCP/GitHub-fine-grained-PAT/raw-JWT
patterns; a slash-delimited-attribute XSS bypass in the HTML-tag check; an ADF `link` mark
whose `href` attribute was never validated; a ticket-key-shaped false-positive on standard
tokens like `SHA-256`; missing Greek-lowercase confusables; missing directional/line-separator
Unicode codepoints). All eleven were fixed with a corpus fixture added per attack, growing the
corpus from 22 to 33 fixtures (`docs/evidence/phase-17/README.md`, "Adversarial-review
remediation (round 2)").

### 9. Learning store

Implementation: `packages/learning` (22). The originally-reported build had **no unfixed
CRITICAL**, but an adversarial pass found the flagship self-promotion invariant was
**vacuously tested** and the actual promotion guard checked only `tokenId` string
distinctness, never authenticity/subject/binding — a direct in-process call with two
fabricated (never-minted) token strings could reach `promoted` with a real `ChangeSet`,
bypassing the CLI/terminal-approval/HMAC chain entirely. Classified MAJOR by the validator
(reachable only via direct in-process API calls, not via any model-invokable or MCP path — see
below). Fixed by removing the caller-suppliable `reviewApprovals` parameter shape entirely and
requiring every approval to pass through an injected, real `LearningReviewTokenVerifier` that
independently verifies signature, subject kind, and proposal binding before anything is
recorded (`docs/evidence/phase-22/README.md`, "Adversarial-validation repair pass"). The same
pass corrected an earlier, **false** claim in this package's own evidence doc that the guard
made an in-process call "structurally incapable" of promoting — no in-process library guard
can defend against a caller supplying its own hostile verifier implementation, and the
document now states the actually-enforced, actually-meetable invariant precisely: **no
MCP/model-invokable promotion path exists at all** (a permanent CI grep confirms zero
`learning.*` tool registrations), which is the real, load-bearing boundary a sandboxed worker
process cannot cross regardless of the in-process guard's own strength.

## Pending re-review — the approval model is being amended (2026-07-28)

Everything below this heading reviews the security posture **as shipped in `crabgic@1.3.0`**, in which
approval is a per-ChangeSet terminal prompt and §3's "the prompt is the only mint path" holds exactly as
written. Owner ruling of 2026-07-28 (**ledger Gap 18**, adaptation §5.5) replaces routine approval with a
standing `EnvelopePolicy` and a containment check at dispatch. **This document has not yet been re-reviewed
against that model, and the sign-off below does not cover it.**

Two things the re-review must establish, stated now so they are not lost:

- **The policy is unwritable from any session.** Part 3 of Gap 18 is the entire gate. A single
  policy-writing MCP tool, CLI command or skill reachable from a manager session collapses it completely,
  and would be a CRITICAL rather than a design trade-off.
- **The containment check is non-vacuous.** 03's own history is the reason to say so explicitly: its
  "no allow outside the envelope" property once re-derived the compiler's own output and could not have
  detected a confinement escape by construction (§3 below). A subset check tested against envelopes it
  built itself would repeat that exact defect one layer up.

One finding the amendment **removes** rather than adds: in `1.3.0` the minted approval token is printed by
`crabgic run --json` and consumed by `contract.approve` in a different process, so in a manager session the
model is the courier for a human-approval token. Under Gap 18 in-policy dispatch mints no token at all.
**Closed in code 2026-07-29:** `run` and `approve` now mint, verify and spend the token inside the one
process that rendered the prompt, and no result shape or rendered output carries it.

### The escalation prompt cannot prove a human answered it (2026-07-29)

Found by adversarial review of the `crabgic approve` implementation, reproduced live, and disclosed here
rather than papered over. `process.stdin.isTTY` answers only "is fd 0 a character device", so a pty
allocated by an agent's own shell satisfies it:
`script -qec "crabgic approve <digest>" /dev/null <<< yes` drove the prompt to completion where
`echo yes | crabgic approve <digest>` is correctly refused.

What now ships (`packages/cli/src/approval/interactive-terminal.ts`): the prompt is refused on a
non-TTY stdin, **and** refused when the process's environment carries agent-runtime or CI provenance
(`CLAUDECODE`, `CLAUDE_CODE_ENTRYPOINT`, `CLAUDE_CODE_SSE_PORT`, `CI`, `GITHUB_ACTIONS`, …) — markers that
survive precisely the pty wrapper that defeats an `isTTY` check, because `spawn` passes the parent
environment through. The prompt also now renders the authority itself (change set, owned paths, commands,
network destinations, credential references) instead of an opaque `canonicalHash`, so what the human
consents to is the grant rather than a hex string a model handed them.

**What that does and does not prove.** It reliably stops an agent or CI job approving _opportunistically_ —
the realistic case. It does **not** stop a deliberately evasive caller: `env -u CLAUDECODE …` strips a
marker, and no in-process check can distinguish a typed `yes` from a written one, because the process
cannot see the keyboard. Closing that needs consent to arrive through a channel the model did not create —
a human-started watcher the daemon queues approvals to, or an OS-mediated confirmation. **Owed, and a
product decision for the owner**; until it lands, the standing `EnvelopePolicy` (unwritable from any
session) is the control that carries the "the model can never satisfy its own gate" property, exactly as
roadmap/11 states.

### What the standing policy actually protects against (2026-07-30)

Gap 18 part 3 says "the model can never widen the policy. Creating or extending it is out-of-band:
`crabgic install`, or a human editing the file." Adversarial review found that sentence was doing
more work than the code could support, in two different ways.

**The install-time confirm had no idea who was answering — now fixed.** `createRealConfirmPolicy`
read `process.stdin` and accepted any `yes`, so `echo yes | crabgic install` from an agent's own
shell authored the very policy that decides what runs without review. This was demonstrated live
during the session that fixed it. The confirm now uses the same gate as the approval prompt
(`packages/cli/src/approval/interactive-terminal.ts`): a non-human context **skips** authoring and
says so, while the rest of `install` proceeds — plugin and settings work is legitimately
automatable, a standing authorization is not.

**The deeper limit, stated plainly because the docs previously implied otherwise.** The policy file
is mode 0600 at the owner's own uid. Anything running as the owner — including a manager session
with ordinary file access — can rewrite it directly, and no in-process check can prevent that. So
the honest scope is:

- **Against workers: enforced.** A worker is sandboxed with the state root outside its writable
  set, so it cannot reach the policy. This is the boundary the policy exists to be, and it holds.
- **Against a compromised or adversarial manager session: not a boundary.** Such a session has the
  owner's own authority and can edit the file, the source, or anything else the owner can. Treating
  the policy as protection there would be security theatre.

That is not a reason to weaken it — the worker boundary is the one that carries the design — but
"no session-reachable surface may write the policy" should be read as "no _tool, command or skill_
offers to", not as a containment claim about a session that already has the owner's filesystem.
Closing the gap properly needs the policy to live somewhere the session cannot reach at all (a
root-owned path, an OS keychain, or a signed artifact verified out-of-band), which is a product
decision and is **owed**.

Two smaller findings from the same review, recorded for the next pass:

- **`crabgic trust approve` mints without a prompt and prints the token** (`packages/detect/src/trust/
trust-approve.ts`), so §3's "the terminal prompt is the only mint path" is false as written for the
  capability-quarantine surface. Not currently exploitable — `capability.approve` verifies through an
  in-memory minter whose pending table is empty across a process boundary — but that is an accident of
  wiring, not a control. Either route it through `runApprovalFlow` or stop rendering `minted`.
- **The spawned daemon's stderr log is an unredacted at-rest channel.** `supervisord.stderr.log` under the
  project state root now goes through `openOwnedFile` (0600, symlink- and FIFO-refusing, truncated only
  after the checks pass) and its tail is stripped of terminal control sequences before it reaches an error
  message, but nothing bounds or redacts what the daemon itself writes there over its lifetime.

## Residual risk — disclosed, non-blocking

Every item below is a known, intentional design limitation already named in the owning
phase's own evidence or the threat model itself — not a newly-discovered live gap, and none
meets the CRITICAL/HIGH bar that would block this release per 14's gate semantics.

- **Same-uid trust flattening (§1, Cross-surface theme 1).** The UDS control plane trusts
  every same-uid process identically; there is no in-protocol distinction between the CLI and
  the gateway's forwarded calls. Stated design choice (`docs/threat-model.md` §1, §Cross-
  surface themes); unchanged by implementation.
- **`canUseTool` is SHADOWED for every production grant — FIXED for the gateway family AND
  the rule-granted built-ins (2026-07-30).** This entry used to record the underlying fact as
  unprobed: "whether the SDK invokes `canUseTool` at all under `permissionMode: 'dontAsk'`
  was never directly probed." A real worker run probed it, and the SDK answered unprompted:

  > `[CLAUDE_SDK_CAN_USE_TOOL_SHADOWED] Warning: canUseTool will not be invoked for:`
  > `mcp__<gateway>__*. Bare allowedTools entries auto-approve the whole tool before the`
  > `callback is consulted. To gate every tool call, use a PreToolUse hook.`

  The mode was never the variable: an allow entry is. And the bare-name form was not the
  whole story either — the follow-up probe
  (`packages/engine-claude/src/live/builtin-allow-rule-shadowing.live.test.ts`, live at
  engine 2.1.218, `docs/engine-baseline.md` §4.7) measured that a matched RULE-SHAPED entry
  (`Bash(git status:*)`, the exact shape `emitPermissionProfile` compiles for
  `Bash`/`Edit`/`Write`) shadows the callback identically. Together with §4.5 that means
  _no_ production tool grant reaches `canUseTool`: `compileEnvelope` grants the gateway
  family by name and the mutation-capable built-ins by rule, so 06's journal-first
  `AdjudicationCallback` never ran for a connector, evidence, review, `Bash`, `Edit` or
  `Write` call.

  **FIXED for both grant shapes** by a second bridge on `PreToolUse`
  (`packages/engine-claude/src/tool-adjudication-hook.ts`), which fires before permission
  evaluation and therefore cannot be shadowed. It covers the gateway wire prefix plus
  exactly `{Bash, Edit, Write}` — the set the profile grants by rule. It NEVER widens: a
  hook returning `permissionDecision: "allow"` bypasses the permission system for that
  call, so an allow from this bridge could have overridden the profile's own deny entries;
  the allow path returns no opinion. Independently verified against the shipped CLI binary:
  a hook `allow` still runs the rule pipeline and a deny rule overrides it, and a throwing
  hook is fail-closed at the engine level. Verified live end-to-end (2026-07-30): a real
  adapter-spawned worker's `Bash(git status)` call produced a journaled allow decision via
  the bridge, put real records in the PostToolUse audit's scope for the first time, and did
  not spuriously abort (`adjudication-bridge.live.test.ts`, which now ASSERTS the record
  exists rather than recording whether it does).

  **What it restores is the RECORD, not a refusal — for built-ins, literally.** For GATEWAY
  tools the policy matches on name — the same axis the engine's own rule grants them on —
  so its deny is enforced (fail-closed on bus failure too). For `Bash`/`Edit`/`Write` the
  policy's verdict is RECORDED (journal + audit, on both verdicts) and deliberately NOT
  acted on, because it is measurably STRICTER than the engine inside a matched rule
  (baseline §4.8: the engine executes `git status 2>&1` and a quoted `"a|b"` argument under
  `Bash(git status:*)`; the policy's unproven-metacharacter fail-closed and quote-unaware
  splitter deny both). Enforcing it would refuse everyday commands the engine grants —
  `npm run test 2>&1` — a worker-reliability regression adversarial review caught before
  merge. Two exceptions are enforced even for built-ins: adjudication UNAVAILABLE denies
  (no unrecorded mutation call may proceed), and an explicit `interrupt` halt from the
  policy is honored. The journaled divergence (a `deny` verdict for a call the engine then
  executed) is the alarm an auditor reads; the enforced boundary remains the engine's own
  rule evaluation plus the OS sandbox.

  **Deliberately NOT extended to `Read`/`Glob`/`Grep`/other tools:** the envelope policy
  default-denies any unlisted tool, while the engine grants read-only tools without any
  rule. Covering them would journal a meaningless deny verdict for every read and
  black-hole them all whenever adjudication is unavailable. `canUseTool` stays installed as
  a backstop for grant shapes not yet measured; no document here claims it adjudicates the
  compiled profile's own grants. Known measured/unmeasured divergences between the policy
  and the engine, kept enumerable: unproven-metacharacter fail-closed (measured stricter,
  §4.8), quote-unaware compound splitting (measured stricter, §4.8), `//`-anchored
  substituted path matching (unprobed live — see the worktree-anchor residual below);
  Pre→Post `tool_input` stability is measured for `Bash` and `Write` by
  `adjudication-bridge.live.test.ts`, not for `Edit`.

- **Worktree-anchor (`//<worktree>/…/**`) matching semantics — MEASURED 2026-08-01, and the
  answer splits by channel (§3).** The differential probe
  (`packages/engine-claude/src/live/path-anchor-differential.live.test.ts`, artifact
  `docs/evidence/phase-06/path-anchor-differential-determination.json`, recorded as
  `docs/engine-baseline.md` §14.4) ruled out path depth, rule count and permission-object
  scaffolding, and localized the earlier disagreement to the channel: **a path-scoped rule is
  honored as an ALLOW rule and is NOT honored as a DENY rule.** Owned-path confinement
  therefore works — allow-scoping plus `dontAsk` auto-deny, both measured — while the
  compiler's sensitive-root DENY triplets (journal/control state, cache, `~/.ssh`, `~/.aws`)
  are inert on the permission layer and must be read as defense-in-depth that does not
  currently fire. They are deliberately NOT removed: an engine version that honors them is
  strictly better, and the sandbox's own `denyRead`/`denyWrite` lists are a separate
  mechanism that does bind for shell-issued writes. Write tool only, one engine version.

  **Version-attribution correction, 2026-08-01.** The recorded determination says the
  measurement was taken at the tested engine version; strictly, that was _asserted rather
  than verified_ at the time. This probe — and the two other load-bearing permission probes,
  `builtin-allow-rule-shadowing.live.test.ts` (§4.7/§4.8) and
  `mcp-adjudication-shadowing.live.test.ts` — called `assertLiveEnabled()` but not
  `ensureCanary()`, while the suite finalizer stamps the run record with
  `engineVersion: TESTED_ENGINE_VERSION` unconditionally. Nothing compared the engine that
  actually answered against that pin. All three now call `ensureCanary()` in `beforeAll`, so
  a future re-run fails closed on drift instead of mislabelling it; the canary is memoized
  per suite run, so this costs no extra engine invocations. The already-recorded verdicts are
  not restated as verified-at-version by this change — re-running them under the canary is
  what would do that, and it has not been done.

- **Bash compound-command splitting is quote-unaware (§2, worker runtime).** An allowed
  command whose quoted argument contains an operator character can be over-split and
  false-denied. Confirmed by trace to fail only in the safe direction (over-denial, never a
  merge that would hide a real separator) — a reliability defect, not a privilege-escalation
  bypass (`docs/evidence/phase-06/wi7-adversarial-validation.md`, carry-forward 1).
- **`FALLBACK_MAX_TURNS = 20` is the one turn number no policy governs (§3, adapter).** A
  cross-process `resume`/`fork` of a session this adapter instance never spawned falls back
  to a minimal read-only profile with a hardcoded 20-turn cap
  (`packages/engine-claude/src/adapter.ts`) — since the turn budget became an authority
  dimension (2026-07-30), this is the sole turn constant outside the containment gate.
  **Corrected 2026-08-01 — the previous wording here ("`resumeAttempt` has no production
  caller") was false.** It has one: `resumeParkedUnit` in
  `packages/cli/src/daemon/run-dispatcher.ts` calls it on every park-resume. Exposure is
  bounded for a different and better reason — a **decline guard at that caller**. The
  fallback context is reached only when the adapter has no retained `SpawnContext` for the
  session id, and `resumeParkedUnit` refuses to call `resumeAttempt` at all in exactly that
  case: it looks the session up in the daemon's per-run retained-adapter map first and
  returns `undefined` when there is no entry ("Decline rather than resume into a read-only
  fallback session"), leaving the unit parked. Every call that does reach `resumeAttempt`
  therefore carries a session this same adapter instance spawned, whose real spawn context
  is still in `spawnContexts` — so `FALLBACK_SPAWN_CONTEXT`, and with it
  `FALLBACK_MAX_TURNS`, is unreachable in production **by guard, not by caller absence**.
  The guard is pinned by `packages/scheduler/src/run-driver.test.ts`, "leaves a parked-ready
  unit parked when the seam declines (undefined) — the daemon-restart case". The residual is
  that the invariant rests on a caller-side check rather than on the containment gate;
  governing the constant today would govern a path nothing can reach, so this stays open for
  the cross-process durable-cache reconciliation (phase 06's carry-forward) to close
  structurally — persisting spawn context makes the fallback unnecessary rather than merely
  unreachable — rather than be rediscovered there.
- **CLOSED 2026-08-01 — capability-quarantine audit verdicts are journaled (§7).** This item
  used to read "no dedicated `JournalEntryType` member ... needs a follow-up decision, not a
  residual-risk acceptance, and it remains open." The decision has now been made, and the
  underlying defect was worse than the item described: because a rejection never mints a
  token, a **rejected audit produced no journal entry at all**, and `updateDecision`'s
  in-place rewrite of `report.json` left the `pending -> approved` flip and `trust revoke`'s
  flip back equally untraceable. Interface-ledger Gap 5's Resolution (2026-08-01) keeps the
  union closed at 13 and journals both the verdict and every decision transition as
  `adjudication_decision` entries under a `capability_audit:` discriminator — phase 14's
  already-blessed reuse shape. Both writes are journal-first (verdict before `store.save`,
  transition before the artifact rewrite) and fail closed: no sink means the operation is
  refused, a failed append aborts it. Not a full closure of the surface: the journal carries
  the verdict, per-stage pass/fail, scan-finding count and severities, digest and re-audit
  reason, while finding _details_ stay in the 0600 store artifact (a scanner detail line can
  quote matched secret text). See `packages/detect/src/capability-store/audit-journal.ts`.
- **Stage-5 sandboxed-test harness invocation API is an unverified build-time spike (§7).**
  12's own risk text names this directly; not yet closed by an `engine-baseline.md`-style
  probe.
- **Optional upstream-MCP-client wrap's quarantine status is unresolved (§5/§6) — but the
  wrap is structurally unenableable, not merely disabled by default (sharpened 2026-08-01).**
  16's own text states the quarantine question is "addressed by neither file" between 16 and 12. The previous wording here said the flag is "disabled by default," which understates the
  containment: a default is one edit away from changing, and this is not what bounds the
  risk. What bounds it is that there is no way to turn the wrap on. The feature is 35 lines
  of policy bookkeeping (`packages/gateway/src/mcp/upstream-mcp-client-policy.ts`) with (1)
  no production caller of `setEnabled` and no production construction of the store, (2) **no
  MCP client anywhere in shipped source** — the gateway imports the SDK's server surface
  only, (3) no field for the flag on `ExternalConnectionSchema`, which is `.strict()`, so a
  config file declaring one is _rejected_ rather than ignored, (4) no environment variable,
  and (5) a `buildSimulatedWorkerMcpServers()` that takes no policy argument, so no second
  server can ever become worker-visible. Enabling it therefore requires new code **plus** a
  coordinated phase-02 schema change. All five facts are pinned by
  `packages/gateway/src/mcp/upstream-mcp-client-unenableable.test.ts`, which fails CI the
  moment any of them stops holding — so enablement cannot land without first settling the
  16/12 quarantine ruling, which `roadmap/16-gateway-core.md` §Risks now records as an
  explicit precondition on that work.
- **Renderer (17) and quality/security gates (14) maintain independent secret-pattern sets**
  with no shared dependency edge — both phases state this as a deliberate scope boundary.
- **Performance-budget tamper-evidence is journal-anchored, not signature-bound (15).** The
  MAJOR finding here (a self-checksum with no external binding, allowing a consistent
  widen-and-recompute attack) was fixed by binding the budget to 04's append-only journal at
  approval time — a real improvement, not cosmetic — but the human approval token itself
  (11's HMAC) is minted over the `AuthorizationEnvelope` hash only, never over the perf
  budget. The journal anchor proves "this is what got committed at intake time," not "this is
  what a human actually approved." Closing this fully requires a coordinated 02/11 schema
  change (folding the budget into the signed envelope content) that must reconcile with
  `docs/interface-ledger.md`; explicitly flagged as a named, high-priority follow-up in
  `docs/evidence/phase-15/README.md`'s own carry-forwards, not silently assumed resolved.
  Not classified CRITICAL/HIGH by any adversarial pass (the MAJOR itself is fixed); recorded
  here as the honest, disclosed limit of the current fix.
- **Inbound content is generally less scrutinized than outbound content (§Cross-surface
  theme 4).** What the renderer emits is heavily hardened (Unicode attacks, secret patterns);
  what a connector reads back from Jira/Grafana is bounded by size budgets and canonical-error
  redaction, not by the same content-level scrutiny. No surface claims otherwise.

## Cross-cutting: connector evidence & drift (phase 21)

Phase 21 wires the `remote_verification` gate (blocks `final_verifying` → `published_local`
on `unsupported`/`ambiguous_write` outcomes or a missing confirmed remote revision — never a
silent pass), a materiality classifier that halts a run on a mid-run tracked-field edit before
`final_verifying` (11's stop-condition/re-approval mechanics), and a
`SECURITY_FIXTURE_MANIFEST` naming 7 blocking security-fixture entries spanning
forged-admin/delete, tenant-boundary, and redaction categories across Jira, Grafana, and the
gateway. An adversarial pass found this phase's units were built but **unwired** (MAJOR-1: zero
non-test callers existed for the gate/pointer/classifier primitives) and that the
done-transition evidence bridge's own evidence doc had **overclaimed** a wiring that didn't
exist (MAJOR-2) — both fixed by adding a real integration suite firing the gate through the
actual registry, and by genuinely wiring the bridge into Jira's `planIssueTransition` as an
additive optional dependency (`docs/evidence/phase-21/README.md`, "Adversarial-validation
repair pass"). The drift-CI job's live sandbox replay remains fixture-modeled, not live — an
honestly disclosed gap identical in kind to 18/19/20's own cassette-modeled precedent, closed
once phase 23's disposable environments are wired into it (see
`docs/compatibility-matrix.md`).

## What this review does not claim

This is a documentation-and-evidence-cross-check review, not a fresh independent penetration
test. Every finding cited above was discovered by an adversarial-validation pass already
recorded in this repository's evidence trail; this review's own contribution is confirming
each cited fix is present in the current source and that no severity was silently downgraded
between the finding and the fix record. No new attack surface was probed by this pass itself.
