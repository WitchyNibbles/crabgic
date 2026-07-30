import { closeSync, constants, ftruncateSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { z } from "zod";
import {
  CRABGIC_DIR_NAME,
  ensureOwnedDir,
  openOwnedFile,
  resolveXdgStateHome,
  type XdgEnv,
} from "@crabgic/journal";
import { CLASSIFICATION_RUBRIC_VERSION, type CalibrationSample } from "./calibration.js";

/**
 * The owner's judgements about the classifier — the corpus `scoreCalibration`
 * had nothing to read.
 *
 * WHY THIS IS NOT OPTIONAL. The `blocking`/`advisory` split decides what holds
 * a stage open, and ledger Gap 20 discloses it as asserted rather than measured.
 * Without a place to record "this one you called advisory should have blocked",
 * the split is not merely uncalibrated but **uncalibratable** — and a kappa of
 * zero that nobody can ever move is a number pretending to be a measurement.
 *
 * Same store discipline as the findings: XDG state, owner-only, and every open
 * hardened by roast rounds 30-32.
 */

const CalibrationSampleSchema = z.object({
  findingId: z.string().min(1),
  owner: z.enum(["blocking", "advisory"]),
  classifier: z.enum(["blocking", "advisory"]),
  /**
   * Optional on READ, always written. The corpus predating the field was gathered
   * under rubric 1 by definition — there was only one — so `scoreCalibration`
   * reads an absent version as 1 rather than dropping real owner judgements.
   */
  rubricVersion: z.number().int().positive().optional(),
});

export const CALIBRATION_FILE_NAME = "review-calibration.json";

export function resolveCalibrationStorePath(env: XdgEnv, projectHash: string): string {
  return join(resolveXdgStateHome(env), CRABGIC_DIR_NAME, projectHash, CALIBRATION_FILE_NAME);
}

export async function loadCalibrationSamples(path: string): Promise<readonly CalibrationSample[]> {
  await Promise.resolve();
  const opened = openOwnedFile(path, constants.O_RDONLY, { requirePrivateMode: true });
  if (opened.refused !== undefined) return [];
  const fd = opened.fd as number;
  let raw: string;
  try {
    raw = readFileSync(fd, "utf8");
  } catch {
    return [];
  } finally {
    closeSync(fd);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const samples: CalibrationSample[] = [];
  for (const entry of parsed) {
    const result = CalibrationSampleSchema.safeParse(entry);
    if (!result.success) continue;
    // `rubricVersion` is omitted rather than set to `undefined`: the repository
    // builds with `exactOptionalPropertyTypes`, where "absent" and "present and
    // undefined" are different types, and only the first is what an unversioned
    // legacy sample means.
    const { rubricVersion, ...rest } = result.data;
    samples.push(rubricVersion === undefined ? rest : { ...rest, rubricVersion });
  }
  return samples;
}

/**
 * Record one judgement.
 *
 * Keyed by finding AND rubric. Revising a call under the same rubric SUPERSEDES
 * it rather than adding a second sample — a corpus that counts one revised
 * judgement twice is measuring the revision rather than the classifier. A
 * judgement made under a SUPERSEDED rubric is a different measurement and is
 * kept: `scoreCalibration` excludes it from the score, so nothing is gained by
 * destroying it, and keeping it leaves a record of what the corpus was before a
 * rubric rewrite reset it.
 *
 * The current rubric is stamped on any sample that arrives without one, so an
 * unversioned sample can never enter the store and later be misread as belonging
 * to rubric 1.
 *
 * The sampling source is stamped for the same reason and defaults the same
 * conservative way (2026-07-30). Only the uniformly-drawn slice scores the gate,
 * so a sample that arrives without provenance is recorded as `disposition` — the
 * path it almost certainly came from — rather than being allowed to look random
 * later. The default is the fail-closed one: over-admitting a biased sample to
 * the gate is the failure that matters, and under-admitting one costs only a
 * label.
 */
export async function recordCalibrationSample(
  path: string,
  sample: CalibrationSample,
  stateHome: string,
): Promise<void> {
  const stamped: CalibrationSample = {
    ...sample,
    rubricVersion: sample.rubricVersion ?? CLASSIFICATION_RUBRIC_VERSION,
    samplingSource: sample.samplingSource ?? "disposition",
  };
  const key = (entry: CalibrationSample): string =>
    `${entry.findingId}@${String(entry.rubricVersion ?? 1)}`;
  const existing = await loadCalibrationSamples(path);
  const byFinding = new Map(existing.map((entry) => [key(entry), entry]));
  byFinding.set(key(stamped), stamped);

  const dirRefusal = ensureOwnedDir(dirname(path), stateHome);
  if (dirRefusal !== undefined) {
    throw new Error(`refusing to write the calibration corpus: its directory is ${dirRefusal}`);
  }
  const opened = openOwnedFile(path, constants.O_WRONLY | constants.O_CREAT);
  if (opened.refused !== undefined) {
    throw new Error(`refusing to write the calibration corpus to ${path}: it is ${opened.refused}`);
  }
  const fd = opened.fd as number;
  try {
    ftruncateSync(fd, 0);
    writeFileSync(fd, `${JSON.stringify([...byFinding.values()], null, 2)}\n`, "utf8");
  } finally {
    closeSync(fd);
  }
}
