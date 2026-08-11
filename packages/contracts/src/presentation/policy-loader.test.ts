import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_PRESENTATION_POLICY } from "./presentation-policy.js";
import { PRESENTATION_CONFIG_RELPATH, loadPresentationPolicy } from "./policy-loader.js";

/**
 * `PresentationPolicySchema` existed from the start and NOTHING EVER LOADED IT.
 * It was a policy in name with no configuration path — which meant the blocking
 * `Stop` format gate shipped into other people's repositories with no way to
 * tune it and no way to turn it off. That is the gap this closes; see
 * `docs/design/format-gate-production.md` §L3.
 *
 * Every failure mode resolves to the DEFAULT rather than throwing. A malformed
 * config file must degrade the presentation, never break a command — the same
 * rule `resolvePresentationProfile` already applies to a typo in
 * `CRABGIC_PRESENTATION`.
 */
let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "eo-presentation-config-"));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function writeConfig(body: string): Promise<void> {
  await mkdir(join(root, ".crabgic"), { recursive: true });
  await writeFile(join(root, PRESENTATION_CONFIG_RELPATH), body, "utf8");
}

describe("loadPresentationPolicy", () => {
  it("returns the default when no config exists", () => {
    expect(loadPresentationPolicy(root).policy).toEqual(DEFAULT_PRESENTATION_POLICY);
    expect(loadPresentationPolicy(root).source).toBe("default");
  });

  it("applies a partial override, leaving every unnamed limit at its default", async () => {
    await writeConfig(JSON.stringify({ limits: { bulletMaxColumns: 60 } }));
    const { policy, source } = loadPresentationPolicy(root);
    expect(source).toBe("file");
    expect(policy.limits.bulletMaxColumns).toBe(60);
    expect(policy.limits.bulletMaxWords).toBe(DEFAULT_PRESENTATION_POLICY.limits.bulletMaxWords);
  });

  it("carries the format-gate switch, defaulting to enabled", async () => {
    expect(loadPresentationPolicy(root).policy.formatGate.enabled).toBe(true);
    await writeConfig(JSON.stringify({ formatGate: { enabled: false } }));
    expect(loadPresentationPolicy(root).policy.formatGate.enabled).toBe(false);
  });

  it("carries an advisory mode, so the gate can observe before it blocks", async () => {
    await writeConfig(JSON.stringify({ formatGate: { mode: "advisory" } }));
    expect(loadPresentationPolicy(root).policy.formatGate.mode).toBe("advisory");
  });

  /**
   * Every one of these is a real way an operator's config can be wrong, and not
   * one of them may break a command. `problems` is returned so `crabgic doctor`
   * can SAY the config was ignored — silence would be the actual defect, since
   * an operator who edited a file and saw no effect has no way to find out why.
   */
  it.each([
    ["malformed JSON", "{ not json"],
    ["a non-object", '"a string"'],
    ["a negative limit", JSON.stringify({ limits: { bulletMaxColumns: -1 } })],
    ["a non-integer limit", JSON.stringify({ limits: { bulletMaxColumns: 1.5 } })],
    ["an unknown member", JSON.stringify({ limits: { madeUpLimit: 3 } })],
    ["a wrong-typed switch", JSON.stringify({ formatGate: { enabled: "yes" } })],
  ])("falls back to the default on %s, and reports why", async (_label, body) => {
    await writeConfig(body);
    const { policy, source, problems } = loadPresentationPolicy(root);
    expect(policy).toEqual(DEFAULT_PRESENTATION_POLICY);
    expect(source).toBe("invalid");
    expect(problems.length).toBeGreaterThan(0);
  });

  it("never throws, whatever the path", () => {
    expect(() => loadPresentationPolicy("/nonexistent/definitely/not/here")).not.toThrow();
    expect(loadPresentationPolicy("/nonexistent/definitely/not/here").source).toBe("default");
  });
});
