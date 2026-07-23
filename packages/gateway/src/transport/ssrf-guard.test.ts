import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  checkHopBeforeCredentialAttach,
  checkOriginAllowlist,
  checkResolvedAddress,
  isPrivateOrReservedIp,
} from "./ssrf-guard.js";

const ALLOWLIST = {
  allowedSchemes: ["https:"],
  allowedOrigins: ["https://example.atlassian.net"],
};

describe("isPrivateOrReservedIp", () => {
  it.each([
    "10.0.0.1",
    "172.16.5.5",
    "192.168.1.1",
    "127.0.0.1",
    "169.254.169.254", // cloud metadata endpoint
    "0.0.0.0",
    "::1",
    "fe80::1",
    "fd00::1",
  ])("classifies %s as private/reserved", (ip) => {
    expect(isPrivateOrReservedIp(ip)).toBe(true);
  });

  it.each(["8.8.8.8", "1.1.1.1", "203.0.113.5", "2606:4700:4700::1111"])(
    "classifies %s as public",
    (ip) => {
      expect(isPrivateOrReservedIp(ip)).toBe(false);
    },
  );

  it.each([
    "::ffff:169.254.169.254", // IPv4-mapped metadata endpoint, dotted-quad form
    "::ffff:10.0.0.1", // IPv4-mapped private, dotted-quad form
    "::ffff:127.0.0.1", // IPv4-mapped loopback
    "::ffff:192.168.1.1", // IPv4-mapped private
    "::ffff:a9fe:a9fe", // IPv4-mapped metadata endpoint, hex-group form (a9fe:a9fe = 169.254.169.254)
    "64:ff9b::a9fe:a9fe", // NAT64-embedded metadata endpoint, hex-group form
    "64:ff9b::10.0.0.1", // NAT64-embedded private, dotted-quad form
    "::10.0.0.1", // deprecated IPv4-compatible form, private
  ])("classifies IPv6-embedded-IPv4 %s as private/reserved (MEDIUM #4)", (ip) => {
    expect(isPrivateOrReservedIp(ip)).toBe(true);
  });

  it.each([
    "::ffff:8.8.8.8", // IPv4-mapped public address stays public
    "64:ff9b::8.8.8.8", // NAT64-embedded public address stays public
  ])("classifies IPv6-embedded-IPv4 %s as public when the embedded address is public", (ip) => {
    expect(isPrivateOrReservedIp(ip)).toBe(false);
  });
});

describe("checkOriginAllowlist", () => {
  it("allows an exact scheme+origin match", () => {
    expect(checkOriginAllowlist(new URL("https://example.atlassian.net/rest"), ALLOWLIST)).toEqual(
      { allowed: true },
    );
  });

  it("refuses a foreign origin", () => {
    const verdict = checkOriginAllowlist(new URL("https://evil.example.com/"), ALLOWLIST);
    expect(verdict.allowed).toBe(false);
  });

  it("refuses a scheme downgrade (http instead of https)", () => {
    const verdict = checkOriginAllowlist(new URL("http://example.atlassian.net/"), ALLOWLIST);
    expect(verdict.allowed).toBe(false);
  });

  it("refuses a same-origin-looking but distinct port", () => {
    const verdict = checkOriginAllowlist(new URL("https://example.atlassian.net:8443/"), ALLOWLIST);
    expect(verdict.allowed).toBe(false);
  });
});

describe("checkResolvedAddress", () => {
  it("allows a public IP", () => {
    expect(checkResolvedAddress("203.0.113.7").allowed).toBe(true);
  });
  it("refuses a private IP", () => {
    expect(checkResolvedAddress("10.1.2.3").allowed).toBe(false);
  });
});

describe("checkHopBeforeCredentialAttach", () => {
  it("allows an allowlisted origin resolving to public addresses", () => {
    const verdict = checkHopBeforeCredentialAttach(
      new URL("https://example.atlassian.net/rest"),
      ["203.0.113.7"],
      ALLOWLIST,
    );
    expect(verdict).toEqual({ allowed: true });
  });

  it("refuses when origin passes but resolved address is private (DNS rebinding)", () => {
    const verdict = checkHopBeforeCredentialAttach(
      new URL("https://example.atlassian.net/rest"),
      ["127.0.0.1"],
      ALLOWLIST,
    );
    expect(verdict.allowed).toBe(false);
  });

  it("refuses a foreign-origin redirect target outright, before address resolution matters", () => {
    const verdict = checkHopBeforeCredentialAttach(
      new URL("https://evil.example.com/"),
      ["203.0.113.7"],
      ALLOWLIST,
    );
    expect(verdict.allowed).toBe(false);
  });

  it("refuses when no resolved addresses are supplied", () => {
    const verdict = checkHopBeforeCredentialAttach(
      new URL("https://example.atlassian.net/rest"),
      [],
      ALLOWLIST,
    );
    expect(verdict.allowed).toBe(false);
  });

  it("property: any origin outside the allowlist is always refused regardless of resolved address", () => {
    fc.assert(
      fc.property(
        fc.webUrl({ validSchemes: ["https"] }),
        fc.ipV4(),
        (urlString, ip) => {
          const url = new URL(urlString);
          fc.pre(url.origin !== ALLOWLIST.allowedOrigins[0]);
          const verdict = checkHopBeforeCredentialAttach(url, [ip], ALLOWLIST);
          expect(verdict.allowed).toBe(false);
        },
      ),
      { numRuns: 200 },
    );
  });

  it("property: a private-range resolved address is always refused even for the allowlisted origin", () => {
    fc.assert(
      fc.property(
        fc.constantFrom("10.0.0.1", "172.16.0.1", "192.168.0.1", "127.0.0.1", "169.254.1.1"),
        (ip) => {
          const verdict = checkHopBeforeCredentialAttach(
            new URL(ALLOWLIST.allowedOrigins[0] + "/x"),
            [ip],
            ALLOWLIST,
          );
          expect(verdict.allowed).toBe(false);
        },
      ),
      { numRuns: 50 },
    );
  });
});
