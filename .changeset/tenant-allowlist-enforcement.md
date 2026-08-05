---
"crabgic": patch
---

**`ExternalConnection.tenantAllowlist` was a published schema field that looked like a security
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
