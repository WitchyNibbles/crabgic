import { execFileSync } from "node:child_process";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ReviewFinding } from "@crabgic/contracts";
import { loadFindings, resolveFindingStorePath, saveFindings } from "./finding-store.js";

/**
 * The durable finding store — `docs/staged-review-pipeline.md` §8.0.
 *
 * WHY NOT THE JOURNAL. `JournalEntryType` is closed at thirteen members and its
 * own docblock forbids a unilateral fourteenth, citing phase 12 leaving an
 * identical tension open rather than adding one. `EvidenceRecord` does not fit
 * either: its `objectId` is a Git object id, not a payload pointer, and
 * `command`/`toolchainFingerprint` are required fields a review has no honest
 * value for.
 *
 * WHY XDG STATE IS PRINCIPLED HERE. The `EnvelopePolicy` — the artifact that
 * decides what runs WITHOUT review — already lives in XDG state rather than the
 * journal. Findings are strictly less privileged than that. The store sits
 * behind an interface, so moving it into the journal after a coordinated round
 * is a migration and not a redesign.
 *
 * It reuses `openOwnedFile`/`ensureOwnedDir`, which rounds 30-32 hardened
 * against exactly the attacks a predictable state path invites.
 */

let home: string;

function finding(overrides: Partial<ReviewFinding> = {}): ReviewFinding {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    claim: "a FIFO at the state path blocks forever",
    evidence: { reproduction: "mkfifo …", observed: "hangs", expected: "a diagnosis" },
    verification: "confirmed",
    classification: "advisory",
    disposition: "accepted-debt",
    dispositionEvidence: "narrow threat model",
    paths: ["packages/cli/src/doctor"],
    ...overrides,
  } as ReviewFinding;
}

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "eo-findings-"));
});
afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

const env = (): { HOME: string; XDG_STATE_HOME: string } => ({
  HOME: home,
  XDG_STATE_HOME: join(home, "state"),
});

describe("resolveFindingStorePath", () => {
  it("scopes the store per project, under the XDG state root", () => {
    const path = resolveFindingStorePath(env(), "abc123");
    expect(path.startsWith(join(home, "state"))).toBe(true);
    expect(path).toContain("abc123");
  });

  it("keeps two projects' findings apart", () => {
    expect(resolveFindingStorePath(env(), "aaa")).not.toBe(resolveFindingStorePath(env(), "bbb"));
  });
});

describe("saveFindings / loadFindings", () => {
  it("round-trips a finding", async () => {
    const path = resolveFindingStorePath(env(), "p");
    await saveFindings(path, [finding()], join(home, "state"));
    expect(await loadFindings(path)).toEqual([finding()]);
  });

  it("reads an absent store as empty rather than failing", async () => {
    // A first review on a fresh project is normal, not exceptional.
    expect(await loadFindings(resolveFindingStorePath(env(), "fresh"))).toEqual([]);
  });

  it("writes owner-only, since findings name unfixed weaknesses", async () => {
    // An advisory finding is a description of a defect nobody has fixed yet.
    // World-readable is the wrong default for a list of those.
    const path = resolveFindingStorePath(env(), "p");
    await saveFindings(path, [finding()], join(home, "state"));
    const { statSync } = await import("node:fs");
    expect(statSync(path).mode & 0o077).toBe(0);
    expect(statSync(dirname(path)).mode & 0o077).toBe(0);
  });

  it("refuses to write through a symlink planted at the store path", async () => {
    // Rounds 30-32 in one assertion. The store path is predictable by design,
    // so it gets the same treatment as the policy and the signing key.
    const path = resolveFindingStorePath(env(), "p");
    mkdirSync(dirname(path), { recursive: true });
    const victim = join(home, "victim");
    writeFileSync(victim, "PRECIOUS", { mode: 0o600 });
    symlinkSync(victim, path);

    await expect(saveFindings(path, [finding()], join(home, "state"))).rejects.toThrow();
    expect(readFileSync(victim, "utf8")).toBe("PRECIOUS");
  });

  it("does not block on a FIFO at the store path", async () => {
    const path = resolveFindingStorePath(env(), "p");
    mkdirSync(dirname(path), { recursive: true });
    execFileSync("mkfifo", [path]);

    const settled = await Promise.race([
      loadFindings(path).then(() => true),
      new Promise<boolean>((resolve) => {
        setTimeout(() => resolve(false), 5_000);
      }),
    ]);
    expect(settled).toBe(true);
  }, 20_000);

  it("treats a corrupt store as empty rather than crashing a review", async () => {
    // A findings file that will not parse must not take the whole pipeline
    // down. Losing the record is bad; refusing to review at all is worse, and
    // the next save rewrites it.
    const path = resolveFindingStorePath(env(), "p");
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, "{not json", { mode: 0o600 });
    expect(await loadFindings(path)).toEqual([]);
  });

  it("drops an entry that is not a valid finding, keeping the ones that are", async () => {
    // Partial corruption should not discard good records, and an invalid one
    // must not reach the closure computation, where a finding with no
    // disposition would silently hold a stage open forever.
    const path = resolveFindingStorePath(env(), "p");
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify([finding(), { garbage: true }]), { mode: 0o600 });
    expect(await loadFindings(path)).toHaveLength(1);
  });

  it("refuses a store file another account owns or can write", async () => {
    const path = resolveFindingStorePath(env(), "p");
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify([finding()]), { mode: 0o600 });
    chmodSync(path, 0o666);
    // Not our file to trust: read it as empty rather than acting on findings
    // another account could have authored.
    expect(await loadFindings(path)).toEqual([]);
  });
});
