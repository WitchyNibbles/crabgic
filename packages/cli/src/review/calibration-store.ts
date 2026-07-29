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
import type { CalibrationSample } from "./calibration.js";

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
    if (result.success) samples.push(result.data);
  }
  return samples;
}

/**
 * Record one judgement.
 *
 * Keyed by finding, so revising a call SUPERSEDES it rather than adding a second
 * sample. A corpus that counts one revised judgement twice is measuring the
 * revision rather than the classifier.
 */
export async function recordCalibrationSample(
  path: string,
  sample: CalibrationSample,
  stateHome: string,
): Promise<void> {
  const existing = await loadCalibrationSamples(path);
  const byFinding = new Map(existing.map((entry) => [entry.findingId, entry]));
  byFinding.set(sample.findingId, sample);

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
