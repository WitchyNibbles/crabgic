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

  it("applies a partial override, leaving the unnamed gate switch at its default", async () => {
    await writeConfig(JSON.stringify({ formatGate: { mode: "advisory" } }));
    const { policy, source } = loadPresentationPolicy(root);
    expect(source).toBe("file");
    expect(policy.formatGate.mode).toBe("advisory");
    expect(policy.formatGate.enabled).toBe(DEFAULT_PRESENTATION_POLICY.formatGate.enabled);
  });

  /**
   * ⚠️ `limits` USED TO BE ACCEPTED AND REACH NOTHING.
   *
   * It was merged into the returned policy, and no renderer read that policy:
   * `renderHeading`, `renderHumanReport` and `renderMarkdownReport` each
   * destructure the module-scope `DEFAULT_PRESENTATION_POLICY.limits`, and not
   * one of `renderHumanReport`, `renderMarkdownReport`, `renderItemListReport`
   * or `renderResultLine` takes a policy. So a project that narrowed
   * `bulletMaxColumns` got `source: "file"`, `crabgic doctor` reporting the
   * file "applied", and byte-identical output — exactly the "silently
   * discarding an edit someone made deliberately" this loader's own header
   * calls the worse failure.
   *
   * Rejecting the member by name is what turns that silent no-op into the
   * doctor warning `problems` exists to produce. Wiring it instead would mean
   * threading a policy through some thirty call sites across `packages/cli`,
   * `packages/detect` and here; both changelogs advertise this file as the
   * format gate's two switches and nothing else.
   */
  it("rejects a limits override rather than accepting one that reaches no renderer", async () => {
    await writeConfig(JSON.stringify({ limits: { bulletMaxColumns: 60 } }));
    const { policy, source, problems } = loadPresentationPolicy(root);
    expect(source).toBe("invalid");
    expect(policy).toEqual(DEFAULT_PRESENTATION_POLICY);
    expect(problems.join(" ")).toContain("limits");
  });

  it("still applies the gate switches in a file that names nothing else", async () => {
    await writeConfig(JSON.stringify({ formatGate: { enabled: false, mode: "advisory" } }));
    const { source, policy } = loadPresentationPolicy(root);
    expect(source).toBe("file");
    expect(policy.formatGate).toEqual({ enabled: false, mode: "advisory" });
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
    [
      "a limits override, which reaches no renderer",
      JSON.stringify({ limits: { bulletMaxColumns: 60 } }),
    ],
    ["an unknown member", JSON.stringify({ madeUpMember: 3 })],
    ["an unknown gate switch", JSON.stringify({ formatGate: { madeUpSwitch: true } })],
    ["an out-of-vocabulary gate mode", JSON.stringify({ formatGate: { mode: "shouty" } })],
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
