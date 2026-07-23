import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Static manifest-check — roadmap/17 §Exit criteria: "`packages/renderer`'s
 * `package.json` carries no HTTP-client or VCS-host SDK dependency — a
 * static manifest check proving the Goal's 'never calls a PR/hosting API'
 * claim structurally, not just by test absence." Reads the ACTUAL
 * `package.json` on disk (never a hardcoded copy of its contents), so a
 * future dependency addition is caught here even if no other test happens
 * to exercise it.
 */

const PACKAGE_JSON_PATH = join(dirname(fileURLToPath(import.meta.url)), "..", "package.json");

// Known HTTP-client and VCS-host SDK package-name substrings this phase
// must never depend on (roadmap/17 §Out of scope: "no GitHub/GitLab/
// Bitbucket connector exists or is planned").
const DISALLOWED_DEPENDENCY_SUBSTRINGS = [
  "axios",
  "node-fetch",
  "undici",
  "got",
  "superagent",
  "octokit",
  "@octokit",
  "gitlab",
  "bitbucket",
  "github",
  "@modelcontextprotocol",
];

describe("packages/renderer/package.json — no HTTP-client/VCS-host SDK dependency", () => {
  const manifest = JSON.parse(readFileSync(PACKAGE_JSON_PATH, "utf8")) as {
    readonly dependencies?: Record<string, string>;
    readonly devDependencies?: Record<string, string>;
  };

  it("declares only @eo/contracts as a runtime dependency", () => {
    expect(Object.keys(manifest.dependencies ?? {})).toEqual(["@eo/contracts"]);
  });

  it("carries no HTTP-client or VCS-host SDK dependency by name, in dependencies or devDependencies", () => {
    const allDependencyNames = [
      ...Object.keys(manifest.dependencies ?? {}),
      ...Object.keys(manifest.devDependencies ?? {}),
    ];
    for (const name of allDependencyNames) {
      const lowerName = name.toLowerCase();
      for (const disallowed of DISALLOWED_DEPENDENCY_SUBSTRINGS) {
        expect(lowerName.includes(disallowed)).toBe(false);
      }
    }
  });
});
