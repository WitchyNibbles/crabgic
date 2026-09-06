/**
 * The critic that runs where nobody reads: under the standing approval, an
 * in-policy envelope is approved with no human looking at it, so a grant wider
 * than the plan needs goes uncaught. This reports it and refuses nothing.
 */
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { buildAuthorizationEnvelope, buildWorkUnit } from "@crabgic/testkit";
import { findUnusedAuthority, renderUnusedAuthority } from "./unused-authority.js";

function envelope(ownedPaths: string[]) {
  return buildAuthorizationEnvelope({ id: randomUUID(), ownedPaths });
}

function units(...ownedPaths: string[][]) {
  return ownedPaths.map((paths) =>
    buildWorkUnit({ id: randomUUID(), changeSetId: randomUUID(), ownedPaths: paths }),
  );
}

describe("findUnusedAuthority", () => {
  it("reports nothing when every granted path is used", () => {
    const result = findUnusedAuthority(envelope(["src/login"]), units(["src/login"]));
    expect(result.tight).toBe(true);
    expect(result.unusedOwnedPaths).toEqual([]);
    expect(renderUnusedAuthority(result)).toBeUndefined();
  });

  it("counts a grant as USED when a work unit claims something beneath it", () => {
    // `src` genuinely confers the authority a unit claiming `src/login` needs.
    // Calling that unused would flag every nested plan and train the reader to
    // ignore this entirely.
    const result = findUnusedAuthority(envelope(["src"]), units(["src/login"]));
    expect(result.tight).toBe(true);
  });

  it("flags a granted path no work unit goes near", () => {
    const result = findUnusedAuthority(
      envelope(["src/login", "infra/terraform"]),
      units(["src/login"]),
    );
    expect(result.unusedOwnedPaths).toEqual(["infra/terraform"]);
    expect(result.tight).toBe(false);
  });

  it("does not treat a sibling prefix as used — `srcfoo` is not under `src`", () => {
    // The same segment-aware containment the policy check uses; a substring
    // match here would silently excuse a real over-grant.
    const result = findUnusedAuthority(envelope(["src"]), units(["srcfoo/thing"]));
    expect(result.unusedOwnedPaths).toEqual(["src"]);
  });

  it("ignores trailing slashes and `./` prefixes, which are noise rather than intent", () => {
    expect(findUnusedAuthority(envelope(["src/login/"]), units(["./src/login"])).tight).toBe(true);
    expect(findUnusedAuthority(envelope(["./src/"]), units(["src/login/"])).tight).toBe(true);
  });

  /**
   * ⚠️ THE SPELLINGS THE PRIVATE MATCHER MISSED (2026-09-05).
   *
   * This module normalized with four lines of its own — trim, strip a leading
   * `./`, strip trailing slashes — until it was collapsed into
   * `@crabgic/contracts`' one predicate. The two cases below are the difference,
   * and neither was reachable by any assertion above: a doubled separator or an
   * interior `.` segment names the SAME directory on every filesystem, and the
   * old matcher reported the grant as authority nobody used. That is the
   * spurious warning this module's own doc comment says would "train the reader
   * to ignore this".
   *
   * Pinned because a review round measured that reverting the delegation left
   * the whole `packages/cli` suite green at 1517/1517 — a fix no test could
   * tell from its own absence.
   */
  it("collapses doubled and dotted separators, which name one directory", () => {
    expect(
      findUnusedAuthority(
        envelope(["scripts//stale-dist"]),
        units(["scripts/stale-dist/units.mjs"]),
      ).tight,
    ).toBe(true);
    expect(
      findUnusedAuthority(
        envelope(["scripts/./stale-dist"]),
        units(["scripts/stale-dist/walk.mjs"]),
      ).tight,
    ).toBe(true);
  });

  /**
   * FAIL CLOSED ON A SPELLING THAT GRANTS NOTHING, and say so rather than
   * leaving it to be discovered. A claim carrying a glob is not a path this
   * system can own — `validateOwnedPath` rejects every glob metacharacter, and
   * `buildTaskPacket` refuses such a work unit at dispatch — so it uses no
   * authority, and the grant beside it is genuinely unused. The old private
   * matcher passed globs through untouched and reported the opposite.
   */
  it("counts a grant as UNUSED when the only claim on it cannot name a path", () => {
    const result = findUnusedAuthority(
      envelope(["packages/gateway/src"]),
      units(["packages/gateway/src/**"]),
    );
    expect(result.tight).toBe(false);
    expect(result.unusedOwnedPaths).toEqual(["packages/gateway/src"]);
  });

  it("flags every granted path when the plan claims none at all", () => {
    const result = findUnusedAuthority(envelope(["src", "docs"]), units([]));
    expect(result.unusedOwnedPaths).toEqual(["src", "docs"]);
  });

  it("reports nothing for an envelope that grants no paths", () => {
    const result = findUnusedAuthority(envelope([]), units(["src"]));
    expect(result.tight).toBe(true);
  });
});

describe("renderUnusedAuthority", () => {
  it("names the paths and says explicitly that nothing is blocked", () => {
    // The reader's first question is "did something go wrong?" and the answer is
    // no — the policy allowed this. Leaving that implicit would read as an alarm.
    const rendered = renderUnusedAuthority(
      findUnusedAuthority(envelope(["src/login", "infra/terraform"]), units(["src/login"])),
    );
    expect(rendered).toContain("infra/terraform");
    expect(rendered).toContain("nothing is blocked");
    expect(rendered).toContain("more authority than its plan needs");
  });
});
