import type { AuthorizationEnvelope } from "@eo/contracts";
import { SandboxProfileSchema, type SandboxProfile } from "./compiled-worker-profile.js";
import { validateNetworkDestination } from "./network-destination.js";
import {
  CONTROL_REPO_STATE_ROOT_DENY_PATH,
  CONTROL_REPO_CACHE_ROOT_DENY_PATH,
  SSH_DENY_PATH,
  AWS_DENY_PATH,
} from "./xdg-default-paths.js";
import {
  WORKTREE_WRITE_PLACEHOLDER,
  WORKER_TMP_WRITE_PLACEHOLDER,
} from "./worktree-placeholders.js";

/**
 * Re-exported for existing consumers that imported these placeholder
 * tokens from this module — the single source of truth is now
 * `./worktree-placeholders.js` (phase-03 security-fix round, CRITICAL 1),
 * shared with `permission-profile.ts`'s owned-path `Edit`/`Write` allow
 * emission. See that module's own doc comment for why this was lifted out
 * of this file.
 */
export { WORKTREE_WRITE_PLACEHOLDER, WORKER_TMP_WRITE_PLACEHOLDER };

/**
 * `emitSandboxProfile` — roadmap/03-envelope-compiler-engine-adapter.md
 * work item 3 (adaptation §4.2; docs/engine-baseline.md §6). Pure: only
 * reads `envelope`, never mutates it.
 */
export function emitSandboxProfile(envelope: AuthorizationEnvelope): SandboxProfile {
  return SandboxProfileSchema.parse({
    enabled: true,
    failIfUnavailable: true,
    allowUnsandboxedCommands: false,
    network: {
      allowedDomains: envelope.networkDestinations.map(validateNetworkDestination),
      // The Linux/WSL2 UDS gate (docs/engine-baseline.md §6, "Schema
      // correction: Unix-socket allow flag") — NEVER `allowUnixSockets`
      // (a differently-typed, macOS-only, `string[]` path allowlist,
      // "ignored on Linux (seccomp cannot filter by path)").
      allowAllUnixSockets: true,
      allowLocalBinding: false,
    },
    filesystem: {
      allowWrite: [WORKTREE_WRITE_PLACEHOLDER, WORKER_TMP_WRITE_PLACEHOLDER],
      denyRead: [
        CONTROL_REPO_STATE_ROOT_DENY_PATH,
        CONTROL_REPO_CACHE_ROOT_DENY_PATH,
        SSH_DENY_PATH,
        AWS_DENY_PATH,
      ],
    },
    credentials: {
      envVars: envelope.credentialReferences.map((name) => ({ name, mode: "mask" as const })),
    },
  });
}
