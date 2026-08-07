---
"crabgic": patch
---

**Refusing a write to an undiscovered Data Center custom field raised the wrong error kind and blamed
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
