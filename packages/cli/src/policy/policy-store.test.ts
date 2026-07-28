import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
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
