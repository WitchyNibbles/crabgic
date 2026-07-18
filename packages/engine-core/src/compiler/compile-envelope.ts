import type { AuthorizationEnvelope } from "@eo/contracts";
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
 */
export function compileEnvelope(envelope: AuthorizationEnvelope): CompiledWorkerProfile {
  const permissions = emitPermissionProfile(envelope);
  const sandbox = emitSandboxProfile(envelope);
  const settingsJson = toWorkerSettingsJson(permissions, sandbox);
  const sdkOptions = toWorkerSdkOptions(permissions);

  return CompiledWorkerProfileSchema.parse({ permissions, sandbox, settingsJson, sdkOptions });
}
