import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  loadCalibrationSamples,
  recordCalibrationSample,
  resolveCalibrationStorePath,
} from "./calibration-store.js";

/**
 * Where the owner's judgements go.
 *
 * The calibration harness could score a corpus and there was no way to build
 * one — no surface for the owner to say "this finding you called advisory
 * should have blocked". A classifier that cannot be corrected is not
 * uncalibrated, it is uncalibratable, and shipping one while reporting a kappa
 * of zero would be reporting a number nobody could ever move.
 */

let home: string;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "eo-calib-"));
});
afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

const env = (): { HOME: string; XDG_STATE_HOME: string } => ({
  HOME: home,
  XDG_STATE_HOME: join(home, "state"),
});

describe("recordCalibrationSample", () => {
  it("round-trips the owner's judgement", async () => {
    const path = resolveCalibrationStorePath(env(), "p");
    await recordCalibrationSample(
      path,
      { findingId: "f1", owner: "blocking", classifier: "advisory" },
      join(home, "state"),
    );
    const samples = await loadCalibrationSamples(path);
    expect(samples).toHaveLength(1);
    expect(samples[0]?.owner).toBe("blocking");
  });

  it("accumulates rather than replacing, since a corpus is built over time", async () => {
    const path = resolveCalibrationStorePath(env(), "p");
    const state = join(home, "state");
    await recordCalibrationSample(
      path,
      { findingId: "f1", owner: "blocking", classifier: "blocking" },
      state,
    );
    await recordCalibrationSample(
      path,
      { findingId: "f2", owner: "advisory", classifier: "blocking" },
      state,
    );
    expect(await loadCalibrationSamples(path)).toHaveLength(2);
  });

  it("supersedes an earlier judgement on the same finding rather than double-counting it", async () => {
    // The owner changing their mind must not weight that finding twice; a
    // corpus that counts one revised call as two samples is measuring the
    // revision, not the classifier.
    const path = resolveCalibrationStorePath(env(), "p");
    const state = join(home, "state");
    await recordCalibrationSample(
      path,
      { findingId: "f1", owner: "blocking", classifier: "advisory" },
      state,
    );
    await recordCalibrationSample(
      path,
      { findingId: "f1", owner: "advisory", classifier: "advisory" },
      state,
    );
    const samples = await loadCalibrationSamples(path);
    expect(samples).toHaveLength(1);
    expect(samples[0]?.owner).toBe("advisory");
  });

  it("reads an absent corpus as empty", async () => {
    expect(await loadCalibrationSamples(resolveCalibrationStorePath(env(), "fresh"))).toEqual([]);
  });

  it("drops a malformed entry rather than scoring on it", async () => {
    const path = resolveCalibrationStorePath(env(), "p");
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(
      path,
      JSON.stringify([{ findingId: "f1", owner: "blocking", classifier: "advisory" }, { junk: 1 }]),
      { mode: 0o600 },
    );
    expect(await loadCalibrationSamples(path)).toHaveLength(1);
  });
});
