/**
 * The full per-ecosystem detector registry — one entry per `StackEvidence`
 * category (roadmap/12 §In scope, "Detection" bullet's 10 named
 * categories). `../evidence-builder.ts` runs every detector below over one
 * shared `DetectionContext`.
 */
import { manifestDetector } from "./manifest-detector.js";
import { lockfileDetector } from "./lockfile-detector.js";
import { languageRuntimeDetector } from "./language-runtime-detector.js";
import { sourceCompositionDetector } from "./source-composition-detector.js";
import { ciDetector } from "./ci-detector.js";
import { containerDetector } from "./container-detector.js";
import { infrastructureDetector } from "./infrastructure-detector.js";
import { migrationDetector } from "./migration-detector.js";
import { deploymentConfigDetector } from "./deployment-config-detector.js";
import { observabilityDetector } from "./observability-detector.js";
import type { Detector } from "./types.js";

export const ALL_DETECTORS: readonly Detector[] = [
  manifestDetector,
  lockfileDetector,
  languageRuntimeDetector,
  sourceCompositionDetector,
  ciDetector,
  containerDetector,
  infrastructureDetector,
  migrationDetector,
  deploymentConfigDetector,
  observabilityDetector,
];

export * from "./types.js";
export * from "./manifest-detector.js";
export * from "./lockfile-detector.js";
export * from "./language-runtime-detector.js";
export * from "./source-composition-detector.js";
export * from "./ci-detector.js";
export * from "./container-detector.js";
export * from "./infrastructure-detector.js";
export * from "./migration-detector.js";
export * from "./deployment-config-detector.js";
export * from "./observability-detector.js";
