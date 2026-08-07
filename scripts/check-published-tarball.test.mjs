/**
 * Unit tests for the publishable-tarball guard — specifically the `bin`-target
 * normalization invariant added 2026-08-07.
 *
 * WHY THIS FILE EXISTS AT ALL, AND WHY THE INVARIANT IS NOT ASSERTED AS A
 * LITERAL. The v1.6.0 publish log carried two lines reading `"bin[crabgic]"
 * script name dist/bin.js was invalid and removed`. Nothing was removed: every
 * published version's packument and both downloaded tarballs carry both keys.
 * The message is an upstream mislabel in `@npmcli/package-json`, triggered by
 * the leading `./` this package declared. The narrow remedy is a two-line
 * manifest edit — and asserting `manifest.bin.crabgic === "dist/bin.js"` back
 * would be a tautology over a literal one line away, which is vacuity pattern
 * #1 in `docs/verification-playbook.md`. So what is asserted is the general
 * invariant: **no declared `bin` target may be one npm's own normalizer
 * rewrites**, for any key, now or later.
 *
 * WHY THIS SUITE RATHER THAN THE SCRIPT IS THE PER-PUSH BEARER. Measured
 * 2026-08-07: `npm run check:tarball` is invoked by **no** workflow in
 * `.github/workflows/` — `grep -rn 'npm run check:' .github/workflows/` returns
 * ten hits and none of them is `check:tarball`, `check:install-smoke` or
 * `check:package-graph`. Those three run only through `check:all`, by hand.
 * The `scripts` vitest project (`vitest.config.ts:84`) IS in the default `npm
 * test` fan-out, so the assertion against the real committed manifest below is
 * what actually bites on every push. Putting it only in the script would have
 * left it unrun evidence.
 *
 * WHY THE TRANSCRIPTION IS CHECKED AGAINST NPM ITSELF. `secureAndUnixifyPath`
 * is transcribed out of npm's bundled `@npmcli/package-json/lib/normalize.js`,
 * a file outside this repository. A transcription nobody compares to its source
 * is a belief, so the last test drives the REAL `npm pkg fix` over a throwaway
 * manifest and requires it to agree with the transcription key by key.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import {
  nonNormalizedBinTargets,
  readPublishableManifest,
  secureAndUnixifyPath,
  unixifyPath,
} from "./check-published-tarball.mjs";

const REPO_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const scratch = [];

afterAll(() => {
  while (scratch.length > 0) rmSync(scratch.pop(), { recursive: true, force: true });
});

describe("secureAndUnixifyPath (npm's own rewrite, transcribed)", () => {
  it("strips the leading ./ that produced the v1.6.0 publish warning", () => {
    expect(secureAndUnixifyPath("./dist/bin.js")).toBe("dist/bin.js");
    expect(secureAndUnixifyPath("./dist/bin/supervisord.js")).toBe("dist/bin/supervisord.js");
  });

  it("is a fixed point on the form this package now declares", () => {
    // The control that stops the assertion above being satisfied by a function
    // that mangles everything.
    expect(secureAndUnixifyPath("dist/bin.js")).toBe("dist/bin.js");
    expect(secureAndUnixifyPath("dist/bin/supervisord.js")).toBe("dist/bin/supervisord.js");
  });

  it("rewrites the other shapes npm rewrites, so the invariant is not ./-specific", () => {
    // These are the reason the guard is the general invariant rather than a
    // check for a leading "./": any of them, added under a NEW key later, would
    // reproduce the same publish-log line.
    expect(secureAndUnixifyPath("/abs/x.js")).toBe("abs/x.js");
    expect(secureAndUnixifyPath("../escape.js")).toBe("escape.js");
    expect(secureAndUnixifyPath("bin/../dist/x.js")).toBe("dist/x.js");
    expect(secureAndUnixifyPath("a:b")).toBe("a/b");
    expect(secureAndUnixifyPath("C:\\x\\y.js")).toBe("C/x/y.js");
  });

  it("returns the empty string for a target that resolves to no path at all", () => {
    // npm deletes the key outright in this case (`if (!binTarget) delete`), so
    // "" is the one rewrite where something really IS removed.
    for (const ref of ["", ".", ".."]) expect(secureAndUnixifyPath(ref)).toBe("");
  });

  it("unixifyPath converts exactly the two characters npm converts", () => {
    expect(unixifyPath("a\\b:c/d")).toBe("a/b/c/d");
    expect(unixifyPath("already/unix.js")).toBe("already/unix.js");
  });
});

describe("nonNormalizedBinTargets", () => {
  it("flags a target npm would rewrite, naming the key and both forms", () => {
    // RED-FIRST FIXTURE: this is the manifest `packages/cli/package.json` was
    // at `cb450e3` (v1.6.0), put back deliberately. Before the two-line manifest
    // edit that accompanies this file, the real-manifest test below FAILED with
    // exactly this shape.
    expect(
      nonNormalizedBinTargets({
        bin: { crabgic: "./dist/bin.js", "crabgic-supervisord": "./dist/bin/supervisord.js" },
      }),
    ).toEqual([
      { key: "crabgic", declared: "./dist/bin.js", normalized: "dist/bin.js" },
      {
        key: "crabgic-supervisord",
        declared: "./dist/bin/supervisord.js",
        normalized: "dist/bin/supervisord.js",
      },
    ]);
  });

  it("does NOT flag the same manifest once the targets are in normalized form", () => {
    // Without this control, a `nonNormalizedBinTargets` that flags every entry
    // satisfies the test above just as well.
    expect(
      nonNormalizedBinTargets({
        bin: { crabgic: "dist/bin.js", "crabgic-supervisord": "dist/bin/supervisord.js" },
      }),
    ).toEqual([]);
  });

  it("flags only the offending key when a manifest mixes both forms", () => {
    expect(nonNormalizedBinTargets({ bin: { good: "dist/a.js", bad: "./dist/b.js" } })).toEqual([
      { key: "bad", declared: "./dist/b.js", normalized: "dist/b.js" },
    ]);
  });

  it("makes no claim about manifests with no object-shaped bin", () => {
    for (const manifest of [{}, { bin: undefined }, { bin: "dist/bin.js" }, { bin: ["x.js"] }]) {
      expect(nonNormalizedBinTargets(manifest)).toEqual([]);
    }
  });
});

describe("the REAL published manifest", () => {
  const manifest = readPublishableManifest();

  it("declares both bin keys (rules out an empty-map pass of the invariant below)", () => {
    // `nonNormalizedBinTargets({})` is trivially `[]`. Without this, a manifest
    // that lost its `bin` map entirely would satisfy the next test.
    expect(Object.keys(manifest.bin).sort()).toEqual(["crabgic", "crabgic-supervisord"]);
    expect(manifest.name).toBe("crabgic");
  });

  it("declares no bin target npm's normalizer would rewrite", () => {
    // THE PER-PUSH BEARER. RED at `cb450e3` (both targets carried `./`); green
    // from the manifest edit in this commit onward. It is deliberately NOT
    // written as an equality against "dist/bin.js" — see this file's header.
    expect(nonNormalizedBinTargets(manifest)).toEqual([]);
  });
});

describe("the transcription agrees with npm itself", () => {
  it("matches `npm pkg fix`'s own rewrite of every shape, key by key", () => {
    // The binding between the transcribed `secureAndUnixifyPath` and the tool
    // it was transcribed from. Two files with the same behaviour is a claim
    // until something compares them; this compares them.
    const declared = {
      dotslash: "./dist/bin.js",
      nested: "./dist/bin/supervisord.js",
      plain: "dist/bin.js",
      absolute: "/abs/x.js",
      parent: "../escape.js",
      traversal: "bin/../dist/x.js",
    };
    const dir = mkdtempSync(path.join(tmpdir(), "tarball-bin-norm-"));
    scratch.push(dir);
    writeFileSync(
      path.join(dir, "package.json"),
      `${JSON.stringify({ name: "bin-normalization-fixture", version: "1.0.0", bin: declared }, null, 2)}\n`,
    );
    execFileSync("npm", ["pkg", "fix"], { cwd: dir, stdio: ["ignore", "ignore", "ignore"] });
    const fixed = JSON.parse(readFileSync(path.join(dir, "package.json"), "utf8"));

    const expected = Object.fromEntries(
      Object.entries(declared).map(([key, ref]) => [key, secureAndUnixifyPath(ref)]),
    );
    expect(fixed.bin).toEqual(expected);
    // And the fixture really did exercise the rewrite rather than passing
    // because npm changed nothing: five of the six shapes must have moved.
    expect(Object.entries(fixed.bin).filter(([k, v]) => declared[k] !== v)).toHaveLength(5);
  }, 60_000);
});

describe("repo wiring", () => {
  it("is reachable as `npm run check:tarball` from the repository root", () => {
    // A guard nothing invokes is not a guard. This pins the script's own name in
    // the root manifest; the per-push bearer is the real-manifest test above,
    // because `check:tarball` itself runs in no workflow (see the header).
    const root = JSON.parse(readFileSync(path.join(REPO_ROOT, "package.json"), "utf8"));
    expect(root.scripts["check:tarball"]).toBe("node scripts/check-published-tarball.mjs");
  });
});
