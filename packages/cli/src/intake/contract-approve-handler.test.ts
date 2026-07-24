import { randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createJournalStore, type JournalStore } from "@eo/journal";
import {
  createAuthorizationEnvelopesRegistry,
  createChangeSetsRegistry,
  type Registry,
} from "@eo/supervisor";
import type { ChangeSet, AuthorizationEnvelope } from "@eo/contracts";
import { buildAuthorizationEnvelope, buildChangeSet } from "@eo/testkit";
import { ApprovalTokenMinter } from "../approval/token.js";
import { runContractApprove } from "./contract-approve-handler.js";

const REQ_A = "aaaaaaaa-1111-4111-8111-111111111111";
const REQ_B = "bbbbbbbb-1111-4111-8111-111111111111";
const secretKey = randomBytes(32);

let journalDir: string;
let store: JournalStore;

beforeEach(async () => {
  journalDir = await mkdtemp(join(tmpdir(), "eo-cli-contract-approve-handler-"));
  store = createJournalStore({ journalDir });
});

afterEach(async () => {
  await rm(journalDir, { recursive: true, force: true });
});

/** Seeds a ChangeSet whose `authorizationEnvelopeId` resolves, in `envelopes`, to a real envelope with `canonicalHash: digest` — the fixture shape `runContractApprove` now requires post-C1-repair (the expected digest is derived server-side from this envelope, never trusted from the caller). */
function seedChangeSetWithEnvelope(
  changeSets: Registry<ChangeSet>,
  envelopes: Registry<AuthorizationEnvelope>,
  state: ChangeSet["state"],
  digest: string,
): ChangeSet {
  // NOTE: distinct `id`s are generated explicitly (never the deterministic
  // fixture-context default) — two `buildAuthorizationEnvelope`/
  // `buildChangeSet` calls in the SAME test both start their own fixture
  // context at counter 0, so their DEFAULT ids collide; a real per-call
  // random id is required whenever a test seeds more than one distinct
  // ChangeSet/envelope (as the confused-deputy test below does).
  const envelope = buildAuthorizationEnvelope({ id: randomUUID(), canonicalHash: digest });
  envelopes.put(envelope);
  const seed = buildChangeSet({ id: randomUUID(), state, authorizationEnvelopeId: envelope.id });
  changeSets.put(seed);
  return seed;
}

describe("runContractApprove", () => {
  it("fails closed for an unknown changeSetId", async () => {
    const changeSets = createChangeSetsRegistry();
    const envelopes = createAuthorizationEnvelopesRegistry();

    const result = await runContractApprove(
      {
        changeSetId: "99999999-9999-4999-8999-999999999999",
        digest: "sha256:abc",
        token: "irrelevant",
      },
      { secretKey, journal: store, changeSets, envelopes, requirementIds: [], workUnits: [] },
    );

    expect(result.approved).toBe(false);
    if (result.approved) throw new Error("unreachable");
    expect(result.reason).toContain("unknown ChangeSet");
  });

  it("reports the token-was-consumed reason when the ChangeSet vanishes between the pre-check and the final transition (rare race)", async () => {
    const changeSets = createChangeSetsRegistry();
    const envelopes = createAuthorizationEnvelopesRegistry();
    const seed = seedChangeSetWithEnvelope(
      changeSets,
      envelopes,
      "awaiting_approval",
      "sha256:abc",
    );

    const minter = new ApprovalTokenMinter({ secretKey });
    const minted = await minter.mint("envelope_hash", "sha256:abc");

    // A fake registry that answers the first `.get()` (this handler's own
    // pre-checks) normally, then "loses" the record for every subsequent
    // call — simulating a concurrent deletion between the pre-check and
    // `transitionChangeSetToReady`'s own internal re-fetch.
    let getCallCount = 0;
    const vanishingChangeSets: Registry<ChangeSet> = {
      get: (id) => {
        getCallCount++;
        return getCallCount === 1 ? changeSets.get(id) : undefined;
      },
      list: () => changeSets.list(),
      put: (item) => changeSets.put(item),
      query: (predicate) => changeSets.query(predicate),
    };

    const result = await runContractApprove(
      { changeSetId: seed.id, digest: "sha256:abc", token: minted.token },
      {
        secretKey,
        journal: store,
        changeSets: vanishingChangeSets,
        envelopes,
        requirementIds: [],
        workUnits: [],
      },
    );

    expect(result.approved).toBe(false);
    if (result.approved) throw new Error("unreachable");
    expect(result.reason).toContain("token was consumed but the ready transition failed");
  });

  it("fails closed for a scripted call with no pre-minted token (model self-approval fixture)", async () => {
    const changeSets = createChangeSetsRegistry();
    const envelopes = createAuthorizationEnvelopesRegistry();
    const seed = seedChangeSetWithEnvelope(
      changeSets,
      envelopes,
      "awaiting_approval",
      "sha256:abc",
    );

    const result = await runContractApprove(
      { changeSetId: seed.id, digest: "sha256:abc", token: "totally-forged-token" },
      { secretKey, journal: store, changeSets, envelopes, requirementIds: [], workUnits: [] },
    );

    expect(result.approved).toBe(false);
    expect(changeSets.get(seed.id)?.state).toBe("awaiting_approval");
  });

  it("worker-context fixture: a legitimately-registered caller still cannot approve without the real token payload", async () => {
    const changeSets = createChangeSetsRegistry();
    const envelopes = createAuthorizationEnvelopesRegistry();
    const seed = seedChangeSetWithEnvelope(
      changeSets,
      envelopes,
      "awaiting_approval",
      "sha256:abc",
    );

    // A worker's own envelope may legitimately allow calling this tool at
    // all (Appendix B's worker profile), but that alone must never satisfy
    // the gate — only a real, human-minted token bound to this exact
    // digest can.
    const result = await runContractApprove(
      { changeSetId: seed.id, digest: "sha256:abc", token: "" },
      { secretKey, journal: store, changeSets, envelopes, requirementIds: [], workUnits: [] },
    );
    expect(result.approved).toBe(false);
  });

  it("CRITICAL C1: a valid token minted for a DIFFERENT ChangeSet's envelope cannot approve this ChangeSet (confused deputy)", async () => {
    const changeSets = createChangeSetsRegistry();
    const envelopes = createAuthorizationEnvelopesRegistry();

    // ChangeSet A: genuinely, humanly approved — envelope digest D-for-A.
    const seedA = seedChangeSetWithEnvelope(
      changeSets,
      envelopes,
      "awaiting_approval",
      "sha256:envelope-for-A",
    );
    const minter = new ApprovalTokenMinter({ secretKey });
    const tokenForA = await minter.mint("envelope_hash", "sha256:envelope-for-A");

    // ChangeSet B: a SEPARATE, higher-authority envelope, never approved by
    // any human.
    const seedB = seedChangeSetWithEnvelope(
      changeSets,
      envelopes,
      "awaiting_approval",
      "sha256:envelope-for-B",
    );

    // Attacker calls contract.approve naming B's changeSetId, but supplies
    // A's digest and A's legitimately-minted token, hoping the handler
    // trusts the caller-supplied digest instead of B's own actual envelope.
    const bypassAttempt = await runContractApprove(
      { changeSetId: seedB.id, digest: "sha256:envelope-for-A", token: tokenForA.token },
      { secretKey, journal: store, changeSets, envelopes, requirementIds: [], workUnits: [] },
    );

    expect(bypassAttempt.approved).toBe(false);
    expect(changeSets.get(seedB.id)?.state).toBe("awaiting_approval");
    // The legitimate token for A must still be usable to approve A itself.
    const legitimate = await runContractApprove(
      { changeSetId: seedA.id, digest: "sha256:envelope-for-A", token: tokenForA.token },
      { secretKey, journal: store, changeSets, envelopes, requirementIds: [], workUnits: [] },
    );
    expect(legitimate.approved).toBe(true);
    expect(changeSets.get(seedA.id)?.state).toBe("ready");
  });

  it("CRITICAL C1: a caller-supplied digest that disagrees with the ChangeSet's real envelope hash fails closed even with an otherwise-valid token for that stale digest", async () => {
    const changeSets = createChangeSetsRegistry();
    const envelopes = createAuthorizationEnvelopesRegistry();
    const seed = seedChangeSetWithEnvelope(
      changeSets,
      envelopes,
      "awaiting_approval",
      "sha256:current-real-hash",
    );
    const minter = new ApprovalTokenMinter({ secretKey });
    // A token minted against a stale/wrong digest that happens to match
    // what the caller claims — but not what the ChangeSet's OWN envelope
    // actually hashes to.
    const staleToken = await minter.mint("envelope_hash", "sha256:stale-claimed-hash");

    const result = await runContractApprove(
      { changeSetId: seed.id, digest: "sha256:stale-claimed-hash", token: staleToken.token },
      { secretKey, journal: store, changeSets, envelopes, requirementIds: [], workUnits: [] },
    );

    expect(result.approved).toBe(false);
    expect(changeSets.get(seed.id)?.state).toBe("awaiting_approval");
  });

  it("approves and transitions to ready on a valid token with full requirement coverage", async () => {
    const changeSets = createChangeSetsRegistry();
    const envelopes = createAuthorizationEnvelopesRegistry();
    const seed = seedChangeSetWithEnvelope(
      changeSets,
      envelopes,
      "awaiting_approval",
      "sha256:abc",
    );

    const minter = new ApprovalTokenMinter({ secretKey });
    const minted = await minter.mint("envelope_hash", "sha256:abc");

    const result = await runContractApprove(
      { changeSetId: seed.id, digest: "sha256:abc", token: minted.token },
      {
        secretKey,
        journal: store,
        changeSets,
        envelopes,
        requirementIds: [REQ_A, REQ_B],
        workUnits: [{ requirementIds: [REQ_A, REQ_B] }],
      },
    );

    expect(result.approved).toBe(true);
    expect(changeSets.get(seed.id)?.state).toBe("ready");
  });

  it("verifies but refuses ready when a requirement is unmapped — never flips state, and the token is NOT consumed (L5)", async () => {
    const changeSets = createChangeSetsRegistry();
    const envelopes = createAuthorizationEnvelopesRegistry();
    const seed = seedChangeSetWithEnvelope(
      changeSets,
      envelopes,
      "awaiting_approval",
      "sha256:abc",
    );

    const minter = new ApprovalTokenMinter({ secretKey });
    const minted = await minter.mint("envelope_hash", "sha256:abc");
    const deps = {
      secretKey,
      journal: store,
      changeSets,
      envelopes,
      requirementIds: [REQ_A, REQ_B],
      workUnits: [{ requirementIds: [REQ_A] }],
    };

    const result = await runContractApprove(
      { changeSetId: seed.id, digest: "sha256:abc", token: minted.token },
      deps,
    );
    expect(result.approved).toBe(false);
    expect(changeSets.get(seed.id)?.state).toBe("awaiting_approval");

    // L5: since coverage was checked BEFORE the token was consumed, the
    // very same token remains valid once the DAG is fixed and full
    // coverage is supplied.
    const retry = await runContractApprove(
      { changeSetId: seed.id, digest: "sha256:abc", token: minted.token },
      { ...deps, workUnits: [{ requirementIds: [REQ_A, REQ_B] }] },
    );
    expect(retry.approved).toBe(true);
    expect(changeSets.get(seed.id)?.state).toBe("ready");
  });

  it("verifies successfully but refuses when the ChangeSet is in an illegal source state for ready — never throws, returns approved:false, and does NOT consume the token (L5)", async () => {
    const changeSets = createChangeSetsRegistry();
    const envelopes = createAuthorizationEnvelopesRegistry();
    const seed = seedChangeSetWithEnvelope(changeSets, envelopes, "draft", "sha256:abc"); // draft has no direct -> ready edge

    const minter = new ApprovalTokenMinter({ secretKey });
    const minted = await minter.mint("envelope_hash", "sha256:abc");

    const result = await runContractApprove(
      { changeSetId: seed.id, digest: "sha256:abc", token: minted.token },
      { secretKey, journal: store, changeSets, envelopes, requirementIds: [], workUnits: [] },
    );

    expect(result.approved).toBe(false);
    expect(changeSets.get(seed.id)?.state).toBe("draft");

    // L5: the token was never consumed (the illegal-state pre-check ran
    // before verification), so a fresh attempt against a legally-reachable
    // state still works with the SAME token.
    changeSets.put({ ...seed, state: "awaiting_approval" });
    const retry = await runContractApprove(
      { changeSetId: seed.id, digest: "sha256:abc", token: minted.token },
      { secretKey, journal: store, changeSets, envelopes, requirementIds: [], workUnits: [] },
    );
    expect(retry.approved).toBe(true);
  });

  it("honors an injected clock — an expired token fails closed", async () => {
    const changeSets = createChangeSetsRegistry();
    const envelopes = createAuthorizationEnvelopesRegistry();
    const seed = seedChangeSetWithEnvelope(
      changeSets,
      envelopes,
      "awaiting_approval",
      "sha256:abc",
    );

    let now = 1_000_000;
    const clock = () => now;
    const minter = new ApprovalTokenMinter({ secretKey, clock, ttlMs: 1000 });
    const minted = await minter.mint("envelope_hash", "sha256:abc");
    now += 5000;

    const result = await runContractApprove(
      { changeSetId: seed.id, digest: "sha256:abc", token: minted.token },
      {
        secretKey,
        journal: store,
        changeSets,
        envelopes,
        requirementIds: [],
        workUnits: [],
        clock,
      },
    );
    expect(result.approved).toBe(false);
  });

  it("replaying the same token a second time fails closed (single-use)", async () => {
    const changeSets = createChangeSetsRegistry();
    const envelopes = createAuthorizationEnvelopesRegistry();
    const seed = seedChangeSetWithEnvelope(
      changeSets,
      envelopes,
      "awaiting_approval",
      "sha256:abc",
    );

    const minter = new ApprovalTokenMinter({ secretKey });
    const minted = await minter.mint("envelope_hash", "sha256:abc");
    const deps = {
      secretKey,
      journal: store,
      changeSets,
      envelopes,
      requirementIds: [],
      workUnits: [],
    };

    await runContractApprove(
      { changeSetId: seed.id, digest: "sha256:abc", token: minted.token },
      deps,
    );
    const replay = await runContractApprove(
      { changeSetId: seed.id, digest: "sha256:abc", token: minted.token },
      deps,
    );
    expect(replay.approved).toBe(false);
  });
});
