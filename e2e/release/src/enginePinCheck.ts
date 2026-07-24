import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { CheckoutExporter } from "./checkoutExporter.js";

/**
 * The engine/SDK pin assertion — roadmap/23-release-hardening.md work item
 * 10: "verify `@anthropic-ai/claude-agent-sdk` is exact-pinned identically
 * (0.3.218) in the packed artifact (Exit criterion: pin identical in both
 * from-clean-checkout tarballs)." `packages/cli`'s own `package.json` does
 * NOT declare this dependency directly — it flows in transitively
 * (`packages/cli` -> `@eo/plugin` -> `@eo/engine-claude`, confirmed by
 * reading each manifest) — so the pin this check verifies is
 * `packages/engine-claude/package.json`'s own `dependencies["@anthropic-ai/
 * claude-agent-sdk"]` entry, read from each of the SAME two independent
 * clean checkouts `reproducibleBuildCheck.ts` exports (reusing the same
 * `CheckoutExporter` seam, never a second export mechanism).
 *
 * `EXPECTED_SDK_PIN` mirrors `@eo/engine-claude`'s own `version-gate.ts`
 * convention (`TESTED_ENGINE_VERSION = "2.1.218"`, hardcoded there with an
 * explicit citation to `docs/engine-baseline.md` rather than parsed from
 * that doc at runtime): the corresponding SDK point version
 * `docs/engine-baseline.md` records 1:1 alongside the CLI version
 * (`0.3.218`<->`2.1.218`).
 */
export const EXPECTED_SDK_PIN = "0.3.218";
export const SDK_DEPENDENCY_NAME = "@anthropic-ai/claude-agent-sdk";

export class SdkPinNotFoundError extends Error {
  constructor(readonly manifestPath: string) {
    super(
      `${manifestPath}: no exact-pinned "${SDK_DEPENDENCY_NAME}" dependency found — expected an ` +
        'exact semver string (engine-pin-lint policy, roadmap/01), never a "^"/"~"/range.',
    );
    this.name = "SdkPinNotFoundError";
  }
}

/** Reads the exact-pinned `@anthropic-ai/claude-agent-sdk` dependency specifier out of a `package.json` file. Throws `SdkPinNotFoundError` if the dependency is absent — never silently returns `undefined`, since a missing pin in the packed artifact is itself a release-blocking fact this check must surface. */
export function readSdkPin(packageJsonPath: string): string {
  const manifest = JSON.parse(readFileSync(packageJsonPath, "utf8")) as {
    readonly dependencies?: Readonly<Record<string, string>>;
  };
  const pin = manifest.dependencies?.[SDK_DEPENDENCY_NAME];
  if (pin === undefined) {
    throw new SdkPinNotFoundError(packageJsonPath);
  }
  return pin;
}

export interface EnginePinCheckResult {
  readonly pinA: string;
  readonly pinB: string;
  /** `true` iff both checkouts' pins are byte-identical strings. */
  readonly match: boolean;
  /** `true` iff both checkouts' pins ALSO equal `EXPECTED_SDK_PIN` — a stricter fact than mere mutual agreement (two checkouts could agree on a stale/wrong pin). */
  readonly matchesBaseline: boolean;
}

export interface CheckEnginePinOptions {
  readonly exporter: CheckoutExporter;
  readonly commitIsh: string;
  /** Relative to the exporter's own repo root — `"packages/engine-claude"`, the package that declares the exact SDK pin. */
  readonly enginePackageSubPath: string;
}

/** Exports two independent clean checkouts of `enginePackageSubPath` at `commitIsh` (reusing the same `CheckoutExporter` seam `reproducibleBuildCheck.ts` uses) and cross-checks their exact-pinned SDK dependency string. */
export async function checkEnginePinAcrossCheckouts(
  options: CheckEnginePinOptions,
): Promise<EnginePinCheckResult> {
  const dirA = await options.exporter.exportCheckout(
    options.commitIsh,
    options.enginePackageSubPath,
  );
  const dirB = await options.exporter.exportCheckout(
    options.commitIsh,
    options.enginePackageSubPath,
  );
  try {
    const pinA = readSdkPin(join(dirA, "package.json"));
    const pinB = readSdkPin(join(dirB, "package.json"));
    return {
      pinA,
      pinB,
      match: pinA === pinB,
      matchesBaseline: pinA === EXPECTED_SDK_PIN && pinB === EXPECTED_SDK_PIN,
    };
  } finally {
    await options.exporter.cleanup(dirA);
    await options.exporter.cleanup(dirB);
  }
}
