# crabgic

## 1.7.0

### Minor Changes

- Answer-first reporting, enforced on both channels.

  - `install` now writes `.claude/output-styles/crabgic.md` and sets `outputStyle`
    in `.claude/settings.json`, **add-only** — a style you already chose is never
    replaced. Probe-verified to reach the model (engine-baseline §23.4).
  - New gateway tool `report.render` renders a policy-conforming markdown report
    from `{role, lead, sections, nextAction}`.
  - A `Stop` hook now watches manager reports for walls of prose. It ships
    **advisory** (records, never blocks) on a budget calibrated against real
    messages, and is configurable — including off — via
    `.crabgic/presentation.json`.
  - Presentation limits are measured in terminal **columns** rather than code
    units. Fixes a heading rule drawn at half width under CJK titles, a
    key/value column that sheared on any wide character, and a single long token
    (a digest, a URL) escaping the bullet budget entirely.
  - `doctor`, `status`, `evidence`, `help`, `install`, `upgrade`, `uninstall`,
    `learn *`, `connection *`, `trust *`, `approve`, `cancel` and `resume` all
    render answer-first: a verdict on the first line, headed sections, capped
    lists that say what they held back. `--json` output is unchanged.

## 1.6.0

### Minor Changes

- 05bda34: **`ExternalConnection.folderAllowlist` was a published schema field that looked like a security
  control and enforced nothing — and enforcing it honestly means an unattributable mutation is
  refused.** It was declared in the contract, emitted into the published JSON Schema, settable by an
  operator, and read by **zero** code anywhere in the repository: the same declared-and-inert shape
  `tenantAllowlist` had before its own enforcement landed. An operator who set it reasonably concluded
  that writes outside those folders were refused, and nothing refused them.

  It is now enforced at the gateway's mutation pipeline — the sole issuer of mutation network I/O —
  **on mutations only**, through a provider folder-attribution hook with three answers: attributed to
  folders, attributed outside all folders, or unknown. The field being absent still means
  folder-unscoped and changes nothing; an empty list refuses every mutation, fail-closed, the same
  reading the tenant check already gives; a non-empty list admits only a mutation the provider places
  inside a listed folder.

  **A ruling fills the spec's silence: a provider that supplies no attribution is refused, not waved
  through.** The alternative — admit it — would have made the field bind only providers that happened
  to opt in, with nothing telling an operator which, which is the trusted-and-inert defect this change
  exists to remove. The refusal has a visible consequence, written into the published schema
  description because there is no config-time signal for it: **setting `folderAllowlist` on a Jira
  connection refuses every Jira mutation on that connection**, because Jira has no folder in its model
  and registers no attribution hook; Grafana's `annotation` kind is `unknown` by construction and is
  refused on a folder-scoped connection for the same reason. Unset the field if you did not mean it. A
  connection-doctor warning is recorded as future work.

  **Scope, because an over-claimed control is the problem this change exists to remove.** It binds the
  folder the provider derives **from the plan**, never where the resource actually lives on the remote —
  a dashboard moved server-side still reports its plan's folder. It is "an operator can bound which
  folder a write may claim to land in", not "writes outside these folders are impossible". Reads are
  not folder-checked.

  **Bulk Jira writes now serialize against their member issues.** A `bulk:<keys>` mutation took its own
  serialization key, so a bulk update of issues A and B could run concurrently with a single-issue write
  to A — the race was observed on the wire as `expected 2 to be 1`. The write serializer gained
  multi-key acquisition, and both Jira apply clients map a bulk plan to its sorted member issue keys, so
  a bulk write now serializes against single-issue writes of its members and against order-permuted bulk
  twins, while writes over disjoint issue sets deliberately stay concurrent. Nothing here evidences
  behaviour against a real Jira; every leg is a fake transport.

- bddac4c: Intake validates its two unvalidated inputs, and the upgrade boundary is documented where operators read.

  `IntakeRequest.ecosystem` arrived straight from `JSON.parse` and was used to index a plain object literal, so `{"ecosystem": "constructor"}` on stdin crashed `runIntake` with a `TypeError` from inside `@crabgic/contracts`. The table now answers only for its own rows, and intake refuses an ecosystem the pinned table has no row for instead of silently falling through to base-revision measurement.

  A performance acceptance criterion whose comparison operator contradicts its metric's canonical direction — `throughput <= 1000 ops/sec`, where a throughput budget is a floor — was silently reinterpreted as its opposite, because a budget entry carries no direction and the gate takes it from the metric. Such a criterion is now refused with a diagnostic naming the operator to use. Direction-consistent criteria parse exactly as before; no derived budget value moves.

  **Before upgrading:** finish or cancel in-flight runs, and expect a replayed `requestKey` across this upgrade to report `conflict` by design — `IntakeRequest`'s field set changed in 1.5.0's successor, so the same document hashes differently on either side. Use a fresh `requestKey` or the amendment flow. Both rulings existed only in design documents until now; see `docs/upgrade-guide.md`, "Before upgrading".

- 05bda34: **A completed run now walks the verification pipeline, and the security gates fire — blocking. A run
  that previously reached the end unexamined, and published, can now fail.**

  Until now no run ever left `running`. The daemon composed no gate registry, nothing in production —
  no command, no daemon path, no test — transitioned a run onto `verifying`, `integrating` or
  `final_verifying`, and the security-fixture gates' only caller anywhere in the repository was their
  own unit test. A control that is registered nowhere is a control that does not exist, and this is the
  change that gives them somewhere to fire.

  The daemon's one production composition root now builds the gate registry, and a run whose DAG
  completes walks `verifying → integrating → final_verifying → published_local`. At `verifying` the
  criteria-seal gate fires; at `final_verifying` every entry in the security-fixture manifest fires
  **blocking** — seven of them, once the Jira tenant-boundary scenario auto-registered through the
  derived id list with no edit to the registration site — and a refusal names the failing fixture id
  rather than reporting a bare failure. The seven cover forged delete/admin operations, tenant-boundary
  breach and error redaction, across Jira, Grafana and the gateway itself.

  **Two consequences worth reading before upgrading.** A run that would previously have finished
  unexamined can now be refused at `final_verifying`. And the criteria-seal gate fires the same way at
  `verifying`: change sets created before this upgrade carry no approval seal and fail closed, so
  finish or cancel in-flight runs first — `crabgic status <run-id>`, `crabgic cancel <run-id>`.

  Deliberately **not** registered, by owner ruling and with its cause measured rather than assumed: 15's
  performance gate and 14's own tdd/coverage/flake/scanner/engine-conformance tranche. Their measurement
  backends do not exist in the daemon, and every registered gate fires on every run — so registering
  them today would either fail every run or fabricate a measurement. Widening that scope starts with
  building the backends, never with a `register` call.

### Patch Changes

- 05bda34: **Refusing a write to an undiscovered Data Center custom field raised the wrong error kind and blamed
  the wrong provider.** The shared field-metadata guard hardcoded `ConnectorError.validation` and the
  Cloud provider name at both of its throws, so a Data Center connection refusing an undiscovered custom
  field — or an unrecognized schema type — returned a `validation` error attributed to `jira-cloud`. A
  consumer branching on the canonical error union was steered wrong, and the phase's own requirement
  that unrecognized fields return a typed `unsupported` was unmet on every Data Center write path.

  The refusal's kind and provider are now a parameter of the guard rather than a constant: Data Center
  write paths produce `kind: "unsupported"`, `provider: "jira-datacenter"`, and Cloud keeps
  `validation` / `jira-cloud` unchanged. Both settings are pinned by assertions on the kind and the
  provider, not on the throw — `toThrow(ConnectorError)` passes for every kind, which is exactly what
  left this path unpinned.

- 9057abe: **Shutting the daemon down no longer risks the journal.** `run.dispatch` deliberately leaves its
  drive running in the background, and the project lease is the journal's only single-writer
  guarantee — but teardown released that lease with the drive still appending. An ordinary SIGTERM
  mid-run therefore freed the lease, the next `crabgic` call spawned a second daemon that acquired it,
  and two writers on one hash chain produce a duplicate `seq` that the journal classifies as tampering
  rather than as a torn tail. Shutdown now closes the control plane, drains the dispatcher, and
  releases the lease last — and not at all if something is still writing, because a lease left held by
  a departing process is reclaimed safely by the next daemon and a lease handed over under a live
  writer is not reclaimed at all. Runs cut off at the drain deadline have their workers terminated and
  their end recorded, so a restart sees a finished run instead of one that can never finish.

  **A restart with a parked run says what it means.** `crabgic resume` used to report success and do
  nothing: the parked unit's engine session is same-daemon state, a restart loses it, and the run
  re-parked forever while its change set stayed un-dispatchable. It now refuses with the reason and
  the one command that works. Startup recovery no longer mistakes a rate-limit park for a crash — the
  park record is the truth about a session that is waiting on purpose — and when it does reap a
  genuine crash it attributes the record to the run, so run-scoped and unscoped readers of the journal
  can no longer disagree about whether a work unit failed.

- 8a7dc7a: **A failed run no longer wedges its change set forever.** An ordinary single-unit failure — or any
  DAG that ended all-terminal without succeeding — was reported by the scheduler as a _completion_,
  because the stop reason only asked whether anything was still pending or parked, never whether the
  terminals were successes. A completion has no run transition to write (its successor is the
  verification stage, which is not wired yet), so the run stayed in `running` with every unit
  finished: `crabgic status --watch` never terminated, `crabgic run` refused the change set with
  "already has run … in flight", and `crabgic cancel` was the only way out. A run's drive now records
  how it actually ended — `failed` when a unit failed, `cancelled` when units were cancelled and none
  failed — so retrying is just `crabgic run` again, as a fresh run with its own repair budget. This is
  the same defect as the 1.5.0 correction's restart-with-a-parked-run case, in its failure-shaped
  half, and it reached more than the obvious trigger: mixed success-and-failure DAGs, leaf failures,
  runs re-driven after a daemon crash, units stopped by `worker.terminate`, and exhausted repairs all
  wedged the same way. An all-succeeded run still waits in `running` for the verification stage;
  that deferral is unchanged.

  **And `crabgic resume` will not claim to have resumed one.** Resuming a run whose every unit is
  already terminal cannot dispatch anything, so it is refused rather than accepted — naming how many
  units failed or were cancelled, why waiting cannot help, and the `crabgic cancel` that does work.
  This covers runs already wedged by the old behaviour, which the journal replays as `running` after
  every restart. Resume still accepts a run with real work left, including one holding a parked unit
  whose session this daemon can still reach.

- 70d7da7: **Two daemons could hold the same project lease at once.** Claiming a lease created the lease file
  and wrote the holder's record into it as two separate steps, so for a sub-millisecond window the
  file existed and was empty — and an empty lease file reads as "no holder at all", which grants a
  takeover without ever checking whether the recorded process is still running. A second `crabgic`
  invocation landing in that window took the lease from a live daemon and both believed they held it.
  Two concurrent invocations racing to start the daemon is an ordinary, expected event (two terminals,
  a hook alongside a CLI call, a retry overlapping a slow boot), the project lease is the journal's
  only single-writer guarantee, and two writers on one hash chain produce a chain the journal
  classifies as tampering. Measured at 9 double acquires in 11,000 races on an idle machine.

  A lease is now published by writing the complete, fsynced record under a private name and linking
  it into place, so the lease path is never visible without its full contents. Two related holes
  closed with it: a lease that disappears mid-check now sends the contender back to a claim it can
  lose cleanly, instead of a replace that cannot lose and would overwrite whichever process claimed
  the lease in between; and a lease file that cannot be read (permissions, an unexpected directory, a
  failing disk) is no longer treated as an absent one, which used to hand out the lease on an I/O
  error. A genuinely corrupt lease still self-heals, and a live holder is still never displaced.

- 05bda34: **The bundled `eo-explore` subagent had no turn bound, and a malformed one would have been silently
  dropped.** A subagent's turns never reach the parent session's turn counter, so nothing downstream
  bounded them: one "count the files in this directory" request served roughly fifty nested round trips
  before returning. The installed subagent's frontmatter now declares `maxTurns: 30`, below the engine's
  built-in 200-turn default, and that file is the one `crabgic install` writes into a project.

  The manifest validator now also requires any declared `maxTurns` to be a **bare positive integer
  literal**, instead of letting a value the loader cannot read be dropped back to the built-in
  default. That matters more than the bound itself: an unreadable value fails open, so a subagent that
  looks bounded on disk would have run unbounded. The engine does warn — its loader's message is
  recorded verbatim from the pinned binary — but that warning could not be surfaced through any free
  local command, so nothing a maintainer runs would have shown it. Quoted forms (`maxTurns: "30"`) are
  refused for a narrower reason, stated exactly: whether the engine coerces or drops them is
  **undetermined** at the pinned version, and the bare literal is the one form whose installation is
  settled.

  Scope, because it is easy to read more coverage into this than exists: **only `eo-explore` is
  bounded.** The other four bundled subagents declare no `maxTurns` and still run at the engine's
  200-turn default — deliberately, since the overspend was measured for `eo-explore` alone and a bound
  that bites mid-review silently truncates a reviewer's findings. That residual is pinned by its own
  assertion, so it announces itself if anyone changes it.

- a5f51d6: **`ExternalConnection.tenantAllowlist` was a published schema field that looked like a security
  control and enforced nothing.** It was declared in the contract, emitted into the published JSON
  Schema, and read by no code anywhere in the repository — a repo-wide search found no tenant equality
  or inclusion comparison in production source at all. The value that _was_ used, `plan.tenant`,
  derived from a different field (`projectAllowlist`) and was consumed only as a concurrency key for
  the per-tenant+resource write mutex. An operator who set `tenantAllowlist`, reasonably believing
  cross-tenant writes were refused, got no refusal of any kind, and the published schema invited that
  belief.

  The field is now enforced rather than removed. Removing it would have bricked stored configurations:
  the connection schema is strict and the file-backed connection store re-parses every record on every
  read, so a connection carrying the field would throw on the next read — measured, not assumed. It
  would also have been a breaking change on two published surfaces.

  The gateway's mutation pipeline — the sole issuer of mutation network I/O — now compares the plan's
  declared tenant against the connection's `tenantAllowlist` and refuses a non-member with the
  canonical `policy_blocked` error kind, ahead of the idempotency lock, the journal and any network
  call. An empty allowlist refuses every mutation (fail-closed, the same reading the Grafana connection
  doctor already gives an empty org allowlist); the field being absent still means the connection is
  tenant-unscoped. The refusal is deliberately not journalled, so fixing a misconfigured allowlist and
  retrying the same idempotency key still works. Both Jira resource clients (Cloud and Data Center)
  now derive a plan's tenant from `tenantAllowlist` first, so a tenant-scoped connection produces
  in-allowlist plans by default.

  **Scope, because an over-claimed control is the problem this change exists to remove.** This binds
  the tenant a mutation plan _declares_, on the mutation path only. It is not "cross-tenant access is
  refused": reads are not tenant-checked (read requests carry pseudo-tenants used purely as concurrency
  keys), and the remote's actual tenant identity is never verified against the list. Both are stated in
  the published schema description and pinned by tests. What the change adds beyond making the contract
  honest is real but narrow — a plan's tenant arrives from the semi-trusted worker side and previously
  passed entirely unexamined.

  `MutationPipelineDeps` gains a required `tenantAllowlist` member typed to include `undefined`. This is
  a types-only break for direct `@crabgic/gateway` consumers, deliberately not optional so that every
  construction site has to state its answer; JavaScript callers are runtime-compatible, since an omitted
  key reads as tenant-unscoped, the previous behaviour.

## 1.5.0

### Minor Changes

- bfba6b8: Actively resume a rate-limit-parked unit once its reset window passes (same-daemon).

  When a worker hit an account/rate limit it was parked with its session
  retained, but nothing ever continued it: `driveRun` seeded the unit
  `parked:rate_limit`, `computeReadyUnits` (which only advances `pending`
  units) skipped it, and the run sat `parked` forever. The unit could not even
  be re-dispatched fresh — its original dispatch counts toward the repair
  budget, so the gate would refuse it.

  `driveRun` now, when no fresh unit is ready, resumes every parked unit whose
  reset window has passed (`getParkStatus.readyToResume`) via a new
  `resumeParkedUnit` seam — 13's `resumeAttempt({kind:"parkResume"})` path,
  which skips the repair gate (a rate-limit park is an external throttle, not a
  failed action) and folds the outcome back like a fresh dispatch. The daemon
  dispatcher implements the seam by RETAINING each unit's adapter and
  reconstructing the session's `SessionRef` from it, so the resume runs on the
  same adapter instance that spawned the session — continuing with full
  authority rather than the read-only fallback a stranger adapter would get.

  The retained adapters are keyed per-RUN at the dispatcher level
  (`retainedByRun`), so they survive ACROSS this daemon's re-drives of the run.
  A unit parked while its reset window is still in the future ends its drive
  `parked`; the `crabgic resume <runId>` path re-drives once the window passes
  and finds the same adapter waiting. (A per-`drive()` map would be empty on
  that later drive — the feature's whole point is that it is not.) `getParkStatus`
  is run-scoped when a `runId` is in hand: work-unit ids are stable across runs
  of the same change set, so an unscoped read could report another run's park
  (and session id — which the retaining adapter would miss, silently
  downgrading the resume to read-only).

  Honestly scoped: **same-daemon only.** `retainedByRun` lives in the daemon
  process's memory, so a daemon restart loses it; a re-drive after restart finds
  no adapter and the seam declines (returns `undefined`, leaving the unit
  parked) rather than resume into a read-only session that could not complete
  the work. Restart-safe session resume remains the ledger's separate
  carry-forward. Live end-to-end verification that a real engine session
  continues with write authority after a `parkResume` is owed as a live probe,
  following this repo's wiring-plus-owed-probe pattern; the wiring, the
  across-drive retained-adapter reuse, and the read-only-fallback avoidance are
  unit-proven (a fresh adapter's `resume` throws for an unknown session, so the
  passing test could only have used the retained one).

- ea74ee7: Make approval completable — and stop couriering the token.

  **`crabgic approve <envelope-digest>` exists now.** The `/eo:approve` skill has
  delegated to "the orchestrator CLI's own terminal-prompt approval flow" since
  1.0.0, and no such command was in the argv surface — the skill pointed at a
  door with no building behind it. The new command resolves the digest to the one
  ChangeSet awaiting approval whose OWN stored envelope carries it (never the
  caller's pairing), renders the same prompt `run` uses, and completes
  verification in the same process. It refuses a piped or scripted stdin
  outright: the prompt is the human-only gate, and a shell without an interactive
  terminal — a model-driven one, say — cannot satisfy it.

  **Approval now completes in-process, in both commands.** `run --json` used to
  print the minted token to stdout for `contract.approve` to consume in another
  process — in a manager session that makes the model the courier for a
  human-approval token, the exact exposure ledger Gap 18's audit recorded. And in
  human mode the token went nowhere at all, so a confirmed prompt still left the
  ChangeSet un-approvable. Confirmation now mints, verifies against the
  ChangeSet's own stored digest, and advances `awaiting_approval → ready` before
  the command returns; the spent token is never rendered anywhere, and requirement
  coverage is resolved server-side from the ChangeSet's own IntentContract. The
  MCP `contract.approve` tool is unchanged.

  **The approval prompt settles on EOF instead of hanging forever.**
  `crabgic run < intake.json` drains stdin to parse the request, so the prompt
  was listening on a stream that had already said everything it ever would — the
  process hung with the prompt on screen. End-of-input now terminates the final
  line: bare EOF declines (exactly what the function's own contract always
  claimed), and the decline message names the `crabgic approve` command that can
  finish the job later. A stream error declines too, and never crashes.

  **A daemon that dies during startup now tells you why.** The spawned
  supervisor's stderr went to `stdio: "ignore"`, so a fatal at boot surfaced as a
  generic "could not reach the supervisor control socket" after the whole retry
  budget. The spawner now points stderr at `supervisord.stderr.log` under the
  project's state root (truncated per spawn), and the exhaustion error carries
  its tail.

- 9ee3230: Make the calibration gate reachable, and certify on a number that transfers.

  Two findings forced this, both arithmetic rather than opinion.

  **The old gate was a lottery.** An exhaustive enumeration of it — twenty samples,
  Cohen's kappa lower bound at 0.6 — found that exactly **three of 117 reachable
  tables pass**, all at 19/20 agreement or better. It was "at least 95% raw
  agreement" wearing a confidence interval's clothes: a genuinely good classifier
  (true kappa ≈ 0.79) passed 39% of the time and a mediocre one 7%, so the verdict
  mostly measured sampling luck. Published sample-size tables want n ≈ 93–119 to
  separate kappa 0.4 from 0.6 at 80% power — an order of magnitude more than the
  gate asked for. One threshold was being asked to both screen out a decorative
  judge and certify one fit to close a stage, and the threshold that does the second
  makes the first unreachable.

  **And kappa does not transfer across prevalence.** The same classifier scores
  kappa 0.79 on a 40%-blocking corpus and 0.59 at a 10% production blocking rate,
  with nothing about the classifier changed, because the corpus is deliberately
  stratified and kappa is prevalence-dependent. Certifying on it means certifying a
  number that stops holding the moment it is used.

  So the verdict is four tiers instead of a boolean, and certification rests on
  **per-class recall** — sensitivity and specificity are prevalence-invariant, so a
  bound measured on the corpus still means something in production:

  | tier                  | needs                                                                         |
  | --------------------- | ----------------------------------------------------------------------------- |
  | `provisional`         | 20 random samples, ≥8 per class, kappa ≥ 0.6 with a lower bound ≥ 0.4         |
  | `calibrated`          | 50 samples, ≥20 blocking labels, per-class recall lower bound ≥ 0.7 both ways |
  | `strongly-calibrated` | 100 samples, recall bounds ≥ 0.75, kappa lower bound ≥ 0.6                    |

  `provisional` closes no stage — it says "not a decorative judge", which is the job
  the original threshold could not do while also certifying. The recall bounds are
  **exact** (Clopper–Pearson), not normal-approximation: the approximation the kappa
  interval uses understates variance at small n, which is optimistic exactly where
  optimism is least warranted, and the routine is validated against six published
  reference values rather than against itself. Kappa is kept as the secondary drift
  diagnostic it is genuinely good at — detecting the classifier's positive rate
  drifting away from the owner's. The report also projects production precision at a
  supplied blocking rate, because that is the number an owner feels: a classifier at
  0.9 sensitivity and 0.9 specificity looks strong on a balanced corpus and produces
  one false alarm per real blocker at a 10% production rate.

  **Only uniformly-drawn samples score.** `review.calibrate` asks first about the
  findings a misclassification already marked — an advisory fixed anyway, a blocking
  refuted — which is excellent triage and a biased sample: kappa over an
  error-enriched pool is biased _down_, so a diligent owner was making an already
  unpassable gate harder. Samples now carry their provenance, absent reads as
  targeted rather than random (the fail-closed direction), and the report says how
  many it held out so "twenty labels and still uncalibrated" reads as an explanation
  rather than a puzzle.

  One deliberate non-change: the minority-class floor stays at 8 rather than rising
  to 15. Fifteen is what a recall claim needs, and that requirement lives in the
  `calibrated` tier's twenty blocking labels; raising this floor too would have made
  `provisional` cost thirty samples instead of the twenty it advertises, moving a
  certification's price onto a screen.

  `sampleSize` keeps its original meaning — how many labels exist — with the scored
  slice reported separately as `randomSampleSize`, so no existing reader silently
  starts reading a different number.

- 1f7a933: Decide exit criteria from evidence and from the artifact, and make the classifier's corpus fillable.

  **A gate's exit status was never its verdict, and its history was never its result.** `implement-gates-pass` was derived by requiring every gate-tagged `EvidenceRecord` on a ChangeSet to report a zero exit. That was wrong twice. The TDD gate returns `passed: false` while reporting the candidate's own `exitStatus: 0` when no red baseline exists, so scoring the exit status read a failed gate as passing. And `captureRedBaseline` journals a `tdd`-tagged record with a deliberately NONZERO exit — that is what a red baseline is — so doing TDD correctly made the criterion permanently underivable and left the implement stage closable only on the caller's word, which is the exact thing the derivation exists to stop. `EvidenceRecord` now carries the handler's own `gateVerdict`, absent on a pre-dispatch capture because that is not a firing, and the latest firing per tag is that tag's result. `isNegativeEvidence` gives the release-gate report and the learning eval runner one implementation of "was this a genuine negative run", replacing three inline exit-status reads.

  **Nine criteria are now decided rather than claimed.** Four come from evidence — the gate set, tests-first, the final-candidate gate at a named object id, and debt reopened by this change set's planned writes. Five come from the artifact: `DesignRecord` and `PlanRecord` give the design and plan stages a shape, so risks each carrying a mitigation or a stated acceptance, interfaces naming their owning package, tasks stating done-criteria, an acyclic and fully-resolving dependency graph, and the plan covering every element of the stored design all stop being judgements. `plan-dependencies-acyclic` is a graph algorithm, and only ever looked subjective because the plan was prose. An empty artifact decides nothing in either direction — `[].every(...)` is true, and letting silence read as proof is how a stage closes on an artifact nobody wrote.

  **What is still judged now closes a stage only on a claim somebody signed.** Those criteria arrived as bare strings in a `metCriteria` array: nobody said it, nothing pointed at what it described, and a misreport left no trace. A `CriterionAttestation` requires the criterion, who asserts it, why, and where in the artifact to look. This does not turn a judgement into a measurement and is not presented as one — a rationale can be plausible and wrong. It makes the claim falsifiable, which an anonymous boolean cannot be. A claim is void while an unresolved blocking finding, or the artifact itself, contradicts its criterion.

  **The calibration corpus was unfillable, which is not the same as empty.** The scorer and the store both shipped, and the store was called from nothing but its own test, so `sampleSize: 0` was a property of the product rather than a project's starting state. `review.calibrate` records the owner's own call on how a finding should have been classified; the classifier's half is read from the finding store and is not an argument, so manufactured agreement cannot be recorded. Called bare it reports where the corpus stands and which findings to put to the owner, preferring the two shapes a misclassification leaves behind. `calibrated` is now decided on Cohen's kappa's 95% lower bound rather than the point estimate, with a floor on the scarcer class the owner labelled: a kappa of 0.8 on twenty samples has an interval reaching into "unusable", and deciding on the estimate would have moved the decorative judge rather than removed it. Samples carry the rubric they were judged under, because kappa pooled across a rubric rewrite measures two different classifiers.

  **Behaviour change for callers of `review.submit`.** A judged criterion supplied as a bare `metCriteria` string no longer counts; it is reported back in `unattestedCriteria` with the criteria that need an attestation. Claims to any of the nine derived criteria are discarded and recomputed. The integrate stage needs `candidateObjectId` to close, because a final-candidate gate that cannot be tied to the exact merge candidate is not evidence about it.

- 560994a: Make the worker turn budget an authority dimension, because it wasn't one.

  Spend was journaled (v1.4.x) but the cap was nobody's: the dispatcher
  hardcoded 40 turns per attempt and no policy governed it — an authority the
  containment gate never saw, the exact class of unchecked dimension a recent
  review found in `remoteResourceAuthorizations`.

  Now the chain is closed end to end:

  - `AuthorizationEnvelope.maxTurnsPerAttempt` — what a run REQUESTS (turns are
    the authoritative unit, USD informational, per §5.7). Absent defaults to
    the bounded `DEFAULT_MAX_TURNS_PER_ATTEMPT` (40) and hashes identically to
    an explicit 40, so pre-existing intake requests neither break nor
    spuriously invalidate approval tokens; a DIFFERENT budget is a material
    change and a new canonical hash.
  - `EnvelopePolicy.maxWorkerTurnsPerAttempt` — what the owner GRANTS.
    Defaults to **0: grants nothing**, so a policy on disk from before this
    axis existed denies it and every dispatch escalates, naming the field to
    set — the ledger's F10 fail-closed shape for a new authority axis, applied
    as designed. `crabgic install` authors 40 on fresh derivations. A flat
    field, because `digestPolicy` hashes plain JSON and the first nested field
    would silently change the journaled authorization identity.
  - `isContained` gates request ≤ ceiling like every other dimension —
    all-or-nothing, every escaping dimension named, malformed numbers on
    either side fail closed.
  - The dispatcher compiles the ENVELOPE's value into every
    `TaskPacket.resourceLimits.maxTurns`, where the engine enforces it. The
    hardcoded constant is gone.
  - `crabgic approve`'s consent render and the doctor's grant line show the
    budget — and the consent render now also shows remote resources,
    dependencies and temporary services, which its own doc comment claimed it
    did and did not.

  Also fixed en route: `npm run build:schemas` had been silently broken since
  the zod-4 upgrade — `zod-to-json-schema` emits an empty `{}` for every zod-4
  schema and nothing in CI runs the script. It now uses zod's native
  `z.toJSONSchema` (draft-7, fully inlined) and the 21 committed schema files
  are regenerated current.

  Owners upgrading: the first dispatch after this release escalates with
  `worker turn budget: the envelope requests 40 turns per attempt but the
policy grants up to 0 (set "maxWorkerTurnsPerAttempt" in the standing
policy to grant more)` — add the field to the standing policy file (40
  restores the previous behavior). Adversarial review hardened this path
  before merge: `crabgic doctor` now FAILS a zero-turn policy instead of
  rendering a green check on an installation that refuses every dispatch;
  the daemon's containment refusal names the policy file (editing it is the
  only remedy that works — `crabgic approve` mints a token the dispatch gate
  never reads, a pre-existing dead-end now tracked separately); and the
  `install` confirmation renders the turn grant, which is the standing
  policy's actual authoring moment and must never show less than it grants.

  Known divergence, stated: the published `authorization-envelope.json` JSON
  schema describes the PARSED (output) shape, so `maxTurnsPerAttempt` appears
  in `required` — a raw pre-upgrade envelope file validates under zod (the
  default applies at parse) but not against the published schema.

- 432d6ee: Adjudicate gateway tool calls, which nothing was doing.

  `canUseTool` is the per-call adjudication gate for every tool — except the ones
  it never sees. A tool named outright in `allowedTools` is auto-approved _before_
  the callback is consulted, and the compiled profile grants the entire gateway MCP
  family by name. So the journal-first fail-closed bridge never fired for a single
  connector, evidence or review call, while `docs/security-posture.md` presented it
  as though it did. The SDK had been saying so unprompted, in a warning nobody was
  reading, until a real worker run surfaced it.

  There is now a second bridge on `PreToolUse`, which runs _before_ permission
  evaluation and therefore cannot be shadowed by an allow entry. It calls the same
  adjudication callback, records the same audit entries — bringing gateway calls
  into the executed-vs-adjudicated audit's scope for the first time — and fails
  closed on every path a decision could go missing: a callback that throws, one
  that rejects, one that is absent, a malformed hook input.

  **It can only ever deny.** A `PreToolUse` hook returning `permissionDecision:
"allow"` bypasses the permission system for that call, so an "allow" here could
  have overridden the compiled profile's own deny entries — a control added to
  close a hole opening a wider one. The allow path returns no opinion and lets the
  engine evaluate exactly as before; only the deny path speaks. The trade-off is
  recorded rather than hidden: a policy's canonicalized input is not applied to a
  gateway call, so the audit records what will actually execute. Recording the
  canonicalized form instead would make every gateway call look like a mismatch to
  the `PostToolUse` audit and could abort workers over a difference this bridge
  introduced itself.

  Both engine facts underneath were measured before any of it was written, and a
  third one decided the implementation: **the engine normalizes a dot in an MCP
  tool name to an underscore**, so the matcher keys on `..._contract_approve` and
  never the advertised `contract.approve`. A matcher on the advertised name matches
  nothing — a control that looks installed and is not, which is the same shape of
  defect as the shadowing it fixes.

  Adversarial review of this change then found something larger, which is filed
  rather than fixed here: **`Bash`, `Edit` and `Write` are shadowed the same way.**
  The compiled profile puts rule-shaped entries for them into `allowedTools` too,
  and a matched allow rule short-circuits before the path `canUseTool` lives on —
  so the mutation-capable tools are very likely executing with no adjudication
  record either. The SDK's warning says its own enumeration is incomplete, and the
  existing live probe for `Bash` only records whether the callback fired without
  ever asserting it. Nothing here claims otherwise any more: the code comment, the
  tests and `docs/security-posture.md` all now say the premise is unverified, and a
  probe is owed before anyone asserts it again.

  Separately, the last known-flaky test is fixed at its cause. Two child processes
  contending for one lease each held for a fixed 300ms, so on a loaded machine the
  second one's cold start could land entirely after the first had released: both
  legitimately acquired, and the test went red reporting `["ACQUIRED",
"ACQUIRED"]` — which means _no contention happened_, not _mutual exclusion
  failed_. They now hold their decision until the test releases them, so the race
  the exit criterion measures is a fact rather than a hope.

- e87d1b6: Record what a run costs, because nothing was.

  The engine reports usage on every result — `WorkerResult.usage` carries
  `turnsUsed` and `totalCostUsd`, normalized from the SDK's own `total_cost_usd` —
  and **nothing wrote it down**. The system knew what each attempt cost for exactly
  as long as that attempt was in memory, and a finished run could never answer
  "what did that cost me". For a product that spends the owner's own subscription,
  that is the number they actually feel.

  Usage now rides the terminal `work_unit_transition` entry, and `crabgic status
<run-id>` renders it under the progress line:

  ```
  run d1b0858c-…: running (changeSet 1111…, updated 2026-07-30T00:44:34Z)
    work units seen: 3 succeeded · 1 running · 1 failed
    spent so far:    47 turns · $2.18
  ```

  Carried on the existing entry rather than a new journal type, because
  `JournalEntryType` is a closed union and ledger Gap 5's ruling is to reuse it.
  Optional at every level, so every entry written before the field existed stays
  valid — an attempt the engine reported no usage for is not an error, it is an
  attempt nobody measured.

  Two distinctions the implementation refuses to blur:

  - **Spend sums every attempt, not the latest status per unit.** A work unit that
    failed twice before succeeding cost all three attempts, and a figure that
    forgot the failures would understate the one thing being watched.
  - **No reported cost renders as nothing, never `$0.00`.** `undefined` and zero
    mean different things: one is "nobody measured it", the other claims the run
    was free.

  This is the groundwork a spend _budget_ needs. The ceiling itself is not here:
  that belongs on the `AuthorizationEnvelope`, which is the security keystone, so a
  new field has to be accounted for by the compiler and the containment check or it
  becomes an unchecked dimension — the exact class of hole a recent review found
  elsewhere.

- c529f17: Decide routine approval by the standing policy, not by asking.

  Ledger Gap 18 ruled in July that routine approval moves from _per-envelope, at
  dispatch time_ to _per-envelope-class, ahead of time_: `crabgic install` writes
  an `EnvelopePolicy`, and work contained in it runs with no prompt and no token.
  The dispatcher has enforced that check since PR #1 — but nothing reached the
  dispatcher, because `crabgic run` still stopped at a prompt for every change
  set. The ruling was implemented at the end of the pipeline and missing at the
  front, so the promised experience ("the user types no Crabgic command") was
  unreachable in the shipped binary.

  `run` now tests the freshly-built envelope for containment before it considers
  prompting, and reports one of three outcomes rather than collapsing them:

  - **ready, covered by the standing policy** — nobody is asked, no token exists,
    and the authorizing policy digest is journaled so "what was the human standing
    behind when this ran" stays answerable after the fact.
  - **escalation** — the envelope reaches outside the policy, or there is no
    readable policy at all. Every escaping dimension is named at once, because the
    owner has to edit a file this process cannot reach, and one refusal should not
    send them into an iterative guessing game. `crabgic approve <digest>` answers
    this at their terminal.
  - **not ready** — a requirement no work unit owns. That is a planning gap, not an
    authority question, and prompting for it would ask a human to authorize
    something that would refuse anyway.

  Absent and unreadable policies both deny, and are reported differently on
  purpose: one means `install` never ran, the other means a file was edited into a
  state the schema rejects, and those send an owner to different places.

  The `/eo:run` skill drops its "once 11/13 land the drafting flow" placeholder and
  describes what actually happens: the manager session drafts the intake request
  from the conversation it already had, hands it to the CLI, and reads the verdict.

  **And an approved change set now actually starts.** `run.dispatch` — the
  operation that creates a run, mints its id and drives the DAG — had exactly one
  caller in the repository, and it was a test. Every shipped path stopped at
  `ready`, so the entire worker/gate/publication half was real, tested,
  unreachable code. `run` and `approve` both dispatch once the change set is
  approved, and report the run id. A refused or unreachable dispatch is reported
  as what it is — the approval already happened and is durable, so the remedy is
  retrying the start, never re-authoring the request.

  **The published binary could never spawn its own daemon.** Found by running the
  built artifact in a real scratch project — which the diagnostics added a day
  earlier are what made visible, instead of the generic "unreachable socket" this
  had been reporting since bundling was introduced. `spawnSupervisorDaemon`
  resolved one candidate path, correct for the `tsc` layout and wrong for the
  published one: esbuild splitting puts that code at the dist root, so it looked
  for `packages/cli/bin/supervisord.js`, a path that has never existed. Every
  daemon spawn in the published package died with `MODULE_NOT_FOUND` behind
  `stdio: "ignore"`, which took `run`'s dispatch, `status`, `resume` and `cancel`
  with it. Both layouts are now checked, an absent daemon names every candidate it
  looked in, and `check:install-smoke` asserts the CLI's own resolver finds the
  daemon inside a real installed tarball — the only place that claim can be
  tested, and the same lesson the plugin-asset defect taught in 1.0.0.

  **Re-running intake no longer throws.** Intake is idempotent by design, so a
  second `crabgic run` on the same request replays a ChangeSet the standing
  approval already advanced — and the transition then threw `ready -> ready` out
  of the command, after journaling a second authorization for work that was
  already authorized. A replay now re-checks containment (so a policy narrowed
  since is still caught) and reports the existing approval without recording a
  duplicate.

  **`crabgic install` will not author a standing policy from an agent's shell.** The
  one place the policy is created was a bare `process.stdin` read, so
  `echo yes | crabgic install` authored the grant that decides what runs without
  review — the exact property Gap 18 part 3 exists to guarantee, demonstrated
  false against the built binary. The confirm now uses the same gate as the
  approval prompt: a non-human context skips authoring and says so, while
  everything else `install` does still installs, because plugin and settings work
  is legitimately automatable and a standing authorization is not.

  The docs stop overclaiming it, too. The policy is a boundary against **workers**
  — sandboxed, with the state root outside their writable set — and not against a
  session already running as the owner, which can edit the file directly. That
  distinction is now written down in `docs/security-posture.md` instead of implied
  away, and the install prompt no longer promises "nothing Crabgic runs can change
  it".

  **`run` no longer prompts, and no longer mints.** Its inline prompt was broken
  three ways at once: in the primary form, `crabgic run < intake.json`, the request
  read has already drained stdin, so the prompt hit an ended stream and
  auto-declined — unanswerable; it rendered a bare digest with no authority, the
  very thing the standing design exists to end; and a human who did answer got a
  spent token, a `ready` change set, and no dispatch, reported at exit 0.
  `crabgic approve <digest>` is that path done properly, so escalation now says so
  and stops. One welcome consequence: `approve` is the CLI's only remaining
  envelope-token mint, which is what the operator guide always claimed.

  **A refusal now exits non-zero, and says what escaped.** The refusal naming every
  out-of-policy dimension was computed and then dropped: the human path printed a
  digest prompt instead, and `--json` returned exit 0 for escaping envelopes,
  unowned requirements and requestKey conflicts alike. The outcome is decided once
  and then rendered, so status and exit code cannot disagree, and the escalation
  message names the reason, the `crabgic approve` command, and the policy file's
  own path.

- 54a1629: `crabgic status <run-id>` answers "how far has it got?", not just "is it going?".

  The run record carries a lifecycle state, so `status` printed one line saying
  `running`. For a run spanning several work units across several minutes, that is
  the less useful of the two questions an operator has, and the other one — how much
  is done, how much is stuck — was already in the journal with nothing reading it.

  There is now a progress line under the run line: how many work units have
  succeeded, are running, are parked on a rate limit, or have failed.

  `--json` is deliberately left alone. That output is literally 05's published
  `RunStatusResultSchema` — the raw UDS result, never re-shaped — and the schema is
  strict, so the first attempt at this broke a real conformance test. Widening it is
  a cross-phase interface decision the ledger governs, and a rendering improvement
  does not get to smuggle a key in; the restraint is now pinned by its own test.

  It is **derived, never stored**. The journal is the record and this is a fold over
  it, so the progress view cannot drift from what actually happened — there is no
  second copy to disagree. Later entries win per work unit, which is what makes it
  current status rather than a history.

  And it reports what the journal has SEEN, which is deliberately not the same as
  what the plan contains: a work unit never dispatched has no entry and cannot be
  counted. So the line says "work units seen", and when none have been seen it says
  nothing at all rather than "0 of 0" — a denominator this cannot know would look
  authoritative and be wrong. An unrecognised status is printed rather than dropped,
  because a status the renderer has never heard of is exactly the thing worth
  seeing.

- bbf95cc: Say when a run has more authority than its plan needs.

  The standing approval's explicit trade is that in-policy work is approved with
  nobody reading it. That is a good trade, and ledger Gap 18 records what it gives
  up: per-change-set human review. So the thing a reviewer used to catch for free
  now goes uncaught — a change set that asks for `src` when it only ever touches
  `src/login` is approved, dispatched, and runs wider than its plan.

  `run` now says so, after dispatching:

  ```
  ChangeSet 1111… approved (covered by the standing approval policy sha256:…) and dispatched as run d1b0…
    note: the envelope grants 1 path(s) no work unit uses (infra/terraform) — inside
    your standing policy, so nothing is blocked, but the run has more authority than
    its plan needs
  ```

  **It reports and refuses nothing**, deliberately. The policy said that path was
  fine and it is; this is a wider grant than necessary, which is worth mentioning
  and never worth halting a run over. The wording says "nothing is blocked" out
  loud, because the reader's first question is whether something went wrong.

  **And it is deterministic.** The obvious version of a critic on auto-approved
  plans is another model pass; this is a set difference over paths the plan already
  declares, so it costs nothing, cannot hallucinate, and gives the same answer every
  time. Containment is segment-aware and matches the policy check's own shape — a
  grant of `src` counts as _used_ by a work unit claiming `src/login`, because it
  genuinely is, and flagging that would train the reader to ignore the note
  entirely. A model-based critic can come later for judgements this cannot make; it
  did not need to come first.

### Patch Changes

- faedcda: Stop offering `crabgic approve` as the remedy for an authority escalation, because it cannot be one.

  Adversarial review traced the full ceremony: the escalation message led with
  `crabgic approve <digest>`, approval verified the token and flipped the
  ChangeSet `ready` — and the daemon's dispatch gate then re-ran the identical
  containment check, with no token input, and refused the same envelope again.
  That is not a bug in the gate: the ledger's Gap 18 ruling makes dispatch
  containment-only ("no prompt and no token … there is no third outcome"), and
  the token machinery it kept gates exactly one thing — the
  `awaiting_approval → ready` transition, i.e. owner consent to the PLAN (a
  material amendment, an intake whose prompt declined at EOF). The command's
  own header claimed otherwise ("its envelope outside the standing policy"),
  which made a ceremony that can never succeed the advertised first remedy of
  every escalation.

  Now the words match the mechanism:

  - The escalation message leads with the edit that works — the standing
    policy file, named by path — and states that an in-policy envelope
    proceeds with no further ceremony on the next `crabgic run`. `approve` is
    mentioned only to say what it actually does.
  - `approve`'s post-dispatch refusal explains itself: consent to the plan,
    never a grant of authority; if the refusal names an escaping dimension,
    only a policy edit changes the outcome.
  - The `/eo:approve` skill and the command header state the same scope.

  No behavior changed at any gate — this is the honest-words half. Making the
  dispatch gate read tokens was considered and rejected: it would contradict
  the ledger's ruling, and the token is already consumed (single-use, durably)
  before dispatch happens.

- 3b4e82c: Adjudicate `Bash`, `Edit` and `Write` calls, which nothing was.

  Adversarial review suspected it, and a live probe confirmed it: a matched
  RULE-SHAPED allow entry (`Bash(git status:*)` — the exact shape the compiled
  profile grants the mutation-capable built-ins) shadows `canUseTool` exactly
  like a bare name does (`docs/engine-baseline.md` §4.7, measured at engine
  2.1.218 by `builtin-allow-rule-shadowing.live.test.ts`). Together with §4.5
  that meant _no_ production tool grant reached the journal-first adjudication
  callback: every `Bash`, `Edit` and `Write` a worker made executed with no
  adjudication record and sat outside the PostToolUse audit's scope — the same
  hole the gateway family had, on the tools that mutate things.

  The gateway's `PreToolUse` bridge is now the tool-adjudication bridge
  (`tool-adjudication-hook.ts`): it covers the gateway wire prefix plus exactly
  `{Bash, Edit, Write}`, the set the profile grants by rule. Gateway denies are
  enforced as before. Built-in verdicts are **recorded, not enforced** — a
  second live measurement (§4.8, also review-triggered) showed the envelope
  policy is STRICTER than the engine inside a matched rule (the engine executes
  `git status 2>&1`; the policy's metacharacter fail-closed denies it), so
  acting on the verdict would refuse everyday commands like `npm run test 2>&1`
  that the engine grants. The journal entry is the alarm; the engine's own rule
  evaluation plus the OS sandbox remain the boundary. Two exceptions enforce
  even for built-ins: adjudication unavailable denies (no unrecorded mutation
  call proceeds), and an explicit `interrupt` halt is honored.

  Deliberately NOT extended to `Read`/`Glob`/`Grep`: the envelope policy
  default-denies unlisted tools the engine grants without rules — covering them
  would journal meaningless deny verdicts and black-hole reads when the bus is
  down.

  Verified live end-to-end for both `Bash` and `Write`: real adapter-spawned
  workers produced journaled decisions via the bridge, put real records in the
  PostToolUse audit's scope for the first time (Pre→Post `tool_input` measured
  stable for both), and did not spuriously abort.
  `adjudication-bridge.live.test.ts` now ASSERTS those records exist — the
  original version only recorded whether `canUseTool` fired, which is how this
  went unnoticed.

- 0329e58: Make the release gate gate something, and fix two flaky tests at their causes.

  **Every release after the first shipped unscored.** `release-e2e` — the workflow
  that produces the `ReleaseGateReport` — was `workflow_dispatch`-only, so it ran
  when somebody remembered to ask, and between 2026-07-27 and 2026-07-30 nobody
  did: v1.1.2, v1.2.0, v1.3.0 and v1.4.0 all published while the single PASS on
  record had been scored against the v1.0.0 candidate. For a product whose whole
  claim is that it reports honestly, the gate being the one artifact nobody
  re-checks was the worst possible place to carry that debt.

  It is now a reusable workflow, and `publish.yml` calls it on the tagged commit in
  `final` scoring mode with the publish job waiting on the result. `final` matters:
  `interim` resolves missing evidence to EVIDENCE-PENDING, which is right
  mid-development and wrong at a release cut. npm refuses to republish a version
  that has ever existed, so ordering the gate before the publish is the difference
  between a bad release being blocked and a bad release being permanent. The
  binding is guarded by tests that read the real workflow files, because the
  failure mode here is precisely two files drifting apart with everything green.

  **`git worktree add` is now serialized per repository.** Git promises nothing
  about running it concurrently against one repository — `add` enumerates
  `.git/worktrees/*` and reads each entry's `commondir`, which a concurrent `add`
  is in the middle of writing — and the scheduler runs up to four attempts per
  round against the same control clone. The unguaranteed thing was a thing
  production does. This had been dismissed as a flaky test for weeks; it was a real
  reliance on a guarantee that does not exist. Unrelated repositories still proceed
  concurrently, and the cost is one short `add` at a time against a fan-out cap of
  four.

  **A 1000-run property test now owns its own timeout.** The engine-claude session
  property costs ~4s in isolation and borrowed the repository's global 20s budget,
  which is comfortable alone and not comfortable inside a 595-file parallel run.
  Nothing about it was racy — it was a budget, taken from a default that knows
  nothing about this test's cost. `numRuns` is unchanged: a flake is not a reason
  to test less.

  **The README's known gaps say what is actually true.** It cited a
  "known-deferred list" that was not in the repository (it is
  `e2e/live/src/knownDeferredAllowlist.ts`), and omitted four things that are real:
  a worker's gateway calls are not adjudication-journaled, the approval gate stops
  an opportunistic agent rather than an evasive one, the standing policy is a
  boundary against workers and not against a session running as you, and a project
  path long enough to push the daemon's socket past 108 bytes cannot start a
  supervisor.

  **And one ticked exit criterion now matches its own evidence.** Phase 23's
  "zero `NOT_IMPLEMENTED` remains" was ticked while `connection capabilities` still
  returns it and the live sweep passes only because an allowlist exempts it — the
  tick described something stronger than the evidence produced. The check is
  unchanged; the claim now says "outside the recorded deferral allowlist", which is
  what it always measured.

- 811b55b: Fix the last two load-sensitive tests, and raise a lease budget that was thinner
  than it looked.

  Neither had the cause it appeared to have, and one of them was pointing at
  production.

  **The concurrent-token test was not a concurrency bug — but it was conflating two
  claims.** It asserted that exactly one of several overlapping verifications of the
  same single-use token succeeds. Under full-suite load it failed _fast_, which
  ruled out a timeout: the loser had exhausted its lease-acquire budget while the
  winner was still fsyncing, and rejected with a lease error instead of
  `ApprovalTokenAlreadyVerifiedError`. Nothing was double-spent — the safe direction
  — but "at most one succeeds" is a security property and "exactly one succeeds" is
  a liveness one, and folding them into a single assertion made a liveness hiccup
  read as a security failure. They are now separate, and the security half is
  asserted unconditionally.

  **And the budget it exhausted was thin in production too**, which is the part that
  was not a test problem: a verification waited only 20 attempts at 10ms — 200ms —
  for a concurrent verification of the same token to finish. Raised to 1s, still
  well inside the 5s lease TTL so a waiter cannot outlive a dead holder's lease.

  **The benchmark-adapter tests were a borrowed timeout.** Every case spawns a real
  node process, so its cost is dominated by process startup rather than by the
  benchmark inside it: ~1.2s for the whole file alone, competing with hundreds of
  other spawns inside a 600-file parallel run, against a fixed 15s budget. Reported
  for weeks as a flaky benchmark. Now 60s — about 50x the isolated cost, so the
  assertion is decided by the measurement rather than by how busy the machine is.

  Measured rather than assumed, both before and after: the suite previously failed
  roughly one run in three, from a pool of four distinct tests. Six consecutive
  full-suite runs are now clean.

- 231d8e8: Stop the coverage-ratchet property tests from flaking under host load.

  The three `fast-check` property tests in `ratchet.property.test.ts` build
  their histories on a REAL on-disk journal, so each run is I/O-bound, not
  CPU-bound. Under host load the 25–40 runs can exceed the global 20s
  `testTimeout` while the assertions themselves are perfectly correct — a
  timing artifact, not a defect, that surfaced as an intermittent
  `test failed` in local pre-push runs and risked flaking CI.

  Each of the three now carries an explicit 60s per-test timeout, with
  `numRuns` unchanged (coverage is not weakened). This matches the fix already
  applied to engine-claude's own journal-backed property flake.

- e8ae9b7: `crabgic install` keeps an existing standing policy instead of clobbering it.

  Adversarial review (the turn-budget round) found `bootstrapPolicy` had no
  existing-file guard and the policy writer renames over the destination — so
  an owner re-running `install`, for example to acquire a newly added policy
  field, silently replaced their policy with a freshly derived one. That is
  worse than it sounds: network, credential and remote-resource grants are
  never derived, so they exist ONLY by hand, and re-install wiped exactly the
  grants an owner had deliberately added.

  `install` now checks the policy path first, before any derivation or
  prompt. A valid existing policy is kept untouched and reported
  (`kept-existing`), with the remedy stated: edit the file directly, or
  delete it and re-run `install` to re-author. An existing-but-unloadable
  policy is refused with the loader's own reason (`existing-invalid`) rather
  than "repaired" by replacement — overwriting an invalid file loses the
  owner's hand edits just the same. The `loadExisting` guard is a REQUIRED
  member of the installer's policy bag, so no future caller can forget it.

  Also records in `docs/security-posture.md` the review's adjacent latent
  finding: `FALLBACK_MAX_TURNS = 20` in the engine adapter is the one turn
  number the containment gate cannot see (bounded: read-only fallback
  profile, no production caller reaches it today).

- 7704f19: Run-scope `recordAttempt`'s `previousStatus`, closing a repair-budget off-by-one.

  The prior change run-scoped the repair count (`countPriorDispatches`) but
  left `recordAttempt`'s `previousStatus` derived across ALL runs of a work
  unit. Adversarial review caught the resulting inconsistency: if run A left a
  unit's latest transition at `parked:rate_limit` (a rate-limit park that was
  never resumed), run B's FIRST dispatch of that same unit inherited
  `previousStatus = parked:rate_limit` from run A — which the park-resume
  exclusion then wrongly treated as a park-resume and excluded from run B's own
  count, letting the unit take a 4th dispatch before the cap fired.

  `recordAttempt` now derives `previousStatus` run-scoped (via
  `getLatestAttemptForRun`) when a `runId` is given. Within a single run this
  is identical to the unscoped read — the within-run park→resume exclusion is
  unchanged — so only the cross-run inheritance is removed, aligning
  `previousStatus` with the now-run-scoped count. Direction of the old bug was
  inflation-only (it never over-refused), so this tightens correctness without
  changing any passing behavior.

- ff018f4: Run-scope the repair-evidence budget, so a retry as a new run isn't refused by a prior run's exhausted count.

  Work-unit ids are stable across runs of the same change set, and
  `countPriorDispatches` counted `dispatched` transitions by work-unit id
  across ALL runs. So a retry of a change set as a genuinely new run inherited
  the prior run's repair budget (`MAX_TOTAL_DISPATCHES = 3`) and was refused at
  the repair-evidence gate — the last piece keeping a retry-as-new-run from
  completing (the journal seed was already run-scoped; this is its
  counterpart).

  `countPriorDispatches` and `assertRepairAllowed` now take an optional
  `runId`; `dispatchAttempt`/`resumeAttempt` thread the run's own id through.
  Scoped, the count sees only that run's dispatches; absent (direct
  evidence/traceability callers), it is unchanged.

  Security intent preserved: the budget exists to stop a REPAIR LOOP within a
  run from re-running failing work. A fresh run is a deliberate, containment-
  gated, journaled dispatch — a new authorized attempt sequence, not a way to
  launder a failed one — so it legitimately gets its own budget. The
  park-resume exclusion (a rate-limit park→resume never consumes budget) and
  the evidence-distinctness check (deliberately NOT run-scoped — distinct
  diagnostic evidence is a property of the work, not the run) are both intact.

- f6a0eb0: Make `resume` skip already-finished work by seeding from the journal — and remove the attempt cache it supersedes.

  Nothing updates a stored `WorkUnit.attemptStatus` after intake — only the
  journal records transitions — so `driveRun` seeded every unit `pending` on a
  re-drive. A `resume` (crash recovery, limit-park re-dispatch) therefore
  re-selected units that had already succeeded/failed, re-executing them or
  crashing the whole drive at `dispatchAttempt`'s repair-evidence gate
  (`RepairEvidenceRequiredError`, uncaught).

  `driveRun` now seeds each unit's status from the journal's latest attempt,
  scoped to THIS run (`getLatestAttemptForRun`). A re-drive sees the real
  state: `computeReadyUnits` advances only `pending` units, so terminal and
  parked units are left as the prior drive left them, and the crash is gone at
  the root. A unit whose latest status is `dispatched` at drive entry (a prior
  drive that crashed mid-flight) is seeded `failed` — neither silently re-run
  nor misread as `completed`. The read is run-scoped because work-unit ids are
  stable across runs of the same change set, so a workUnitId-only read would
  seed a retry RUN from the PRIOR run's journal.

  **This replaces the in-memory attempt cache** shipped days earlier (wiring
  phase 13's `SchedulerCache` into the run driver, then keying it on the
  policy digest). Adversarial review found the cache was now dead: journal
  seeding sits upstream of it and, being read from the durable journal, does
  the same succeeded-attempt reuse **restart-safely** (the cache was
  in-memory and explicitly did not survive a daemon restart) and without a
  second mechanism to keep in sync. Rather than ship two mechanisms where one
  can never fire — and a cache-hit test that passes even if the cache is a
  no-op — the cache layer (`AttemptCacheSeam`, `attempt-cache.ts`, the
  dispatcher wiring) is removed. `SchedulerCache` itself remains an offered
  phase-13 primitive with its own tests.

  The policy-only sandbox dimensions the cache's digest key was guarding
  (`allowedWriteScratchPaths`, `allowUnixSockets`) need no special handling
  here: a unit that already succeeded committed its work under the authority
  in force at the time; a later policy narrowing governs future dispatches,
  not a retroactive re-run of completed work — which is exactly what
  journal-seeding does.

  Remaining scope (one tracked follow-up): actively resuming a parked unit
  (needs `resumeAttempt` wired with a reconstructed session), transitioning
  run-state on drive settle, and run-scoping `countPriorDispatches` so a retry
  as a genuinely new run gets its own repair budget.

- c5a5571: Transition a run out of `running` when its drive ends in failure, so the change set is retryable.

  `beginDriving` discarded `driveRun`'s result and only released the in-flight
  claim — so a drive that ended `blocked`, tripped the round backstop, or threw
  left the run `running` forever. `findLiveRunForChangeSet` treats `running` as
  in-flight, so that change set could never be re-dispatched: a failed run
  wedged the change set with no recovery short of a daemon restart (review F5).

  `beginDriving` now captures the drive's outcome and moves the run to its
  terminal state on the FAILURE paths: `blocked → blocked`, the round-backstop
  `roundLimit → failed`, and a thrown drive `→ failed`. These are absorbing
  states, so the existing "retry after the prior run ended failed/blocked"
  path unblocks. The transition tolerates the run having reached an absorbing
  state independently — a `run.cancel` racing the settle leaves the run
  `cancelled`, making the drive's own transition an illegal edge, which is
  expected and swallowed.

  `completed` and `parked` deliberately stay `running`: a completed DAG's
  successor is `verifying`, owned by the verification pipeline (not yet wired)
  rather than invented here, and a completed run must not be retried anyway; a
  parked run is resumable and must stay in-flight for `resume` to reach it.

## 1.4.0

### Minor Changes

- 441fb42: Replace the unbounded adversarial review loop with a staged pipeline that terminates, and harden every hardened-open site in the product.

  **The review loop can now end.** The previous design closed a round only when a reviewer produced no finding that was both novel and falsifiable, with no severity floor and no cap. Twelve rounds against one subsystem measured what that costs: every round produced a genuine, reproducible finding, severity fell the whole way, and it never converged. Novelty and falsifiability exclude _manufactured_ findings, which is what they were for — they do not bound the supply of genuine ones, so the criterion measured reviewer exhaustion rather than artifact quality. The reviewer charter also said "do not approve it", leaving it no way to say _done_.

  Termination is now the artifact against written per-stage exit criteria, carried as data with stable ids. A finding blocks only by naming the criterion it violates; one that violates none is advisory. Every finding at any severity carries a disposition that can never be empty, so a stage cannot advance holding an unanswered finding — `advisory` defers a finding and never disposes of one, and debt deferred that way becomes blocking again the moment a later change set touches the code it concerns. Rounds continue only while each closes a blocking finding, then escalate to the owner rather than looping.

  **Closure is computed, not asserted.** The new `review.submit` gateway tool takes a reviewer's findings and decides whether the stage may close. Planned writes come from the change set's own envelope and prior findings from a durable store, so a reviewer cannot understate what it touches to dodge deferred debt, and a clean round cannot erase somebody else's open blocker. The gate-decidable criterion is derived from journaled evidence and subtracted from whatever the caller claimed — gates that never ran are not gates that passed.

  **The classifier says whether it has ever been checked.** The blocking/advisory split is a judgement, and an uncalibrated judge is decorative. Every review result now reports Cohen's kappa against the owner's own recorded judgements, with a corpus store to record them in and a refusal to call anything calibrated on fewer than twenty samples. A fresh project scores zero, which is honest; what would not be honest is returning verdicts without saying nobody has looked.

  **Security fixes, each proven against the built binary.** `doctor` could be made to overwrite an arbitrary file while reporting the sandbox healthy, and a FIFO at the standing-policy path froze it for thirty-six seconds — ignoring SIGTERM, needing SIGKILL, printing nothing — on the code path the dispatch daemon uses. A symlink one directory above the approval signing key put that key in an attacker's directory. Five separate hardened-open implementations had drifted into two behaviours; there is now one, refusing a symlink, a hardlink, a FIFO and a foreign owner, and verifying every directory component below the state root.

  New agents ship for the pipeline's design and plan stages, and the reviewer takes a lens per round rather than repeating one hostile pass.

- aeeb77c: Replace per-ChangeSet approval with a standing `EnvelopePolicy`, and close the loop between an approved change set and a run.

  `crabgic install` now derives an authorization policy from the repository, renders it in full, and writes it `0600` into the project's XDG state directory — never the repo, since a committed standing grant is one every clone would carry. Every dispatch is then checked for containment in it: inside, the run proceeds with no prompt and no token; outside, it is refused before a run exists, so fixing the policy and dispatching again just works. The policy also narrows the compiled worker sandbox, which is what makes standing approval sound rather than nominal — without it a worker's allow-listed test command could reach the whole worktree through a child process. Nothing reachable from a manager session can write or widen the policy, and `crabgic doctor` fails a policy that grants nothing.

  This also fixes three defects found by auditing the shipped binary. Nothing in the system ever created a run record, so an approved change set had no execution path at all — `run.dispatch` now takes a change set and returns the run id it mints, and `crabgic resume` targets a separate `run.resume`. `crabgic status`, `resume` and `cancel` exited `0` with no output whenever the daemon was not already running, instead of reporting that it was unreachable. And run-lifecycle transitions performed a read-modify-write across an await, so a cancel racing a starting run could write two conflicting states into the journal.

  Fresh worktrees now get their dependencies provisioned, without which `npm run test` and `npm run build` — two of the four commands a worker can ever be granted — failed in every worktree. And the manager session is taught a behaviour it did not have: research and clarify with the owner until the contract's sections are all answerable. The review half of that work is described in its own changeset.

  Also hardens the standing policy against a local attacker: the writer can no longer be tricked into destroying an arbitrary file through a predictable temporary name, the loader validates the file it actually read rather than the path it was given, and a policy that grants nothing is now reported by `crabgic doctor` instead of passing every structural check while refusing every run.

## 1.3.0

### Minor Changes

- a2bd006: Add a presentation policy for owner-facing output.

  Crabgic now formats what it says to its owner under an explicit contract:
  answer first, headings past five lines, bullets and tables over paragraphs, a
  fixed semantic glyph vocabulary (✅ ❌ ⚠️ 🛑 ⏳ 🔄 ⏸️ ❓ 📎 ℹ️) instead of ad-hoc
  markers, and colour by verdict. This is an accessibility requirement, not a
  style change.

  - New `presentation` module in `@crabgic/contracts`: the glyph vocabulary with
    `emoji`/`text`/`ascii` profiles, a 256-colour role palette sharing the status
    line's hues, `HUMAN_REPORT_LIMITS`, and `resolvePresentation()`.
  - New human-mode stdout primitives in the CLI (`renderStatusLine`,
    `renderHeading`, `renderBullets`, `renderKeyValues`, `renderHumanReport`) —
    status lines coloured by verdict, leads and headings bold, scaffolding dimmed.
  - `status --watch` gains an optional presentation context. Its default is
    unchanged: piped and redirected output is byte-identical to before.
  - The manager session's `CLAUDE.md` operating protocol gains reporting rules,
    quoted from the policy rather than restated.

  Selection: `emoji` + colour on a TTY, monochrome `text` when piped, `ascii`
  under `CRABGIC_ASCII=1`. `CRABGIC_PRESENTATION=emoji|text|ascii` forces the
  glyph profile; `CRABGIC_COLOR=1|0` forces colour on (even when piped) or off;
  `NO_COLOR` disables colour without touching structure.

  Colour is additive only — stripping the escapes from any coloured render
  reproduces the monochrome render byte for byte, so nothing is visible in colour
  alone. `--json` output is untouched, and outbound artifacts (PR, commit, Jira,
  Grafana) remain neutral and emoji-free under `CommunicationPolicy`.

  See `docs/presentation-policy.md`.

## 1.2.0

### Minor Changes

- 153e3c6: Give the manager session an operating protocol, and enforce the autonomous half of it.

  Installed projects previously received a managed `CLAUDE.md` block that listed the plugin's
  capabilities and said nothing about how to operate. With no instruction to the contrary a Claude
  Code session uses its conversational default and checks in after every step — the opposite of a
  harness whose own design names seven, and only seven, conditions that may halt a run.

  - **New: the manager operating protocol.** Autonomy by default, roadmap/11's seven stop conditions
    as the only legitimate halts, the approval gates, and `AskUserQuestion` as the way to put a
    decision to the owner — never a plain-text list of numbered options. Written once in
    `manager-protocol.ts`, rendered into the managed `CLAUDE.md` block and into a new
    `/eo:protocol` skill that carries the long-form rationale.
  - **New: the Stop autonomy gate.** A deliberately blocking `Stop` hook that refuses to end a turn
    while a run is in flight, so the autonomy clause is enforced rather than merely requested. It
    allows the stop at `awaiting_approval` (a human gate is legitimately open) and at every terminal
    state, cannot loop (`stop_hook_active`), and fails open on every error path — no supervisor, no
    runs, a timeout or a bad response all end the turn normally.
  - **Fixed: the protocol reached repos with an `AGENTS.md`.** The `@AGENTS.md` bridge collapsed the
    entire managed block to that one import line, so those projects received no Crabgic instructions
    at all. The bridge is now additive.
  - **New: `CRABGIC_NO_SPAWN=1`.** Makes any CLI command observe an already-running supervisor
    instead of starting one on demand — what lets a hook ask "is a run in flight?" without booting a
    daemon as a side effect of a session ending.

  Engine facts behind both features are recorded in `docs/engine-baseline.md` §18 (the question
  tool) and §19 (the `Stop` hook control contract), each with a re-runnable spike.

## 1.1.2

### Patch Changes

- 1eba6b2: Stop publishing `dist/.tsbuildinfo`, which was 15% of the package.

  `files: ["dist"]` swept in `tsc -b`'s incremental build state — 199 kB of the
  1299 kB unpacked package, of no use to a consumer. It is also the only file
  that differs between two builds of identical sources in different
  environments, so shipping it made the published artifact non-reproducible,
  directly undermining the reproducible-build criterion the release gate exists
  to enforce. Shipped in 1.0.0 through 1.1.1.

  The published package is now 1099 kB across 28 files; every other file is
  byte-identical to 1.1.1. `scripts/check-published-tarball.mjs` now fails on
  any `.tsbuildinfo` in the tarball, so it cannot come back silently.

## 1.1.1

### Patch Changes

- 75d204e: Fix the status line rendering nothing when it is invoked through a symlink.

  The script's main-module guard compared `import.meta.url` against
  `process.argv[1]` directly. `argv[1]` is the path as invoked, but
  `import.meta.url` is the real path — Node resolves symlinks for module
  identity — so a symlinked invocation looked like a plain import and the entry
  point silently declined to run: exit 0, empty stdout, no error, and Claude
  Code rendering a blank status row with nothing to debug. Resolving `argv[1]`
  before the comparison makes both invocations agree.

  Direct-path invocation, which is what `crabgic install` writes into
  `.claude/settings.json`, was never affected. This only bit a status line
  pointed at the script through a symlink — for example one at
  `~/.claude/crabgic-statusline.mjs` aimed at a globally installed copy, which
  is how it was found.

  The suite now spawns the script for real, both directly and through a
  symlink, because the regression is invisible to a test that imports it.

## 1.1.0

### Minor Changes

- b70d118: Add a Claude Code status line, installed and registered by `crabgic install`.

  The line shows the model and its reasoning effort, the current git branch and dirty
  flag, session context-window usage as a meter, and the 5-hour and weekly subscription
  usage windows — each value clearly divided from the next, on one shared green → amber →
  red scale. A reset countdown appears on a usage window only once it passes 80%.

  Two engine constraints shape the delivery (recorded in `docs/engine-baseline.md` §17,
  read from the 2.1.220 binary): the plugin manifest has no `statusLine` key, and a
  `settings.json` command referencing `${CLAUDE_PLUGIN_ROOT}` is rejected outright. So the
  installer copies the script to `.claude/crabgic-statusline.mjs` as a wholly-owned
  artifact and registers it via `$CLAUDE_PROJECT_DIR`, keeping a committed
  `.claude/settings.json` portable across machines.

  `statusLine` is add-only like every other key the installer writes: a status line you
  already configured is never replaced.

## 1.0.2

### Patch Changes

- Stop the plugin manifest pinning every install to version `0.0.0`, and give the package a README.

  A plugin's effective version resolves `plugin.json` → marketplace entry → source commit SHA,
  and when both files declare one the manifest wins silently. The manifest carried the `0.0.0`
  workspace placeholder while the marketplace entry carried the real release version, so every
  install of `crabgic@crabgic-marketplace` resolved to `0.0.0` — and no later release would have
  reached an already-installed user. The manifest no longer declares a version at all, leaving
  the marketplace entry, which the release preparer recomputes each release, as the sole
  declared version. The resolution order is now recorded as `docs/engine-baseline.md` §16.

  The published package also had no README — `npm view crabgic readme` returned "No README data
  found" — so the npm listing rendered blank. It now ships one.

  The marketplace listing carries the real owner address in place of a placeholder, plus the
  optional discovery metadata the marketplace reference supports (`displayName`, `author`,
  `homepage`, `repository`, `keywords`).

## 1.0.1

### Patch Changes

- Ship the plugin's distributable assets in the published package.

  `1.0.0` bundled the CLI's JavaScript but not the plugin's DATA — the two
  subagents, the hooks, the five skills, `.mcp.json` and
  `.claude-plugin/marketplace.json`. `@crabgic/plugin` is a private workspace
  package that is never published, so `resolvePluginSourceDir` looked for a
  module that does not exist outside the monorepo. In any consuming repo both
  `crabgic doctor` and `crabgic install` — the command the package exists to be
  installed for — failed with
  `Cannot find module '@crabgic/plugin/package.json'`.

  The assets now ship at `<dist>/plugin`, byte-identical to the source so the
  content digest `marketplace.json` records still validates, and the resolver
  prefers that layout with the workspace path as a fallback.

  `scripts/check-install-smoke.mjs` now runs `crabgic doctor` from the
  installed package rather than only probing the argument parser — the gap that
  let this reach the registry with every other check green.

## 1.0.0

### Major Changes

- Initial public release.

  Crabgic is a harness that makes Claude operate as an autonomous engineering
  orchestrator: it plans work into change sets, runs them through a supervised
  worker runtime against isolated git worktrees, and gates every result behind
  quality, security and performance verification before anything is published.

  - Supervised daemon and UDS control plane, with crash recovery, idempotent
    resume and lease-based concurrency over an append-only event journal.
  - Git control repo and worktrees, with overlap analysis, merge preflight and
    neutral branch/commit rendering that never leaks development-engine
    attribution.
  - Connector gateway with Jira Cloud/Data Center and Grafana adapters,
    exactly-once mutation with read-back verification, and an operation journal.
  - Quality, security and performance gates, including PerformanceContract
    decisioning and a reviewed learning pipeline.
  - `crabgic` CLI and doctor, plus a Claude Code plugin and installer.
