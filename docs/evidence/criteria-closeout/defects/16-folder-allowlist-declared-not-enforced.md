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

## Remedied 2026-08-07 — enforced, with a ruling that has a visible Jira consequence

PR #125 enforced the field at `executeMutationPlan`, on the pattern PR #100 established for
`tenantAllowlist`, through a three-valued provider `folderAttribution` hook whose answers are
`folders` / `outside-folders` / `unknown`. The seam was chosen by measurement, not preference: a
folder is not on the mutation plan at all, and the plan schema is `.strict()` and phase-02-owned, so
adding a field there would be a coordinated change across four phases plus the interface ledger and
would make every connector fill a field only Grafana can populate. Exactly one production site can
see the real connection, and it is the one that already hands over `tenantAllowlist`. Evidence:
`docs/evidence/phase-16/folder-allowlist-batchC.txt`.

**THE RULING AND ITS JIRA CONSEQUENCE, recorded because it is a behaviour change for any operator who
already set the field.** The spec is silent about a provider that has no folder concept, and two
readings were available. Admitting an unattributable mutation would bind only providers that opted
in, with nothing telling an operator which — the same trusted-and-inert control shape this record is
about, rebuilt one level up. So the ruling is: **a provider that supplies no attribution is REFUSED,
not waved through.** The visible consequence, written into the code and into the published schema
description rather than left to be rediscovered as a bug: **setting `folderAllowlist` on a Jira
connection refuses every Jira mutation on that connection**, loudly and with a typed `policy_blocked`
reason, because Jira has no folder concept and registers no hook. Grafana's `annotation` kind is
`unknown` by construction — its payload names only a dashboard — and is likewise refused on a
folder-scoped connection. Both are deliberate and both are pinned. Probe I implements the rejected
reading and shows exactly four assertions separate the two, one of them the empty-quantifier hole
where an empty attributed folder list satisfies "every attributed folder is a member" vacuously.

**Scope bound, verbatim from the change, because an oversold control is how one ends up trusted and
inert:** it binds the folder the provider derives **from the plan**, never where the resource
actually lives on the remote; mutations only, reads are not folder-checked; it is not "writes outside
these folders are impossible", it is "an operator can bound which folder a write may claim to land
in."

A probe finding worth keeping: deleting the Grafana registration left everything green against this
batch's own first draft — the mapping was unit-tested and the pipeline's admission rule was tested,
and nothing pinned that the connector installs the one into the other. A hook that exists and is
never registered is dead code cited as a bearer. Three cases were added to close it, and in two
separate probes the **control** rather than the refusal is the bearer, because an assertion that only
checked "refused" would have passed in both worlds.

**Kept open, named as future work:** there is no config-time signal for either consequence. A
connection-doctor warning is the remedy, routed here as a reviewer advisory rather than built.
