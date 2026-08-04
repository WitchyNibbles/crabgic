# Defect 23-jira-live-exactly-once-never-run

**Phase:** 23 — Release hardening & publication (`roadmap/23-release-hardening.md`, exit criterion 7)

**Criterion (verbatim):**

> Jira/Grafana exactly-once and read-back verification pass live (16/18/19/20).

**Found:** 2026-08-04, criteria-closeout pass (phase 23), at
`3dec9bf2caa6b94bd817aee414f9458c37750fd9`.

**Severity:** HIGH, and deploy-relevant rather than bookkeeping-only. This phase is the gate on
shippability, and the shipped release's Jira exactly-once story has never touched a real Jira — not
a sandbox tenant, not a Data Center container. The pipeline is proven hard against fault-injected
cassettes, so no product defect is implied or observed; what has never been retired is the risk the
word "live" exists to retire, that hand-modelled Jira wire fixtures disagree with a real server.

## Gap

Five conjuncts. Two are met, three are not.

| Conjunct                          | Status at `3dec9bf`                                                                                                                                                                      |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Grafana exactly-once + read-back  | **met, and genuinely containerized** — the release-e2e traceability binding drives a real `executeMutationPlan` against `grafana/grafana-oss:12.4.3` and reads the applied revision back |
| Jira exactly-once + read-back     | **cassette only** — `e2e/matrix/connector/src/exactly-once/` is replay against recorded fixtures                                                                                         |
| "pass **live**" for the Jira half | **not met** — no live Jira Cloud sandbox run and no Data Center container run exists anywhere in this repository's history                                                               |
| the span includes **19**          | **not met** — phase 19 (Jira Data Center adapter) has 0 ticked exit criteria, 7 unticked, and no closeout record                                                                         |
| the span includes 16/18/20        | met, at cassette level; 20's half additionally reaches a real container                                                                                                                  |

### Measurement trail

Full transcripts: `docs/evidence/phase-23/closeout/c6-c7-live-gap.txt` and
`docs/evidence/phase-23/closeout/lane-and-channel-audit.txt` — both UTC-stamped, HEAD-pinned, each
command echoed with its own exit status.

| Check                                                          | Result at `3dec9bf`                                                                                         |
| -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| total runs, ever, of `jira-datacenter-smoke.yml` (GitHub API)  | **0**                                                                                                       |
| total runs, ever, of `engine-live.yml`                         | **0**                                                                                                       |
| workflows referencing `docker/jira-datacenter/smoke-test.sh`   | only `jira-datacenter-smoke.yml:28`, which has never run                                                    |
| workflows referencing `e2e/provisioning/vitest.live.config.ts` | **none** — no CI channel invokes it                                                                         |
| what scores the `jira-grafana-exactly-once` item               | 28 `EvidenceRecord`s, every one tagged `release-gate:connector-matrix` (the cassette harness's blanket tag) |
| roadmap/19 checkbox state                                      | `0` ticked, `7` unticked                                                                                    |

The tag mapping is how cassette evidence comes to score a criterion whose own word is "live":
`e2e/report/src/checklist.ts:108-119` OR-accepts `release-gate:connector-matrix` alongside the
item's dedicated tag, and in both final release-gate reports every linked record carries the former
and none carries the latter.

### Why this is `UNMET` and not `EVIDENCE-NEEDS-LIVE`

`EVIDENCE-NEEDS-LIVE` is for a finished harness waiting on an owner-gated channel. That describes
the Grafana half and, arguably, a Jira Cloud sandbox run. It does not describe the **19** conjunct:
there is no Data Center adapter surface finished enough for a live run to certify, so this is not
one authorised dispatch away from closing. Reading "pass live (16/18/19/20)" down to "cassettes for
Jira plus one containerized Grafana dashboard mutation" loses the guarantee the clause states, and
the closeout protocol classifies a weaker guarantee as `UNMET`, never as a wording fix.

### What is explicitly not being claimed

The exactly-once mechanism is not in doubt. It is exercised against fault-injected cassettes
including a genuine RED→GREEN replay-with-changed-payload vector and a mid-POST-timeout
reconciliation vector, and the whole lane was re-run green at this pass's HEAD
(`docs/evidence/phase-23/closeout/c8-c10-live-and-matrix-lanes.txt`, 15 files / 95 tests, `EXIT=0`).
This defect is about the word "live" and about a named dependency phase that does not exist yet.

## Proposed remedy

In dependency order:

1. **Execute phase 19.** Its seven exit criteria are the Data Center adapter this criterion's span
   names. Nothing downstream can honestly close until that surface exists.
2. **Dispatch `jira-datacenter-smoke` for the first time**, against `docker/jira-datacenter/`'s
   10.3 and 11.3 recipes. This is a Docker workload, not an engine one — it spends no model
   subscription — but it is a workflow dispatch and therefore an owner action.
3. **Run the exactly-once matrix against a live Jira Cloud sandbox tenant**, the one phase 18's own
   notes say is provisioned early for exactly this purpose, and record the run under
   `docs/evidence/phase-23/`.
4. Then re-score criterion 7 against those runs, and — separately — consider tightening
   `checklist.ts`'s `jira-grafana-exactly-once` item so that a live tag, not the cassette harness's
   blanket tag, is what satisfies it.

**Effort: L.** Step 1 alone is a full roadmap phase. Steps 2–4 are S/M individually once it exists.

**Needs:** a live Docker daemon (steps 2), a disposable Jira Cloud sandbox tenant with credentials
(step 3), and owner authorisation for both dispatches. **Does not need** the Claude engine or the
owner's model subscription.

**Ticket-ready:** yes for steps 2–4; step 1 is already tracked as roadmap phase 19.
