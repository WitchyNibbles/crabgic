import { mkdirSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { StoredAttestation } from "@crabgic/contracts";
import {
  loadAttestations,
  resolveAttestationStorePath,
  saveAttestationsForStage,
} from "./attestation-store.js";

/**
 * The durable record of who asserted which judged criterion.
 *
 * Without it an attestation lives for one tool call: round 2 re-argues what round 1
 * established, and the record of whose judgement closed a stage disappears with the
 * response that carried it. An attributed claim nobody can look up later is barely
 * more falsifiable than the anonymous boolean it replaced.
 */

let home: string;

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "eo-attestations-"));
});

afterEach(async () => {
  await rm(home, { recursive: true, force: true });
});

const env = (): { HOME: string; XDG_STATE_HOME: string } => ({
  HOME: home,
  XDG_STATE_HOME: join(home, "state"),
});

function attestation(overrides: Partial<StoredAttestation> = {}): StoredAttestation {
  return {
    stage: "implement",
    criterion: "implement-task-done-criteria-met",
    asserter: "eo-reviewer:correctness",
    rationale: "each done-criterion is demonstrated by a named test",
    artifactAnchor: "packages/cli/src/review",
    assertedAt: "2026-07-29T00:00:00.000Z",
    round: 1,
    ...overrides,
  };
}

describe("attestation store", () => {
  it("round-trips an attestation", async () => {
    const path = resolveAttestationStorePath(env(), "p");
    await saveAttestationsForStage(path, "implement", [attestation()], join(home, "state"));
    const loaded = await loadAttestations(path);
    expect(loaded).toEqual([attestation()]);
  });

  it("reads an absent record as empty", async () => {
    expect(await loadAttestations(resolveAttestationStorePath(env(), "fresh"))).toEqual([]);
  });

  it("drops a malformed entry rather than counting a criterion met with nothing behind it", async () => {
    const path = resolveAttestationStorePath(env(), "p");
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify([attestation(), { criterion: "x" }]), { mode: 0o600 });
    expect(await loadAttestations(path)).toHaveLength(1);
  });

  /**
   * A submission for one stage knows what it judged about that stage's artifact
   * and nothing about what another stage established. Writing the whole file from
   * one stage's view would silently drop the others'.
   */
  it("replaces only the submitted stage's record and leaves other stages alone", async () => {
    const path = resolveAttestationStorePath(env(), "p");
    const state = join(home, "state");
    await saveAttestationsForStage(
      path,
      "design",
      [attestation({ stage: "design", criterion: "design-risks-have-mitigations" })],
      state,
    );
    await saveAttestationsForStage(path, "implement", [attestation()], state);

    const loaded = await loadAttestations(path);
    expect(loaded.map((entry) => entry.stage).sort()).toEqual(["design", "implement"]);

    // Re-saving implement with nothing clears implement, and only implement.
    await saveAttestationsForStage(path, "implement", [], state);
    const after = await loadAttestations(path);
    expect(after.map((entry) => entry.stage)).toEqual(["design"]);
  });

  it("ignores an attestation for a stage other than the one being saved", async () => {
    // The stage argument is the authority, so a mismatched payload cannot write
    // into a stage the caller did not claim to be submitting for.
    const path = resolveAttestationStorePath(env(), "p");
    await saveAttestationsForStage(
      path,
      "implement",
      [attestation(), attestation({ stage: "plan" })],
      join(home, "state"),
    );
    expect((await loadAttestations(path)).map((entry) => entry.stage)).toEqual(["implement"]);
  });
});
