/**
 * `dispatchCommand`'s conditional routing for `trust review|approve|revoke`
 * (roadmap/12-stack-detection-quarantine.md) — when `deps.trust` IS
 * supplied, these three commands hit the real `@crabgic/detect` backend rather
 * than `NOT_IMPLEMENTED`.
 *
 * This closes the deviation phase 12 recorded in its own
 * `packages/detect/src/trust/trust-commands.test.ts`: "this task's
 * file-scope authority is `packages/detect/` ... only — it cannot edit
 * `packages/cli/src/commands/dispatch.ts` to actually route the CLI's
 * `trust-review`/`trust-approve`/`trust-revoke` argv commands to these
 * handlers." That suite proved the backend chain end-to-end; this one
 * proves the argv command actually reaches it, which is what roadmap/12's
 * exit criterion ("CLI `trust review|approve|revoke` replaces 09's
 * `NOT_IMPLEMENTED` stub end-to-end") actually asks for.
 *
 * `./cli.commands.schema.test.ts`'s own suite (09, unmodified) proves the
 * OTHER half: without `deps.trust` they still return the exact typed
 * `NOT_IMPLEMENTED` shape — re-asserted directly here so the two halves
 * can never drift apart unnoticed.
 */
import { randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ApprovalTokenMinter } from "@crabgic/contracts";
import { createApprovalLedger, createCapabilityStore } from "@crabgic/detect";
import type { TrustCommandDependencies } from "@crabgic/detect";
import { EXIT_NOT_IMPLEMENTED, EXIT_OK } from "../exit-codes.js";
import { dispatchCommand } from "./dispatch.js";
import type { CliDependencies } from "./types.js";

const dirs: string[] = [];
afterEach(async () => {
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

function baseDeps(): Pick<CliDependencies, "connectClient" | "journal" | "projectHash"> {
  return {
    connectClient: () => {
      throw new Error("not needed for this test");
    },
    journal: {
      queryEntries: async function* () {
        /* no entries */
      },
      verifyJournal: async () => ({ ok: true, entries: 0 }) as never,
    },
    projectHash: "test-hash",
  };
}

async function newTrustDeps(): Promise<TrustCommandDependencies> {
  const root = await mkdtemp(join(tmpdir(), "eo-trust-dispatch-"));
  dirs.push(root);
  return {
    store: createCapabilityStore(root),
    minter: new ApprovalTokenMinter({ secretKey: randomBytes(32) }),
    approvalLedger: createApprovalLedger(root),
  };
}

describe("dispatchCommand — trust review|approve|revoke, real backend when deps.trust is supplied", () => {
  it("routes `trust review` to the real backend instead of NOT_IMPLEMENTED", async () => {
    const result = await dispatchCommand(
      { command: "trust-review", json: false },
      { ...baseDeps(), trust: await newTrustDeps() },
    );

    expect(result.exitCode).toBe(EXIT_OK);
    // The real backend's own empty-store wording — proof this is the
    // `@crabgic/detect` handler and not the stub, which never says this.
    expect(result.stdout).toContain("no capability audits");
  });

  it("routes `trust approve` to the real backend, which mints a digest-bound token", async () => {
    const digest = "a".repeat(64);
    const result = await dispatchCommand(
      { command: "trust-approve", digest, json: true },
      { ...baseDeps(), trust: await newTrustDeps() },
    );

    expect(result.exitCode).toBe(EXIT_OK);
    const minted = JSON.parse(result.stdout ?? "{}") as {
      subjectKind?: string;
      digest?: string;
      token?: string;
    };
    // Bound to THIS digest under the capability subject kind — a token
    // minted here can never verify against 11's envelope-hash subject.
    expect(minted.subjectKind).toBe("capability_digest");
    expect(minted.digest).toBe(digest);
    expect(minted.token).toBeTruthy();
  });

  it("routes `trust revoke` to the real backend", async () => {
    const trust = await newTrustDeps();
    const digest = "b".repeat(64);
    const approved = await dispatchCommand(
      { command: "trust-approve", digest, json: true },
      { ...baseDeps(), trust },
    );
    const { tokenId } = JSON.parse(approved.stdout ?? "{}") as { tokenId: string };

    const result = await dispatchCommand(
      { command: "trust-revoke", tokenId, json: false },
      { ...baseDeps(), trust },
    );

    // Whatever the backend's verdict, it is the BACKEND's verdict: the
    // stub can only ever produce EXIT_NOT_IMPLEMENTED.
    expect(result.exitCode).not.toBe(EXIT_NOT_IMPLEMENTED);
  });

  it("still returns the typed NOT_IMPLEMENTED shape for all three when deps.trust is absent", async () => {
    for (const command of [
      { command: "trust-review", json: false },
      { command: "trust-approve", digest: "c".repeat(64), json: false },
      { command: "trust-revoke", tokenId: "some-token", json: false },
    ] as const) {
      const result = await dispatchCommand(command, baseDeps());
      expect(result.exitCode).toBe(EXIT_NOT_IMPLEMENTED);
    }
  });
});
