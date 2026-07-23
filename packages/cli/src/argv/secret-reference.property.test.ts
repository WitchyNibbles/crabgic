/**
 * Property suite — roadmap/09-cli-and-doctor.md §Test plan, "Property":
 * "fast-check over random argv permutations — no secret-shaped value ever
 * reaches a subprocess env or a logged string." Exercised here against the
 * classification primitive in isolation (§Test plan's own framing: "...
 * exercised here against the primitive in isolation before 11/12 exercise
 * it end-to-end").
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { SecretValueRejectedError } from "../errors.js";
import { isSecretShapedValue, parseSecretReference } from "./secret-reference.js";

const knownPrefixArb = fc.constantFrom("sk-", "sk_", "ghp_", "gho_", "github_pat_", "xox", "AKIA");
const suffixArb = fc.stringMatching(/^[A-Za-z0-9]{8,40}$/);

const referenceArb = fc.oneof(
  fc.stringMatching(/^[A-Za-z_][A-Za-z0-9_]{0,30}$/).map((name) => `env:${name}`),
  fc.stringMatching(/^[A-Za-z0-9/_.-]{1,60}$/).map((path) => `op://${path}`),
  fc.stringMatching(/^[A-Za-z0-9/_.-]{1,60}$/).map((path) => `vault://${path}`),
  fc.stringMatching(/^[A-Za-z0-9/_.-]{1,60}$/).map((path) => `file:///${path}`),
  fc.stringMatching(/^[A-Za-z0-9-]{1,40}$/).map((id) => `ref:${id}`),
);

describe("secret-reference property suite", () => {
  it("every recognized reference form always parses without throwing", () => {
    fc.assert(
      fc.property(referenceArb, (ref) => {
        const parsed = parseSecretReference("--token", ref);
        expect(parsed.raw).toBe(ref);
        expect(isSecretShapedValue(ref)).toBe(false);
      }),
      { numRuns: 500 },
    );
  });

  it("every known-secret-provider-prefixed token is rejected, and the rejection never echoes the value", () => {
    fc.assert(
      fc.property(knownPrefixArb, suffixArb, (prefix, suffix) => {
        const candidate = `${prefix}${suffix}`;
        expect(() => parseSecretReference("--token", candidate)).toThrow(SecretValueRejectedError);
        try {
          parseSecretReference("--token", candidate);
        } catch (err) {
          expect((err as Error).message).not.toContain(candidate);
        }
      }),
      { numRuns: 500 },
    );
  });

  it("every high-entropy whitespace-free candidate of length >= 20 that isn't a recognized reference form is rejected", () => {
    fc.assert(
      fc.property(fc.stringMatching(/^[A-Za-z0-9+/=._-]{20,80}$/), (candidate) => {
        fc.pre(!/^(env:|op:\/\/|vault:\/\/|file:\/\/\/|ref:)/.test(candidate));
        expect(isSecretShapedValue(candidate)).toBe(true);
        expect(() => parseSecretReference("--token", candidate)).toThrow(SecretValueRejectedError);
      }),
      { numRuns: 500 },
    );
  });
});
