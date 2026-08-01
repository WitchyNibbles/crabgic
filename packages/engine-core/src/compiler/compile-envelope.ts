import type { AuthorizationEnvelope, EnvelopePolicy } from "@crabgic/contracts";
import type { RuntimeRootsDenyInput } from "./xdg-default-paths.js";
import { emitPermissionProfile } from "./permission-profile.js";
import { emitSandboxProfile } from "./sandbox-profile.js";
import { toWorkerSettingsJson, toWorkerSdkOptions } from "./worker-settings.js";
import {
  CompiledWorkerProfileSchema,
  type CompiledWorkerProfile,
} from "./compiled-worker-profile.js";

/**
 * `compileEnvelope` — the pure function at the center of this phase
 * (roadmap/03-envelope-compiler-engine-adapter.md §Goal, work items 2/3):
 * `AuthorizationEnvelope -> CompiledWorkerProfile`. Never mutates its
 * input (coding-style: immutability) — every sub-emitter only reads from
 * `envelope` and returns freshly-constructed values.
 *
 * `policy` (ledger Gap 18 part 5) narrows the two grants the compiler must
 * otherwise make wide — `filesystem.allowWrite` and unix sockets. See
 * `./sandbox-profile.ts` for why they are wide without one, and why omitting
 * it is sound ONLY where a human reviews the resulting diff. The standing
 * approval path must always supply one.
 */
export function compileEnvelope(
  envelope: AuthorizationEnvelope,
  policy?: EnvelopePolicy,
  runtimeRoots?: RuntimeRootsDenyInput,
): CompiledWorkerProfile {
  const permissions = emitPermissionProfile(envelope, runtimeRoots);
  const sandbox = emitSandboxProfile(envelope, policy, runtimeRoots);
  const settingsJson = toWorkerSettingsJson(permissions, sandbox);
  const sdkOptions = toWorkerSdkOptions(permissions);

  return CompiledWorkerProfileSchema.parse({ permissions, sandbox, settingsJson, sdkOptions });
}
