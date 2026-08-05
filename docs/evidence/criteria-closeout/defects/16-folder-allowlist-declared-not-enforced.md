# 16 — `ExternalConnection.folderAllowlist` is declared and read nowhere

**Phase:** 16 — Connector gateway core: transport, secrets, op journal
(`roadmap/16-gateway-core.md`)

**Found:** 2026-08-05, by adversarial review of PR #100 — the sibling of
`21-tenant-allowlist-declared-not-enforced.md`, found by asking what else on that contract shares its
shape.

## Gap

`packages/contracts/src/contracts/external-connection.ts:129` declares `folderAllowlist`. **No
production code reads it.** Same declared-and-inert shape as `tenantAllowlist` before PR #100.

One mitigating difference, and it matters: `tenantAllowlist`'s description implied an enforcement it
did not have, which is what made it dangerous. `folderAllowlist`'s bare description **claims nothing**,
so it misleads less. It is still a field an operator can set to no effect.

For completeness, the third sibling: `projectAllowlist` **is** read, but only as a derivation fallback
for a plan's tenant (`packages/connectors-jira/src/resource-client/jira-resource-client.ts:68`) — it is
not an authorization check either.

## Remedy

**S.** Pick one, deliberately:

1. **Enforce** it, following PR #100's pattern — a check at the sole issuer of the relevant I/O, a
   typed refusal before any journal write, and a scope sentence in the published `.describe()` that
   states exactly what it does and does not bind.
2. **Document the inertness** in the `.describe()` so the schema cannot invite a false belief, and
   file the enforcement as future work.

⚠️ **Do not remove it.** PR #100 measured why: `ExternalConnectionSchema` is `.strict()` and
`file-external-connection-store.ts:110` re-parses every stored record on read, so deleting a declared
field makes any connection carrying it throw `ZodError` on next read.

Needs no live engine, no Docker and no owner subscription.
