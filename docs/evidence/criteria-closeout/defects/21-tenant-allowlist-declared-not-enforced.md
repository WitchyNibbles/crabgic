# 21 — `ExternalConnection.tenantAllowlist` is declared and enforced nowhere

**Phase:** 21 — Connector evidence ↔ contracts/verification, drift CI
(`roadmap/21-connector-evidence-integration.md`)

**Found:** 2026-08-05, while fixing the tautological tenant-boundary gate (PR #94). Confirmed
independently by the implementing agent and its adversarial reviewer.

## Gap

`packages/contracts/src/contracts/external-connection.ts:85` declares an optional readonly
`tenantAllowlist`. **Nothing anywhere reads it.**

Repo-wide, the field appears in exactly four places: the zod declaration, the JSON schema
(`packages/contracts/schemas/external-connection.json:34`), one test fixture
(`external-connection.test.ts:11`), and a ruling comment added by PR #94.

Stronger evidence than absence-of-reference — **there is no tenant comparison anywhere in production
source at all**:

```
git grep -nE 'tenant.*(===|!==|includes\(|indexOf)' -- packages   →  zero hits
```

run in both plain and `:(glob)` pathspec forms, because a wildmatch pathspec silently skips nested
paths and would have produced a smaller answer with no error.

And the value that _is_ used is derived from a different field entirely —
`packages/connectors-jira/src/resource-client/jira-resource-client.ts:68`:

```ts
deps.tenant ?? ctx.connection.projectAllowlist?.[0] ?? ctx.connection.id;
```

`projectAllowlist`, never `tenantAllowlist`. The declared field is not merely unenforced; it is not
read on any path. `plan.tenant` is then only ever **stamped** and used as a `WriteSerializerKey`
(`packages/gateway/src/transport/http-client.ts:139`) — a concurrency key, not an authorization check.

## Why this is worse than an unimplemented feature

A configuration field that looks like a security control and does nothing is worse than no field at
all: an operator who sets `tenantAllowlist` will reasonably believe cross-tenant access is refused.
Nothing refuses it. The schema publishes the field, so the belief is invited by the contract itself.

## Remedy

**M.** Either (a) enforce it — a real comparison on the connection path, with a reverse probe proving
the guard bites — or (b) remove the field from the contract and schema and say so in the changelog.
**Do not leave it declared-and-inert.** If enforcement is deferred, the field should carry a doc
comment stating plainly that it is not yet enforced.

Needs no live engine, no Docker and no owner subscription.
