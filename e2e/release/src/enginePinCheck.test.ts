import { execFile } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  FakeCheckoutExporter,
  GitArchiveExporter,
  type CheckoutExporter,
} from "./checkoutExporter.js";
import {
  checkEnginePinAcrossCheckouts,
  EXPECTED_SDK_PIN,
  readSdkPin,
  SdkPinNotFoundError,
} from "./enginePinCheck.js";

const execFileAsync = promisify(execFile);

function manifestWithPin(pin: string): string {
  return JSON.stringify({ dependencies: { "@anthropic-ai/claude-agent-sdk": pin } });
}

describe("readSdkPin — unit (fixture manifests)", () => {
  let scratchDir: string;

  beforeEach(async () => {
    scratchDir = await mkdtemp(join(tmpdir(), "eo-sdk-pin-fixture-"));
  });

  afterEach(async () => {
    await rm(scratchDir, { recursive: true, force: true });
  });

  it("reads an exact-pinned SDK dependency string", async () => {
    const manifestPath = join(scratchDir, "package.json");
    await writeFile(manifestPath, manifestWithPin("0.3.218"));
    expect(readSdkPin(manifestPath)).toBe("0.3.218");
  });

  it("throws SdkPinNotFoundError when the dependency is absent", async () => {
    const manifestPath = join(scratchDir, "package.json");
    await writeFile(manifestPath, JSON.stringify({ dependencies: { zod: "3.25.76" } }));
    expect(() => readSdkPin(manifestPath)).toThrow(SdkPinNotFoundError);
  });
});

describe("checkEnginePinAcrossCheckouts — unit (fake exporter)", () => {
  it("reports match:true and matchesBaseline:true for two checkouts pinned identically at the expected baseline", async () => {
    const exporter = new FakeCheckoutExporter(
      new Map([["c1", { "package.json": manifestWithPin(EXPECTED_SDK_PIN) }]]),
    );
    const result = await checkEnginePinAcrossCheckouts({
      exporter,
      commitIsh: "c1",
      enginePackageSubPath: "packages/engine-claude",
    });
    expect(result).toEqual({
      pinA: EXPECTED_SDK_PIN,
      pinB: EXPECTED_SDK_PIN,
      match: true,
      matchesBaseline: true,
    });
  });

  it("FAIL-FIRST PROOF: reports match:false when the two exported checkouts genuinely disagree on the pin", async () => {
    // A hand-built CheckoutExporter that returns DIFFERENT content on its
    // 1st vs. 2nd call even for the identical commit-ish — simulating the
    // failure mode the real byte-for-byte comparison exists to catch (a
    // from-clean-checkout drift), without needing FakeCheckoutExporter's
    // own by-design same-commit-same-content guarantee to get in the way.
    let call = 0;
    const driftingExporter: CheckoutExporter = {
      exportCheckout: async () => {
        call += 1;
        const pin = call === 1 ? "0.3.218" : "0.3.210";
        const dir = await mkdtemp(join(tmpdir(), "eo-drifting-checkout-"));
        await mkdir(dir, { recursive: true });
        await writeFile(join(dir, "package.json"), manifestWithPin(pin));
        return dir;
      },
      cleanup: async (dir) => {
        await rm(dir, { recursive: true, force: true });
      },
    };

    const result = await checkEnginePinAcrossCheckouts({
      exporter: driftingExporter,
      commitIsh: "c1",
      enginePackageSubPath: "packages/engine-claude",
    });
    expect(result.match).toBe(false);
    expect(result.pinA).not.toBe(result.pinB);
  });

  it("reports matchesBaseline:false when both checkouts agree with each other but NOT with EXPECTED_SDK_PIN", async () => {
    const exporter = new FakeCheckoutExporter(
      new Map([["c1", { "package.json": manifestWithPin("0.3.999") }]]),
    );
    const result = await checkEnginePinAcrossCheckouts({
      exporter,
      commitIsh: "c1",
      enginePackageSubPath: "packages/engine-claude",
    });
    expect(result.match).toBe(true);
    expect(result.matchesBaseline).toBe(false);
  });
});

describe("checkEnginePinAcrossCheckouts — genuine integration (real git archive, this repo's own packages/engine-claude @ HEAD)", () => {
  it("both checkouts report the identical, expected 0.3.218 pin", async () => {
    const { stdout: repoRootRaw } = await execFileAsync("git", ["rev-parse", "--show-toplevel"], {
      cwd: import.meta.dirname,
    });
    const repoRoot = repoRootRaw.trim();
    const exporter = new GitArchiveExporter({ repoRoot });

    const result = await checkEnginePinAcrossCheckouts({
      exporter,
      commitIsh: "HEAD",
      enginePackageSubPath: "packages/engine-claude",
    });

    expect(result.pinA).toBe(EXPECTED_SDK_PIN);
    expect(result.pinB).toBe(EXPECTED_SDK_PIN);
    expect(result.match).toBe(true);
    expect(result.matchesBaseline).toBe(true);
  });
});
