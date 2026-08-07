---
"crabgic": minor
---

**`ExternalConnection.folderAllowlist` was a published schema field that looked like a security
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
