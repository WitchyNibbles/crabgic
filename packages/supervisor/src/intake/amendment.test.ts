import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createJournalStore, type JournalStore } from "@eo/journal";
import { buildChangeSet } from "@eo/testkit";
import { createChangeSetsRegistry } from "../registries/change-sets-registry.js";
import { createAuthorizationEnvelopesRegistry } from "../registries/authorization-envelopes-registry.js";
import {
  amendEnvelope,
  ChangeSetAlreadyTerminalError,
  ChangeSetNotFoundForAmendmentError,
  isMaterialEnvelopeChange,
} from "./amendment.js";
import { hashEnvelopeContent, type AuthorizationEnvelopeContent } from "./envelope-builder.js";

let journalDir: string;
let store: JournalStore;

beforeEach(async () => {
  journalDir = await mkdtemp(join(tmpdir(), "eo-supervisor-amendment-"));
  store = createJournalStore({ journalDir });
});

afterEach(async () => {
  await rm(journalDir, { recursive: true, force: true });
});

function content(
  overrides: Partial<AuthorizationEnvelopeContent> = {},
): AuthorizationEnvelopeContent {
  return {
    ownedPaths: ["packages/example/src/"],
    commands: [],
    networkDestinations: [],
    credentialReferences: [],
    dependencies: [],
    remoteResourceAuthorizations: [],
    temporaryServices: [],
    prohibitedActions: [],
    ...overrides,
  };
}

describe("amendEnvelope", () => {
  it("produces a new, distinctly-hashed envelope and repoints the ChangeSet's authorizationEnvelopeId", async () => {
    const changeSets = createChangeSetsRegistry();
    const envelopes = createAuthorizationEnvelopesRegistry();
    const seed = buildChangeSet({ state: "awaiting_approval" });
    changeSets.put(seed);

    const result = await amendEnvelope({
      journal: store,
      changeSets,
      envelopes,
      changeSetId: seed.id,
      newEnvelopeId: "99999999-9999-4999-8999-999999999999",
      createdAt: "2026-01-02T00:00:00.000Z",
      content: content({ prohibitedActions: ["force-push main"] }),
      reason: "widened prohibited-actions list",
    });

    expect(result.envelope.canonicalHash).not.toBe(seed.authorizationEnvelopeId);
    expect(result.changeSet.authorizationEnvelopeId).toBe(result.envelope.id);
    expect(changeSets.get(seed.id)?.authorizationEnvelopeId).toBe(result.envelope.id);
    // CRITICAL C1 repair: the new envelope must be durably resolvable so
    // contract.approve can derive the expected digest server-side.
    expect(envelopes.get(result.envelope.id)).toEqual(result.envelope);

    const decisions: unknown[] = [];
    for await (const entry of store.queryEntries({
      type: "adjudication_decision",
      changeSetId: seed.id,
    })) {
      decisions.push(entry);
    }
    expect(decisions).toHaveLength(1);
  });

  it("amending a still-unapproved ChangeSet (draft/awaiting_approval) leaves its state untouched", async () => {
    const changeSets = createChangeSetsRegistry();
    const envelopes = createAuthorizationEnvelopesRegistry();
    const seed = buildChangeSet({ state: "awaiting_approval" });
    changeSets.put(seed);

    const result = await amendEnvelope({
      journal: store,
      changeSets,
      envelopes,
      changeSetId: seed.id,
      newEnvelopeId: "99999999-9999-4999-8999-999999999999",
      createdAt: "2026-01-02T00:00:00.000Z",
      content: content({ prohibitedActions: ["x"] }),
      reason: "n/a",
    });
    expect(result.changeSet.state).toBe("awaiting_approval");
  });

  it("MEDIUM M4: amending a `ready` ChangeSet demotes it — a ready state can never point at an un-approved envelope", async () => {
    const changeSets = createChangeSetsRegistry();
    const envelopes = createAuthorizationEnvelopesRegistry();
    const seed = buildChangeSet({ state: "ready" });
    changeSets.put(seed);

    const result = await amendEnvelope({
      journal: store,
      changeSets,
      envelopes,
      changeSetId: seed.id,
      newEnvelopeId: "99999999-9999-4999-8999-999999999999",
      createdAt: "2026-01-02T00:00:00.000Z",
      content: content({ prohibitedActions: ["escalated"] }),
      reason: "widened authority post-approval",
    });

    // `ready` has NO legal `-> awaiting_approval` or `-> blocked` edge in
    // 02's fixed transition table (`ready: ["running", "cancelled"]`) — the
    // only legal fail-closed demotion is `cancelled`. Whatever the target,
    // it must NEVER remain `ready`.
    expect(result.changeSet.state).not.toBe("ready");
    expect(changeSets.get(seed.id)?.state).not.toBe("ready");
    expect(result.changeSet.authorizationEnvelopeId).toBe(result.envelope.id);
  });

  it("MEDIUM M4: amending an in-flight (running) ChangeSet demotes it to blocked", async () => {
    const changeSets = createChangeSetsRegistry();
    const envelopes = createAuthorizationEnvelopesRegistry();
    const seed = buildChangeSet({ state: "running" });
    changeSets.put(seed);

    const result = await amendEnvelope({
      journal: store,
      changeSets,
      envelopes,
      changeSetId: seed.id,
      newEnvelopeId: "99999999-9999-4999-8999-999999999999",
      createdAt: "2026-01-02T00:00:00.000Z",
      content: content({ prohibitedActions: ["escalated"] }),
      reason: "widened authority mid-run",
    });

    expect(result.changeSet.state).toBe("blocked");
  });

  it("refuses to amend an already-terminal ChangeSet (fails closed rather than silently repointing a dead ChangeSet's envelope)", async () => {
    const changeSets = createChangeSetsRegistry();
    const envelopes = createAuthorizationEnvelopesRegistry();
    const seed = buildChangeSet({ state: "cancelled" });
    changeSets.put(seed);

    await expect(
      amendEnvelope({
        journal: store,
        changeSets,
        envelopes,
        changeSetId: seed.id,
        newEnvelopeId: "99999999-9999-4999-8999-999999999999",
        createdAt: "2026-01-02T00:00:00.000Z",
        content: content(),
        reason: "n/a",
      }),
    ).rejects.toThrow(ChangeSetAlreadyTerminalError);
    expect(changeSets.get(seed.id)?.authorizationEnvelopeId).toBe(seed.authorizationEnvelopeId);
  });

  it("throws ChangeSetNotFoundForAmendmentError for an unknown ChangeSet", async () => {
    const changeSets = createChangeSetsRegistry();
    const envelopes = createAuthorizationEnvelopesRegistry();
    await expect(
      amendEnvelope({
        journal: store,
        changeSets,
        envelopes,
        changeSetId: "11111111-1111-4111-8111-111111111111",
        newEnvelopeId: "22222222-2222-4222-8222-222222222222",
        createdAt: "2026-01-02T00:00:00.000Z",
        content: content(),
        reason: "n/a",
      }),
    ).rejects.toThrow(ChangeSetNotFoundForAmendmentError);
  });
});

describe("isMaterialEnvelopeChange", () => {
  it("is false when the candidate content hashes identically to the previous hash", () => {
    const c = content();
    expect(isMaterialEnvelopeChange(hashEnvelopeContent(c), c)).toBe(false);
  });

  it("is true when the candidate content differs", () => {
    const previous = hashEnvelopeContent(content());
    expect(isMaterialEnvelopeChange(previous, content({ prohibitedActions: ["x"] }))).toBe(true);
  });
});
