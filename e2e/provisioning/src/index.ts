export type { ComposeRunner, ContainerStatus, SurvivingResources } from "./composeRunner.js";
export {
  registerCrashHandlers,
  type Cleanup,
  type CrashHandlerOptions,
  type RegisteredCrashHandlers,
} from "./crashHandlers.js";
export { provisionAndRun, type ProvisionDeps } from "./provisioning.js";
export {
  ProvisionConfigSchema,
  type HealthProbe,
  type ProbeContext,
  type ProvisionConfigInput,
  type ProvisionConfig,
  type ProvisionOutcome,
  type RunProbe,
} from "./types.js";
export { verifyTornDown, type TeardownVerification } from "./verifyTornDown.js";
