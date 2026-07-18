import { describe, expect, it } from "vitest";
import * as fc from "fast-check";
import { GATEWAY_MCP_SERVER_NAME } from "@eo/contracts";
import { compileEnvelope } from "../compiler/compile-envelope.js";
import { WORKTREE_WRITE_PLACEHOLDER } from "../compiler/worktree-placeholders.js";
import {
  assertMandatoryDenyReadPathsPresent,
  assertNoBlanketMcpDeny,
  assertAllOwnedPathAllowRulesAreWorktreeScoped,
  assertEditWriteDenyBackstopPresent,
} from "./invariants.js";
import { isEditAllowed } from "./confinement-check.js";
import {
  envelopeArbitrary,
  envelopeWithMalformedOwnedPathArbitrary,
  envelopeWithMalformedNetworkDestinationArbitrary,
} from "./envelope-arbitrary.js";

const CANONICAL_BASH_RULES = [
  "Bash(npm run test:*)",
  "Bash(npm run build:*)",
  "Bash(git status:*)",
  "Bash(git diff:*)",
];

const MANDATORY_FIXED_DENY = [
  "Agent",
  "WebFetch",
  "WebSearch",
  "Bash(git push:*)",
  "Bash(curl:*)",
  "Bash(wget:*)",
];

/**
 * `compileEnvelope` property suite (roadmap/03-envelope-compiler-engine-
 * adapter.md §Test plan: "Property: fast-check ≥10k cases — no allow
 * outside the envelope; mandatory denies survive any envelope; compiled
 * profile never contains a blanket `mcp__*` deny"; §Exit criteria: "green
 * at ≥10k fast-check cases in CI").
 *
 * MAJOR 3 fix (phase-03 security-fix round): the "no allow outside the
 * envelope" property below is now SEMANTIC, not structural. The OLD
 * version re-derived `Edit(//${path}/**)` from the SAME envelope the
 * compiler read and asserted string equality — tautological by
 * construction, and provably unable to detect a confinement escape (it
 * passed for ANY hostile path, since the hostile path would be echoed
 * right back into the "expected" string too). This version instead
 * evaluates a genuinely INDEPENDENT confinement matcher
 * (`./confinement-check.js`, deliberately not the compiler's own
 * rule-emission code) against concrete target paths OUTSIDE every
 * declared owned path, and asserts every one is denied — plus a positive
 * counterpart proving declared-owned targets ARE allowed.
 */
describe("compileEnvelope — property: no allow outside the envelope (≥10k cases, semantic confinement)", () => {
  // Target paths are spelled BARE (worktree-relative, no explicit anchor
  // prefix) — the same convention the compiled `//<worktree>/…` allow
  // rules resolve against once the shared placeholder is stripped (see
  // `./confinement-check.js`'s doc comment), and the same convention the
  // envelope-conformance fixtures (`@eo/testkit`) already use for `file_path`.
  it("a target path outside every declared owned path is never allowed for Edit", () => {
    fc.assert(
      fc.property(envelopeArbitrary(), (envelope) => {
        const profile = compileEnvelope(envelope);
        // A fixed sentinel top-level segment that cannot equal or nest under
        // any generated owned path (the arbitrary's vocabulary never
        // produces this literal), so this stays a genuine "outside every
        // declared owned path" target regardless of how the envelope's own
        // owned paths happen to overlap each other.
        const outsideTargets = [
          "../etc/passwd",
          "/etc/passwd",
          "~/.ssh/id_rsa",
          ".git/config",
          "__never_owned_sentinel__/definitely-not-owned/file.ts",
        ];
        for (const target of outsideTargets) {
          expect(isEditAllowed(profile, target)).toBe(false);
        }
      }),
      { numRuns: 10000 },
    );
    // 20s timeout: 10k fast-check cases can exceed vitest's default 5s under
    // full-suite parallel CPU contention (matches anchor-forms.test.ts).
  }, 20000);

  it("a target inside a declared owned path IS allowed for Edit (positive confinement counterpart)", () => {
    fc.assert(
      fc.property(envelopeArbitrary(), (envelope) => {
        const profile = compileEnvelope(envelope);
        for (const ownedPath of envelope.ownedPaths) {
          const insideTarget = `${ownedPath}/file.ts`;
          expect(isEditAllowed(profile, insideTarget)).toBe(true);
        }
      }),
      { numRuns: 10000 },
    );
  });

  it("every emitted allow rule is still explainable by the envelope that produced it (structural sanity, kept alongside the semantic property above)", () => {
    fc.assert(
      fc.property(envelopeArbitrary(), (envelope) => {
        const profile = compileEnvelope(envelope);
        for (const rule of profile.permissions.allow) {
          const isGatewayAllow = rule === `mcp__${GATEWAY_MCP_SERVER_NAME}__*`;
          const isAuthorizedBashRule =
            CANONICAL_BASH_RULES.includes(rule) &&
            envelope.commands.some((command) => rule === `Bash(${command}:*)`);
          const isOwnedPathRule = envelope.ownedPaths.some(
            (path) =>
              rule === `Edit(//${WORKTREE_WRITE_PLACEHOLDER}/${path}/**)` ||
              rule === `Write(//${WORKTREE_WRITE_PLACEHOLDER}/${path}/**)`,
          );
          expect(isGatewayAllow || isAuthorizedBashRule || isOwnedPathRule).toBe(true);
        }
      }),
      { numRuns: 10000 },
    );
  });
});

describe("compileEnvelope — property: malformed ownedPaths are always rejected (≥10k cases, CRITICAL 1)", () => {
  it("compileEnvelope throws EnvelopeCompilationError whenever ownedPaths carries a malformed entry (absolute/'~'/'..'/glob)", () => {
    fc.assert(
      fc.property(envelopeWithMalformedOwnedPathArbitrary(), (envelope) => {
        expect(() => compileEnvelope(envelope)).toThrow();
      }),
      { numRuns: 10000 },
    );
  });
});

describe("compileEnvelope — property: malformed networkDestinations are always rejected (MINOR 4)", () => {
  it("compileEnvelope throws EnvelopeCompilationError whenever networkDestinations carries a malformed entry", () => {
    fc.assert(
      fc.property(envelopeWithMalformedNetworkDestinationArbitrary(), (envelope) => {
        expect(() => compileEnvelope(envelope)).toThrow();
      }),
      { numRuns: 2000 },
    );
  });
});

describe("compileEnvelope — property: mandatory denies survive any envelope (≥10k cases)", () => {
  it("every fixed mandatory deny, every mandatory denyRead path, and the Edit/Write deny backstop are present, for any envelope", () => {
    fc.assert(
      fc.property(envelopeArbitrary(), (envelope) => {
        const profile = compileEnvelope(envelope);
        for (const rule of MANDATORY_FIXED_DENY) {
          expect(profile.permissions.deny).toContain(rule);
        }
        expect(() => assertMandatoryDenyReadPathsPresent(profile)).not.toThrow();
        expect(() => assertEditWriteDenyBackstopPresent(profile)).not.toThrow();
      }),
      { numRuns: 10000 },
    );
  });
});

describe("compileEnvelope — property: no blanket mcp__* deny ever (≥10k cases)", () => {
  it("the compiled profile never contains a blanket mcp__* deny, for any envelope", () => {
    fc.assert(
      fc.property(envelopeArbitrary(), (envelope) => {
        expect(() => assertNoBlanketMcpDeny(compileEnvelope(envelope))).not.toThrow();
      }),
      { numRuns: 10000 },
    );
  });
});

describe("compileEnvelope — property: every owned-path allow rule is worktree-scoped (≥10k cases, CRITICAL 1)", () => {
  it("no envelope, of any well-formed shape, ever produces an unanchored owned-path allow rule", () => {
    fc.assert(
      fc.property(envelopeArbitrary(), (envelope) => {
        expect(() =>
          assertAllOwnedPathAllowRulesAreWorktreeScoped(compileEnvelope(envelope)),
        ).not.toThrow();
      }),
      { numRuns: 10000 },
    );
  });
});
