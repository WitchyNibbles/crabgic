---
"crabgic": minor
---

**A completed run now walks the verification pipeline, and the security gates fire — blocking. A run
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
