import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { OwnerDesignVerdict } from "@crabgic/contracts";
import {
  loadDesignVerdicts,
  recordDesignVerdict,
  resolveDesignVerdictStorePath,
  verdictInForce,
} from "./design-verdict-store.js";

/**
 * The owner's design verdicts — roadmap/25 work item 5, the write path the
 * design gate had been enforcing against an empty store.
 *
 * The gate itself is tested in `@crabgic/contracts` and in the review handler.
 * What these tests cover is the durability half: that a verdict survives, that
 * the latest one wins, and that a predictable state path gets the same hardening
 * the `EnvelopePolicy` and the signing key got.
 */

let home: string;
let storePath: string;

const CHANGE_SET = "22222222-2222-4222-8222-222222222222";

function verdict(overrides: Partial<OwnerDesignVerdict> = {}): OwnerDesignVerdict {
  return {
    schemaVersion: 1,
    changeSetId: CHANGE_SET,
    designRevision: "sha256:abc123",
    verdict: "approved",
    recordedAt: "2026-08-15T00:00:00.000Z",
    ...overrides,
  } as OwnerDesignVerdict;
}

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "crabgic-design-verdicts-"));
  storePath = resolveDesignVerdictStorePath(
    { HOME: home, XDG_STATE_HOME: join(home, "state") },
    "projecthash",
  );
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

describe("recordDesignVerdict / loadDesignVerdicts", () => {
  it("round-trips a verdict", async () => {
    await recordDesignVerdict(storePath, verdict(), join(home, "state"));
    const loaded = await loadDesignVerdicts(storePath);
    expect(loaded).toHaveLength(1);
    expect(loaded[0]?.designRevision).toBe("sha256:abc123");
  });

  it("APPENDS rather than replacing, so the record of what the owner said survives", async () => {
    // A rejection followed by an approval is steps 6-7's loop working. Flattening
    // it would erase the evidence that the design changed because the owner
    // asked it to.
    await recordDesignVerdict(
      storePath,
      verdict({ verdict: "rejected", reason: "the queue is the wrong shape" }),
      join(home, "state"),
    );
    await recordDesignVerdict(
      storePath,
      verdict({ designRevision: "sha256:v2" }),
      join(home, "state"),
    );
    expect(await loadDesignVerdicts(storePath)).toHaveLength(2);
  });

  it("refuses to record an invalid verdict rather than writing it", async () => {
    // A rejection with no reason is refused by the schema. Writing it anyway
    // would put a document in the store that `loadDesignVerdicts` then silently
    // drops -- an owner believing they answered, and a gate that never saw it.
    await expect(
      recordDesignVerdict(
        storePath,
        verdict({ verdict: "rejected" }) as OwnerDesignVerdict,
        join(home, "state"),
      ),
    ).rejects.toThrow(/invalid design verdict/i);
    expect(await loadDesignVerdicts(storePath)).toEqual([]);
  });

  it("reads as empty when the store does not exist", async () => {
    // The default state of every project, and the state in which the gate must
    // refuse. Not an error.
    expect(await loadDesignVerdicts(storePath)).toEqual([]);
  });

  it("reads as empty when the file is not JSON, rather than throwing", async () => {
    // Same fail-closed direction: an unreadable store means the gate refuses,
    // which is the right answer when nobody can tell what the owner approved.
    mkdirSync(dirname(storePath), { recursive: true, mode: 0o700 });
    writeFileSync(storePath, "{ not json", { mode: 0o600 });
    expect(await loadDesignVerdicts(storePath)).toEqual([]);
  });

  it("drops an invalid entry individually instead of discarding the file", async () => {
    mkdirSync(dirname(storePath), { recursive: true, mode: 0o700 });
    writeFileSync(storePath, JSON.stringify([{ nonsense: true }, verdict()]), { mode: 0o600 });
    const loaded = await loadDesignVerdicts(storePath);
    expect(loaded).toHaveLength(1);
    expect(loaded[0]?.changeSetId).toBe(CHANGE_SET);
  });

  it("refuses a symlinked store path", async () => {
    // The hardening rounds 30-32 earned, applied to a predictable state path.
    // A symlink here would let anyone who can create one choose the file the
    // owner's approval is written into.
    mkdirSync(dirname(storePath), { recursive: true, mode: 0o700 });
    const elsewhere = join(home, "elsewhere.json");
    writeFileSync(elsewhere, "[]", { mode: 0o600 });
    symlinkSync(elsewhere, storePath);
    await expect(recordDesignVerdict(storePath, verdict(), join(home, "state"))).rejects.toThrow();
  });
});

describe("verdictInForce", () => {
  it("returns the LATEST verdict for the change set", async () => {
    // Latest-wins is what makes a re-approval after a design edit meaningful --
    // the same rule phase 24's criteria seal uses, for the same reason: an
    // earlier approval must not satisfy a gate the owner has since re-answered.
    await recordDesignVerdict(
      storePath,
      verdict({ verdict: "rejected", reason: "no" }),
      join(home, "state"),
    );
    await recordDesignVerdict(
      storePath,
      verdict({ designRevision: "sha256:v2" }),
      join(home, "state"),
    );
    const inForce = verdictInForce(await loadDesignVerdicts(storePath), CHANGE_SET);
    expect(inForce?.verdict).toBe("approved");
    expect(inForce?.designRevision).toBe("sha256:v2");
  });

  it("ignores verdicts for other change sets", async () => {
    // One owner, many change sets. An approval bleeding across them would open
    // a gate nobody answered.
    await recordDesignVerdict(
      storePath,
      verdict({ changeSetId: "33333333-3333-4333-8333-333333333333" }),
      join(home, "state"),
    );
    expect(verdictInForce(await loadDesignVerdicts(storePath), CHANGE_SET)).toBeUndefined();
  });

  it("returns undefined when nothing is on record", () => {
    expect(verdictInForce([], CHANGE_SET)).toBeUndefined();
  });
});
