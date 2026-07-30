---
"crabgic": minor
---

Adjudicate gateway tool calls, which nothing was doing.

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
