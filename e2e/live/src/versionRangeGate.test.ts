import { describe, expect, it } from "vitest";
import { ACCEPTED_ENGINE_VERSION_RANGE, EngineVersionRejectedError } from "@eo/engine-claude";
import {
  checkPinnedRange,
  createClaudeVersionProbe,
  parseClaudeVersionOutput,
  realClaudeVersionProbe,
  type VersionProbeResult,
} from "./versionRangeGate.js";

function fakeProbe(result: VersionProbeResult): () => Promise<VersionProbeResult> {
  return async () => result;
}

describe("parseClaudeVersionOutput", () => {
  it("extracts the version triple from claude --version's real stdout shape", () => {
    expect(parseClaudeVersionOutput("2.1.218 (Claude Code)")).toBe("2.1.218");
  });

  it("returns undefined when no version triple is present", () => {
    expect(parseClaudeVersionOutput("not a version string")).toBeUndefined();
  });
});

describe("checkPinnedRange", () => {
  it("reports in-range for the exact min boundary", async () => {
    const verdict = await checkPinnedRange(
      fakeProbe({
        ok: true,
        rawOutput: ACCEPTED_ENGINE_VERSION_RANGE.min,
        version: ACCEPTED_ENGINE_VERSION_RANGE.min,
      }),
    );
    expect(verdict.status).toBe("in-range");
  });

  it("reports in-range for the exact max boundary", async () => {
    const verdict = await checkPinnedRange(
      fakeProbe({
        ok: true,
        rawOutput: ACCEPTED_ENGINE_VERSION_RANGE.max,
        version: ACCEPTED_ENGINE_VERSION_RANGE.max,
      }),
    );
    expect(verdict.status).toBe("in-range");
  });

  it("reports out-of-range for a version below the min", async () => {
    const verdict = await checkPinnedRange(
      fakeProbe({ ok: true, rawOutput: "2.1.206", version: "2.1.206" }),
    );
    expect(verdict.status).toBe("out-of-range");
    if (verdict.status === "out-of-range") {
      expect(verdict.range).toEqual(ACCEPTED_ENGINE_VERSION_RANGE);
    }
  });

  it("reports out-of-range for a version above the max (a future engine that has drifted past the re-baselined 2.1.220 ceiling)", async () => {
    const verdict = await checkPinnedRange(
      fakeProbe({ ok: true, rawOutput: "2.1.221", version: "2.1.221" }),
    );
    expect(verdict.status).toBe("out-of-range");
  });

  it("reports malformed for a non-numeric-triple version string", async () => {
    const verdict = await checkPinnedRange(
      fakeProbe({ ok: true, rawOutput: "banana", version: "banana" }),
    );
    expect(verdict.status).toBe("malformed");
  });

  it("reports probe-failed (never throws) when the probe itself fails", async () => {
    const verdict = await checkPinnedRange(
      fakeProbe({ ok: false, reason: "claude: command not found" }),
    );
    expect(verdict).toEqual({ status: "probe-failed", reason: "claude: command not found" });
  });

  it("never throws for any input shape — every branch returns a typed verdict", async () => {
    await expect(
      checkPinnedRange(fakeProbe({ ok: true, rawOutput: "0.0.0", version: "0.0.0" })),
    ).resolves.toBeDefined();
  });

  it("re-throws any non-EngineVersionRejectedError failure from the version-accept check rather than swallowing it", async () => {
    const boom = new Error("boom — some unrelated internal failure");
    await expect(
      checkPinnedRange(fakeProbe({ ok: true, rawOutput: "2.1.210", version: "2.1.210" }), () => {
        throw boom;
      }),
    ).rejects.toBe(boom);
  });

  it("accepts an injected assertVersionAccepted that throws EngineVersionRejectedError directly (covers both reason branches via injection too)", async () => {
    const verdict = await checkPinnedRange(
      fakeProbe({ ok: true, rawOutput: "9.9.9", version: "9.9.9" }),
      () => {
        throw new EngineVersionRejectedError(
          "9.9.9",
          ACCEPTED_ENGINE_VERSION_RANGE,
          "out-of-range",
        );
      },
    );
    expect(verdict.status).toBe("out-of-range");
  });
});

describe("createClaudeVersionProbe — genuine integration, real subprocess error branches (no mocks)", () => {
  it("reports probe-failed when the binary does not exist on PATH", async () => {
    const probe = createClaudeVersionProbe("eo-definitely-not-a-real-binary-xyz");
    const result = await probe();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain("failed to run");
    }
  });

  it("reports probe-failed (unparsable) when the real subprocess's stdout has no version triple", async () => {
    const probe = createClaudeVersionProbe("node", ["-e", "console.log('not a version')"]);
    const result = await probe();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain("could not parse");
    }
  });

  it("reports ok:true with the parsed version for a real subprocess whose stdout does contain one", async () => {
    const probe = createClaudeVersionProbe("node", ["-e", "console.log('9.9.9 (fixture)')"]);
    const result = await probe();
    expect(result).toEqual({ ok: true, rawOutput: "9.9.9 (fixture)", version: "9.9.9" });
  });
});

describe("realClaudeVersionProbe (genuine integration check — no auth/network needed)", () => {
  it("shells out to the real `claude --version` on this host and produces a well-formed verdict either way", async () => {
    const verdict = await checkPinnedRange(realClaudeVersionProbe);
    // Whatever `claude` happens to be installed on this host, the probe
    // itself must succeed (the binary is required to exist for this repo's
    // own doctor/sandbox tooling) and the gate must reach exactly one of
    // the two version-parsed outcomes — never "probe-failed" or
    // "malformed" for a real `claude` binary's real `--version` output.
    expect(["in-range", "out-of-range"]).toContain(verdict.status);
  });
});
