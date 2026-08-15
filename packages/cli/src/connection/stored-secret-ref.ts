import type { SecretReference } from "@crabgic/contracts";
import { CliUsageError } from "../errors.js";

/**
 * The CLI's argv-level reference forms (`../argv/secret-reference.ts`:
 * `env:NAME`, `op://…`, `vault://…`, `file:///abs/path`, `ref:id`) are a
 * DIFFERENT, wider vocabulary than the stored contract's
 * `SecretReferenceSchema` (02), which has exactly three backends —
 * `env`/`file`/`exec`. This converts the two that have a faithful
 * representation and refuses the rest loudly.
 *
 * Refusing is the correct behavior, not a shortcoming: silently coercing
 * `op://vault/item` into, say, an `exec` backend would invent a resolution
 * mechanism the operator never asked for. Widening
 * `SecretReferenceSchema` to carry secret-manager URIs is a 02 contract
 * change and belongs to whoever adds real support for those backends.
 * (`exec` is unreachable from argv today for the mirror-image reason: the
 * CLI's own reference pattern has no `exec:` form.)
 *
 * Extracted from `./connection-commands.ts` (2026-08-14) when
 * `./jira-config-from-command.ts` needed the same conversion for the
 * SECOND half of a credential pair. A copy would have been a second
 * answer to "which reference forms are storable", free to drift.
 */
export function toStoredSecretRef(raw: string): SecretReference {
  if (raw.startsWith("env:")) {
    return { backend: "env", variable: raw.slice("env:".length) };
  }
  if (raw.startsWith("file://")) {
    return { backend: "file", path: raw.slice("file://".length) };
  }
  throw new CliUsageError(
    `secret reference "${raw.split(":")[0]}:…" is not storable on a connection ` +
      `(supported: env:NAME, file:///abs/path)`,
  );
}
