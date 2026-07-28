import { chmodSync, mkdtempSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { EnvelopePolicySchema } from "@crabgic/contracts";
import { digestPolicy, loadEnvelopePolicy } from "./policy-store.js";

let dir: string;
let path: string;

const VALID = {
  schemaVersion: 1,
  id: "11111111-1111-4111-8111-111111111111",
  createdAt: "2026-01-01T00:00:00.000Z",
  allowedPathPrefixes: ["src"],
};

function write(contents: unknown, mode = 0o600): void {
  writeFileSync(path, typeof contents === "string" ? contents : JSON.stringify(contents), {
    mode,
  });
  chmodSync(path, mode);
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "eo-policy-"));
  path = join(dir, "envelope-policy.json");
});

describe("loadEnvelopePolicy", () => {
  it("loads a well-formed policy and reports its digest", () => {
    write(VALID);
    const result = loadEnvelopePolicy(path);

    expect(result.status).toBe("loaded");
    if (result.status !== "loaded") return;
    expect(result.policy.allowedPathPrefixes).toEqual(["src"]);
    expect(result.digest).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it("reports a missing file as absent, not as an error", () => {
    expect(loadEnvelopePolicy(join(dir, "nope.json")).status).toBe("absent");
  });

  /**
   * Absent and invalid are different OWNER problems, and both refuse a
   * dispatch: absent means `install` never ran, invalid means someone
   * hand-edited the file into a state the schema rejects. Collapsing them
   * would send an owner to re-run an installer that is not what is broken.
   */
  it("distinguishes an unparseable file from a missing one", () => {
    write("{not json");
    const result = loadEnvelopePolicy(path);

    expect(result.status).toBe("invalid");
    if (result.status !== "invalid") return;
    expect(result.reason).toMatch(/not valid JSON/i);
  });

  it("rejects a file that parses but does not match the schema", () => {
    write({ ...VALID, allowedCommands: ["npm run lint"] });
    const result = loadEnvelopePolicy(path);

    expect(result.status).toBe("invalid");
    if (result.status !== "invalid") return;
    expect(result.reason).toMatch(/allowedCommands/);
  });

  /**
   * The policy decides what runs with no human review, so a mode letting
   * another local account edit it defeats the gate exactly as thoroughly as
   * a session-reachable writer would. Treated as invalid, not warned about.
   */
  it.each([0o644, 0o660, 0o606, 0o666])("refuses a policy at mode %s", (mode) => {
    write(VALID, mode);
    const result = loadEnvelopePolicy(path);

    expect(result.status).toBe("invalid");
    if (result.status !== "invalid") return;
    expect(result.reason).toMatch(/other accounts/i);
  });

  it("accepts 0600 and 0400", () => {
    write(VALID, 0o600);
    expect(loadEnvelopePolicy(path).status).toBe("loaded");
    write(VALID, 0o400);
    expect(loadEnvelopePolicy(path).status).toBe("loaded");
  });
});

describe("digestPolicy", () => {
  /**
   * Computed over the PARSED policy, not the file bytes: reformatting must
   * not read as a different authorization, and a policy relying on schema
   * defaults must digest identically to one that spells them out. Otherwise
   * the journaled digest answers "which bytes were on disk" rather than
   * "what was the human standing behind".
   */
  it("is stable across formatting and key order", () => {
    const a = EnvelopePolicySchema.parse(VALID);
    const b = EnvelopePolicySchema.parse({
      createdAt: VALID.createdAt,
      allowedPathPrefixes: VALID.allowedPathPrefixes,
      id: VALID.id,
      schemaVersion: VALID.schemaVersion,
    });

    expect(digestPolicy(a)).toBe(digestPolicy(b));
  });

  it("changes when any granted authority changes", () => {
    const base = EnvelopePolicySchema.parse(VALID);

    expect(digestPolicy(EnvelopePolicySchema.parse({ ...VALID, allowUnixSockets: true }))).not.toBe(
      digestPolicy(base),
    );
    expect(
      digestPolicy(EnvelopePolicySchema.parse({ ...VALID, allowedPathPrefixes: ["src", "docs"] })),
    ).not.toBe(digestPolicy(base));
    expect(
      digestPolicy(EnvelopePolicySchema.parse({ ...VALID, allowedWriteScratchPaths: ["dist"] })),
    ).not.toBe(digestPolicy(base));
  });
});

describe("writeEnvelopePolicy", () => {
  /**
   * 0600 at creation, not chmod-after-write. A window in which the file
   * exists world-readable is a window in which another local account can read
   * what this project will run unattended -- and the loader would then refuse
   * it, so getting the mode wrong is also a self-inflicted outage.
   */
  it("writes a policy the loader accepts, at 0600", async () => {
    const { writeEnvelopePolicy } = await import("./policy-store.js");
    const target = join(dir, "nested", "envelope-policy.json");

    await writeEnvelopePolicy(target, EnvelopePolicySchema.parse(VALID));

    expect(statSync(target).mode & 0o777).toBe(0o600);
    expect(loadEnvelopePolicy(target).status).toBe("loaded");
  });

  it("round-trips to the identical digest", async () => {
    const { writeEnvelopePolicy } = await import("./policy-store.js");
    const target = join(dir, "envelope-policy.json");
    const policy = EnvelopePolicySchema.parse(VALID);

    await writeEnvelopePolicy(target, policy);
    const loaded = loadEnvelopePolicy(target);

    expect(loaded.status).toBe("loaded");
    if (loaded.status !== "loaded") return;
    expect(loaded.digest).toBe(digestPolicy(policy));
  });
});

/**
 * Ledger Gap 18 part 3, asserted as a repo fact rather than a promise: the
 * only writer must have exactly one call site. This is the check that notices
 * when a later change makes the policy writable from somewhere a session can
 * reach, which would collapse the whole gate silently.
 */
describe("the policy has exactly one writer", () => {
  it("is called only from the installer wiring", async () => {
    const { execFileSync } = await import("node:child_process");
    const root = new URL("../../../..", import.meta.url).pathname;

    const hits = execFileSync(
      "grep",
      ["-rl", "writeEnvelopePolicy", "--include=*.ts", "--exclude-dir=dist", "packages"],
      { cwd: root, encoding: "utf8" },
    )
      .split("\n")
      .filter((line) => line.length > 0 && !line.endsWith(".test.ts"));
    // `dist` is excluded above rather than filtered here: a build artifact is
    // a copy of a source call site, not an independent one, and letting it
    // count would make this check pass or fail on whether someone had built.

    expect(hits.sort()).toEqual([
      "packages/cli/src/bootstrap.ts",
      "packages/cli/src/policy/policy-store.ts",
    ]);
  });
});

/**
 * Roast round 3, F4/F5/F7. Each of these was reachable on a real host, and
 * each defeats the standing approval in a different way.
 */
describe("loadEnvelopePolicy — ownership and containment", () => {
  it("refuses a policy path that is a symbolic link", async () => {
    const { symlinkSync } = await import("node:fs");
    const real = join(dir, "elsewhere.json");
    writeFileSync(real, JSON.stringify(VALID), { mode: 0o600 });
    chmodSync(real, 0o600);
    symlinkSync(real, path);

    const result = loadEnvelopePolicy(path);
    expect(result.status).toBe("invalid");
    if (result.status !== "invalid") return;
    // A 0600 target owned by anyone at all used to pass, because `statSync`
    // follows the link and validated the TARGET's mode.
    expect(result.reason).toMatch(/symbolic link/i);
  });

  it("refuses a policy in a directory other accounts can write", async () => {
    const openDir = join(dir, "open");
    const { mkdirSync } = await import("node:fs");
    mkdirSync(openDir, { recursive: true });
    chmodSync(openDir, 0o777);
    const target = join(openDir, "envelope-policy.json");
    writeFileSync(target, JSON.stringify(VALID), { mode: 0o600 });
    chmodSync(target, 0o600);

    const result = loadEnvelopePolicy(target);
    expect(result.status).toBe("invalid");
    if (result.status !== "invalid") return;
    // 0600 does not help when the file can be unlinked and recreated.
    expect(result.reason).toMatch(/writable by other accounts/i);
  });
});

describe("writeEnvelopePolicy — over an existing file", () => {
  /**
   * `writeFile`'s `mode` is passed to `open(2)` and applies only when it
   * CREATES the file, so writing over a pre-existing world-writable policy
   * put the new grant into it and only then narrowed the mode -- the exact
   * window the code's own comment claimed to avoid.
   */
  it("never writes the grant into a pre-existing world-writable file", async () => {
    const { writeEnvelopePolicy } = await import("./policy-store.js");
    writeFileSync(path, "{}", { mode: 0o666 });
    chmodSync(path, 0o666);

    await writeEnvelopePolicy(path, EnvelopePolicySchema.parse(VALID));

    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(loadEnvelopePolicy(path).status).toBe("loaded");
  });

  it("leaves no temporary file behind", async () => {
    const { writeEnvelopePolicy } = await import("./policy-store.js");
    const { readdirSync } = await import("node:fs");

    await writeEnvelopePolicy(path, EnvelopePolicySchema.parse(VALID));

    expect(readdirSync(dir).filter((f) => f.endsWith(".tmp"))).toEqual([]);
  });
});

describe("digestPolicy — the replacer trap", () => {
  /**
   * The old implementation passed `Object.keys(policy).sort()` as a replacer,
   * believing it fixed key order. A replacer ARRAY is a deep key allow-list
   * applied at every nesting level, so any nested field would have been
   * erased from the digest -- two policies granting differently would digest
   * identically, silently, and the journaled authorization identity would be
   * a lie. This pins the property directly rather than trusting the shape.
   */
  it("distinguishes policies that differ only in a nested value", () => {
    const nestedA = { ...EnvelopePolicySchema.parse(VALID), limits: { maxTurns: 5 } };
    const nestedB = { ...EnvelopePolicySchema.parse(VALID), limits: { maxTurns: 9999 } };

    expect(digestPolicy(nestedA as never)).not.toBe(digestPolicy(nestedB as never));
  });
});
