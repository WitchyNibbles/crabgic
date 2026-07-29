import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  APPROVAL_SIGNING_KEY_FILE_NAME,
  ApprovalSigningKeyError,
  loadOrCreateApprovalSigningKey,
  resolveApprovalSigningKeyPath,
} from "./signing-key.js";

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "eo-signing-key-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("resolveApprovalSigningKeyPath", () => {
  it("pins the key beside the rest of the project's XDG state (never the cache root)", () => {
    const path = resolveApprovalSigningKeyPath({ HOME: root, XDG_STATE_HOME: root }, "abc123");
    expect(path).toBe(join(root, "crabgic", "abc123", APPROVAL_SIGNING_KEY_FILE_NAME));
  });
});

describe("loadOrCreateApprovalSigningKey", () => {
  it("creates a 32-byte key at 0600 under a 0700 directory on first use", () => {
    const path = join(root, "state", APPROVAL_SIGNING_KEY_FILE_NAME);
    const key = loadOrCreateApprovalSigningKey(path, root);

    expect(key).toHaveLength(32);
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(statSync(join(root, "state")).mode & 0o777).toBe(0o700);
    expect(readFileSync(path)).toEqual(key);
  });

  it("returns the SAME key on a second call — this is what makes a token minted by `run` verifiable by the gateway-mcp process", () => {
    const path = join(root, "state", APPROVAL_SIGNING_KEY_FILE_NAME);
    const first = loadOrCreateApprovalSigningKey(path, root);
    const second = loadOrCreateApprovalSigningKey(path, root);

    expect(second).toEqual(first);
  });

  it("refuses a key file another user could read (fail-closed on a widened mode)", () => {
    const path = join(root, "state", APPROVAL_SIGNING_KEY_FILE_NAME);
    loadOrCreateApprovalSigningKey(path, root);
    chmodSync(path, 0o644);

    expect(() => loadOrCreateApprovalSigningKey(path, root)).toThrow(ApprovalSigningKeyError);
  });

  it("refuses a symlinked key file (never follows a link planted at the pinned path)", () => {
    mkdirSync(join(root, "state"), { recursive: true, mode: 0o700 });
    const decoy = join(root, "decoy.key");
    writeFileSync(decoy, Buffer.alloc(32, 7), { mode: 0o600 });
    symlinkSync(decoy, join(root, "state", APPROVAL_SIGNING_KEY_FILE_NAME));

    expect(() =>
      loadOrCreateApprovalSigningKey(join(root, "state", APPROVAL_SIGNING_KEY_FILE_NAME), root),
    ).toThrow(ApprovalSigningKeyError);
  });

  it("refuses a truncated/oversized key rather than signing with weak material", () => {
    mkdirSync(join(root, "state"), { recursive: true, mode: 0o700 });
    const path = join(root, "state", APPROVAL_SIGNING_KEY_FILE_NAME);
    writeFileSync(path, Buffer.alloc(8), { mode: 0o600 });

    expect(() => loadOrCreateApprovalSigningKey(path, root)).toThrow(ApprovalSigningKeyError);
  });
});
