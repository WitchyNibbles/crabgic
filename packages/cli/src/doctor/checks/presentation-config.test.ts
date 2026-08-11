import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PRESENTATION_CONFIG_RELPATH } from "@crabgic/contracts";
import { createPresentationConfigCheck } from "./presentation-config.js";

/**
 * `loadPresentationPolicy` falls back to the defaults on every failure, which
 * is correct at runtime and leaves one hole: an operator who edits the config,
 * gets it wrong, and sees no change has no way to learn why. This check is the
 * channel that closes it, so its most important case is the REJECTED one.
 */
let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "eo-presentation-check-"));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function writeConfig(body: string): Promise<void> {
  await mkdir(join(root, ".crabgic"), { recursive: true });
  await writeFile(join(root, PRESENTATION_CONFIG_RELPATH), body, "utf8");
}

describe("presentation.config check", () => {
  it("passes, saying the defaults are in force, when there is no config", async () => {
    const finding = await createPresentationConfigCheck({ projectRoot: root }).run();
    expect(finding.passed).toBe(true);
    expect(finding.evidence).toMatch(/defaults are in force/i);
  });

  it("FAILS with the reason when a config exists but was rejected", async () => {
    await writeConfig("{ not json");
    const finding = await createPresentationConfigCheck({ projectRoot: root }).run();
    expect(finding.passed).toBe(false);
    expect(finding.evidence).toMatch(/rejected/i);
    expect(finding.repairStep).toContain(PRESENTATION_CONFIG_RELPATH);
  });

  it("names the offending member, not just that something was wrong", async () => {
    await writeConfig(JSON.stringify({ limits: { bulletMaxColumns: -3 } }));
    const finding = await createPresentationConfigCheck({ projectRoot: root }).run();
    expect(finding.passed).toBe(false);
    expect(finding.evidence).toContain("bulletMaxColumns");
  });

  it("is a warning, not an error — nothing is broken, an intention was not honoured", () => {
    expect(createPresentationConfigCheck({ projectRoot: root }).severity).toBe("warning");
  });

  /**
   * A disabled blocking hook is a legitimate choice and an invisible one. "Why
   * did nothing catch that wall?" has to be answerable somewhere, and this is
   * the only surface that can answer it.
   */
  it("reports a DISABLED format gate explicitly rather than passing quietly", async () => {
    await writeConfig(JSON.stringify({ formatGate: { enabled: false } }));
    const finding = await createPresentationConfigCheck({ projectRoot: root }).run();
    expect(finding.passed).toBe(true);
    expect(finding.evidence).toContain("DISABLED");
  });

  it("reports advisory mode, so an observing gate is not mistaken for a blocking one", async () => {
    await writeConfig(JSON.stringify({ formatGate: { mode: "advisory" } }));
    const finding = await createPresentationConfigCheck({ projectRoot: root }).run();
    expect(finding.evidence).toContain("advisory");
  });
});
