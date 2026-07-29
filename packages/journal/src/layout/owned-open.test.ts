import { execFileSync } from "node:child_process";
import {
  chmodSync,
  closeSync,
  constants,
  linkSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ensureOwnedDir, openOwnedFile } from "./owned-open.js";

let dir: string;
let path: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "eo-owned-open-"));
  path = join(dir, "target");
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const READ = constants.O_RDONLY;

/**
 * Roast round 31 — one opener, because five had already diverged.
 *
 * Round 30 hardened two openers. Sweeping for the rest found three more using
 * `O_NOFOLLOW` WITHOUT `O_NONBLOCK`, and a differential against one corpus of
 * hostile objects — each case in its OWN PROCESS, because a synchronous block
 * cannot be observed by any in-process timer — measured the divergence rather
 * than asserting it:
 *
 *   object     | policy-store.load | signing-key.loadOrCreate | round 30's opener
 *   regular    | loaded            | ok                       | accepted
 *   symlink    | invalid           | threw                    | refused
 *   dangling   | invalid           | threw                    | refused
 *   directory  | invalid           | threw                    | refused
 *   mode 644   | invalid           | threw                    | (not checked)
 *   fifo       | *** BLOCKED ***   | *** BLOCKED ***          | refused
 *   hardlink   | LOADED            | OK                       | REFUSED
 *
 * Three implementations, two behaviours, in both of the rows that matter. That
 * is round 7's lesson — three attempts at keeping two functions in agreement
 * each diverged somewhere new — so this is the single site that decides, and
 * every caller maps its refusal onto its own error shape.
 */
describe("openOwnedFile", () => {
  it("opens a regular file this account owns", () => {
    writeFileSync(path, "payload", { mode: 0o600 });
    const result = openOwnedFile(path, READ);
    expect(result.refused).toBeUndefined();
    expect(result.fd).toBeTypeOf("number");
    // The descriptor is usable and names the file we asked for -- an opener
    // that returned a valid fd for the WRONG inode would pass a bare
    // "not refused" assertion.
    expect(readFileSync(result.fd as number, "utf8")).toBe("payload");
    closeSync(result.fd as number);
  });

  it("refuses a symlink without following it", () => {
    writeFileSync(`${path}.t`, "payload", { mode: 0o600 });
    symlinkSync(`${path}.t`, path);
    expect(openOwnedFile(path, READ).refused).toBe("symlink");
  });

  it("refuses a dangling symlink", () => {
    symlinkSync(join(dir, "absent"), path);
    expect(openOwnedFile(path, READ).refused).toBe("symlink");
  });

  it("reports an absent path as absent, not as an attack", () => {
    // The distinction is load-bearing for every caller: "no policy yet, run
    // install" and "something is planted at your policy path" are different
    // sentences and different remedies.
    expect(openOwnedFile(path, READ).refused).toBe("absent");
  });

  it("refuses a directory", () => {
    mkdirSync(path);
    expect(openOwnedFile(path, READ).refused).toBe("not-a-regular-file");
  });

  it("refuses a hardlink to a file it did not place there", () => {
    // `O_NOFOLLOW` does NOT cover this: a hardlink opens as a perfectly
    // ordinary regular file this uid owns. Only the link count tells it apart,
    // and two of the three implementations this replaces accepted it.
    writeFileSync(`${path}.t`, "payload", { mode: 0o600 });
    linkSync(`${path}.t`, path);
    expect(openOwnedFile(path, READ).refused).toBe("hardlinked");
  });

  it("RETURNS on a FIFO instead of blocking in open(2)", () => {
    execFileSync("mkfifo", [path]);
    // No timer can guard this: the call is synchronous, so a block freezes the
    // event loop, ignores SIGTERM, and shows up as the whole process needing
    // SIGKILL. Measured through the real CLI at 36s / rc=137 / zero bytes of
    // output before this existed. If `O_NONBLOCK` is dropped, this test does
    // not fail -- it hangs the worker, which the mutation battery records as
    // exit 124 rather than as a failed assertion.
    expect(openOwnedFile(path, READ).refused).toBe("not-a-regular-file");
  });

  it("optionally refuses a file other accounts can reach", () => {
    writeFileSync(path, "payload", { mode: 0o644 });
    expect(openOwnedFile(path, READ, { requirePrivateMode: true }).refused).toBe(
      "group-or-world-accessible",
    );
    // Opt-in, because not every caller's file is a secret: the sweep cursor is
    // a rotation hint, and refusing it for its mode would turn a cosmetic
    // difference into a lost health check.
    const permissive = openOwnedFile(path, READ);
    expect(permissive.refused).toBeUndefined();
    closeSync(permissive.fd as number);
  });

  it("creates with O_CREAT without truncating what it then refuses", () => {
    writeFileSync(`${path}.t`, "keep me", { mode: 0o600 });
    linkSync(`${path}.t`, path);
    const result = openOwnedFile(path, constants.O_WRONLY | constants.O_CREAT);
    expect(result.refused).toBe("hardlinked");
    // The refusal must not be destructive. `O_TRUNC` in the flags would empty
    // the file before any check could refuse it -- a write dressed up as an
    // open -- so the caller truncates explicitly AFTER this returns a fd.
    expect(readFileSync(`${path}.t`, "utf8")).toBe("keep me");
  });

  it("reports the errno for a refusal it cannot classify", () => {
    writeFileSync(path, "payload", { mode: 0o000 });
    const result = openOwnedFile(path, READ);
    expect(result.refused).toBe("unreadable");
    expect(result.code).toBe("EACCES");
  });
});

describe("openOwnedFile — what it found, so callers can phrase a remedy", () => {
  let d: string;
  beforeEach(() => {
    d = mkdtempSync(join(tmpdir(), "eo-owned-kind-"));
  });
  afterEach(() => {
    rmSync(d, { recursive: true, force: true });
  });

  it("names a directory as a directory and a FIFO as a FIFO", () => {
    // The policy store's owner-facing wording distinguishes them -- "is a
    // directory, not a policy file; remove it and re-run `crabgic install`"
    // is not the remedy a FIFO deserves -- and several rounds fought over
    // those exact strings. One site decides what it IS; each caller still
    // decides what to SAY.
    const dirPath = join(d, "dir");
    mkdirSync(dirPath);
    expect(openOwnedFile(dirPath, constants.O_RDONLY).kind).toBe("directory");

    const fifoPath = join(d, "fifo");
    execFileSync("mkfifo", [fifoPath]);
    expect(openOwnedFile(fifoPath, constants.O_RDONLY).kind).toBe("fifo");
  });

  it("leaves the kind unset when the refusal is not about the file type", () => {
    const p = join(d, "linked");
    writeFileSync(`${p}.t`, "x", { mode: 0o600 });
    linkSync(`${p}.t`, p);
    const result = openOwnedFile(p, constants.O_RDONLY);
    expect(result.refused).toBe("hardlinked");
    expect(result.kind).toBeUndefined();
  });
});

/**
 * Roast round 32 — `O_NOFOLLOW` guards the FINAL component only.
 *
 * Round 31 hardened every open in the product and a symlink ONE LEVEL UP
 * defeated all of it. Measured through the real writers:
 *
 *   <state>/crabgic/<hash> -> symlink to an attacker's directory
 *   loadOrCreateApprovalSigningKey -> attacker dir holds approval-signing.key
 *   writeEnvelopePolicy            -> attacker dir holds envelope-policy.json
 *
 * Neither refused. The first hands over the key that mints approval tokens.
 */
describe("ensureOwnedDir", () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "eo-owned-dir-"));
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("creates the missing components owner-only", () => {
    const target = join(root, "crabgic", "hash", "deep");
    expect(ensureOwnedDir(target, root)).toBeUndefined();
    expect(statSync(target).isDirectory()).toBe(true);
    expect(statSync(target).mode & 0o077).toBe(0);
    expect(statSync(join(root, "crabgic")).mode & 0o077).toBe(0);
  });

  it("refuses a symlinked component instead of writing through it", () => {
    const attacker = join(root, "attacker");
    mkdirSync(attacker);
    mkdirSync(join(root, "crabgic"));
    symlinkSync(attacker, join(root, "crabgic", "hash"));

    expect(ensureOwnedDir(join(root, "crabgic", "hash"), root)).toBe("symlink");
    // And nothing was created on the other side of the link -- a refusal that
    // still wrote would be the defect wearing a different verdict.
    expect(readdirSync(attacker)).toEqual([]);
  });

  it("refuses a symlink at the LAST component as readily as an interior one", () => {
    const attacker = join(root, "attacker");
    mkdirSync(attacker);
    mkdirSync(join(root, "crabgic"));
    symlinkSync(attacker, join(root, "crabgic", "hash"));
    expect(ensureOwnedDir(join(root, "crabgic", "hash", "deeper"), root)).toBe("symlink");
    expect(readdirSync(attacker)).toEqual([]);
  });

  it("refuses a component another account could replace entries in", () => {
    const dir = join(root, "crabgic");
    mkdirSync(dir);
    // `chmod` AFTER `mkdir`: the umask reduces a 0o777 create mode to 0o755 on
    // a default shell, so the mode the test believes it set is not the mode on
    // disk, and the assertion passes for the wrong reason.
    chmodSync(dir, 0o777);
    expect(ensureOwnedDir(join(root, "crabgic", "hash"), root)).toBe("group-or-world-accessible");
  });

  it("refuses a plain file where a directory belongs", () => {
    mkdirSync(join(root, "crabgic"));
    writeFileSync(join(root, "crabgic", "hash"), "not a dir", { mode: 0o600 });
    expect(ensureOwnedDir(join(root, "crabgic", "hash"), root)).toBe("not-a-regular-file");
  });

  it("does NOT verify the trusted root itself", () => {
    // A symlinked $HOME or $TMPDIR is a normal configuration on several
    // platforms. Refusing it would break working installs to close an attack
    // that needs write access to a directory Crabgic itself creates 0700 --
    // a fix that costs more than the defect, which is the shape rounds 4-8
    // kept catching.
    const real = mkdtempSync(join(tmpdir(), "eo-owned-real-"));
    const linkedRoot = join(root, "linked-root");
    symlinkSync(real, linkedRoot);
    try {
      expect(ensureOwnedDir(join(linkedRoot, "crabgic"), linkedRoot)).toBeUndefined();
    } finally {
      rmSync(real, { recursive: true, force: true });
    }
  });

  it("refuses to vouch for a path outside the root it was given", () => {
    expect(ensureOwnedDir(join(root, "..", "elsewhere"), root)).toBe("not-owned");
  });
});

describe("ensureOwnedDir — a machine that has never run this before", () => {
  it("creates the trusted root when it does not exist yet", () => {
    // Regression guard for round 32's own first attempt, which walked from the
    // root without creating it: on a fresh `$HOME` with no `.local/state`, the
    // first `mkdir` below the root failed with ENOENT and the whole bootstrap
    // refused to start. Eleven bootstrap tests caught it. The probe did not —
    // it staged a root that already existed, which is the difference between
    // an attack scenario and a first run.
    const home = mkdtempSync(join(tmpdir(), "eo-fresh-home-"));
    try {
      const stateHome = join(home, ".local", "state");
      const target = join(stateHome, "crabgic", "hash");
      expect(ensureOwnedDir(target, stateHome)).toBeUndefined();
      expect(statSync(target).isDirectory()).toBe(true);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});
