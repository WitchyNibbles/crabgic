import { describe, expect, it } from "vitest";
import { resolveHostAddressesViaDns } from "./dns-resolve.js";

describe("resolveHostAddressesViaDns", () => {
  it("returns an IPv4 literal unchanged, with no DNS round-trip", async () => {
    const addresses = await resolveHostAddressesViaDns("203.0.113.7");
    expect(addresses).toEqual(["203.0.113.7"]);
  });

  it("returns an IPv6 literal unchanged, with no DNS round-trip", async () => {
    const addresses = await resolveHostAddressesViaDns("::1");
    expect(addresses).toEqual(["::1"]);
  });

  it("resolves a real hostname via node:dns/promises (localhost)", async () => {
    const addresses = await resolveHostAddressesViaDns("localhost");
    expect(addresses.length).toBeGreaterThan(0);
    for (const addr of addresses) {
      expect(typeof addr).toBe("string");
    }
  });
});
